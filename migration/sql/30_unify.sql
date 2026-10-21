-- =====================================================================================
-- AKK Hub — one login + security fixes, applied on top of the copied areas.
-- Each function below replaces the copied version. Its own login path is kept exactly; the only
-- additions are (a) accepting a hub worker session (Attendance) when the worker has access, and
-- (b) bcrypt-aware password checks for Materials (its passwords were stored as plain text).
-- CREATE OR REPLACE keeps each function's existing privileges.
-- =====================================================================================

-- Attendance: "admin" used to mean "any signed-in Supabase user" — true only while that project had
-- nothing but admins. In the shared project it must mean an Attendance admin.
create or replace function attendance.is_admin_jwt()
returns boolean
language sql
stable
security definer
set search_path = core
as $function$
    select auth.uid() is not null
       and exists (select 1 from core.attendance_admins a where a.user_id = auth.uid());
$function$;

-- Site Progress: worker session check (used by every worker RPC through _require_worker).
create or replace function progress.verify_role_session(p_session_token text)
returns table (user_id uuid, role text, display_name text, employee_code text)
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $function$
begin
    return query
        select u.id, s.role, u.display_name, u.employee_code
          from progress.role_sessions s
          join progress.app_users u on u.id = s.user_id
         where s.session_token = p_session_token
           and s.expires_at > now()
           and u.is_active = true;
    if found then
        return;
    end if;
    -- One AKK Hub login: a signed-in worker's hub session also opens Site photos (if allowed).
    return query select * from core.progress_worker_from_hub_session(p_session_token);
end;
$function$;

-- Materials: worker session check (used by every requester RPC).
create or replace function materials.verify_worker_session(p_token text)
returns table (requester_id text, name text)
language plpgsql
security definer
set search_path to 'materials'
as $function$
declare
    s materials.worker_sessions%rowtype;
    r materials.requesters%rowtype;
begin
    if p_token is null or p_token = '' then
        return;
    end if;

    select * into s from materials.worker_sessions ws where ws.token = p_token and ws.expires_at > now();
    if found then
        select * into r from materials.requesters req where req.requester_id = s.requester_id;
        if not found then
            return;
        end if;
        -- Sliding session: stay logged in while the app is actually used.
        update materials.worker_sessions ws2
           set last_seen_at = now(), expires_at = now() + interval '30 days'
         where ws2.token = p_token;
        return query select r.requester_id, r.name;
        return;
    end if;

    -- One AKK Hub login: a signed-in worker's hub session also opens Materials (if allowed).
    return query select * from core.materials_worker_from_hub_session(p_token);
end;
$function$;

-- Materials: own login, now bcrypt-aware (plain-text passwords are hashed during the migration).
create or replace function materials.verify_requester_login(p_requester_id text, p_password text)
returns table (token text, requester_id text, name text)
language plpgsql
security definer
set search_path to 'materials'
as $function$
declare
    r materials.requesters%rowtype;
    v_token text;
begin
    delete from materials.worker_sessions ws where ws.expires_at < now();

    select * into r from materials.requesters req where req.requester_id = p_requester_id;
    if not found or not core.verify_password(r.password_hash, p_password) then
        raise exception 'Invalid requester ID or password';
    end if;

    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into materials.worker_sessions (token, requester_id) values (v_token, r.requester_id);

    return query select v_token, r.requester_id, r.name;
end;
$function$;

create or replace function materials.worker_change_password(p_token text, p_current_password text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path to 'materials', 'extensions'
as $function$
declare
    v_requester_id text;
    r materials.requesters%rowtype;
begin
    select v.requester_id into v_requester_id from materials.verify_worker_session(p_token) v;
    if v_requester_id is null then
        raise exception 'Session expired. Please log in again.';
    end if;

    select * into r from materials.requesters req where req.requester_id = v_requester_id;
    if not found or not core.verify_password(r.password_hash, p_current_password) then
        raise exception 'Current password is incorrect';
    end if;

    update materials.requesters req
       set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
     where req.requester_id = v_requester_id;
    return true;
end;
$function$;

-- Delete a pending request: accepts the requester's own password or (one login) the worker's
-- Attendance password.
create or replace function materials.worker_delete_pending_transaction(p_transaction_id uuid, p_worker_id text, p_password text)
returns boolean
language plpgsql
security definer
set search_path to 'materials'
as $function$
begin
    if not exists (
        select 1 from materials.requesters req
         where req.requester_id = p_worker_id and core.verify_password(req.password_hash, p_password)
    ) and not core.verify_attendance_worker_password(p_worker_id, p_password) then
        raise exception 'Invalid worker credentials';
    end if;
    delete from materials.transactions t
     where t.id = p_transaction_id
       and t.worker_id = p_worker_id
       and t.approval_status = 'pending';
    return found;
end;
$function$;
