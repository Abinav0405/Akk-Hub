-- Admin reset for attendance managers / supervisors (same pattern as admin_set_worker_password).
-- Stores bcrypt via pgcrypto; clears login lockout. Idempotent.

create or replace function attendance.admin_set_manager_password(
    p_manager_id uuid,
    p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = attendance, extensions
as $$
declare
    v_rows integer;
    v_plain text := trim(p_new_password);
    v_email text;
begin
    if auth.uid() is null then
        raise exception 'not_authenticated: Admin authentication required.'
            using errcode = 'P0001';
    end if;

    if not attendance.is_admin_jwt() then
        raise exception 'not_authorized: Admin role required.'
            using errcode = 'P0001';
    end if;

    if v_plain is null or v_plain = '' or length(v_plain) < 4 then
        raise exception 'password_too_short: Password must be at least 4 characters.'
            using errcode = 'P0001';
    end if;

    if v_plain like '$2%' then
        raise exception 'password_invalid: Enter a new plain-text password, not a hash.'
            using errcode = 'P0001';
    end if;

    update attendance.managers
       set password_hash = extensions.crypt(v_plain, extensions.gen_salt('bf')),
           updated_at = now()
     where id = p_manager_id
    returning lower(email::text) into v_email;

    get diagnostics v_rows = row_count;

    if v_rows > 0 and v_email is not null then
        perform attendance.record_login_success(v_email, 'manager');
    end if;

    return v_rows > 0;
end;
$$;

create or replace function attendance.admin_set_supervisor_password(
    p_supervisor_row_id uuid,
    p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = attendance, extensions
as $$
declare
    v_rows integer;
    v_plain text := trim(p_new_password);
    v_sid text;
begin
    if auth.uid() is null then
        raise exception 'not_authenticated: Admin authentication required.'
            using errcode = 'P0001';
    end if;

    if not attendance.is_admin_jwt() then
        raise exception 'not_authorized: Admin role required.'
            using errcode = 'P0001';
    end if;

    if v_plain is null or v_plain = '' or length(v_plain) < 4 then
        raise exception 'password_too_short: Password must be at least 4 characters.'
            using errcode = 'P0001';
    end if;

    if v_plain like '$2%' then
        raise exception 'password_invalid: Enter a new plain-text password, not a hash.'
            using errcode = 'P0001';
    end if;

    update attendance.supervisors
       set password_hash = extensions.crypt(v_plain, extensions.gen_salt('bf')),
           updated_at = now()
     where id = p_supervisor_row_id
    returning supervisor_id::text into v_sid;

    get diagnostics v_rows = row_count;

    if v_rows > 0 and v_sid is not null then
        perform attendance.record_login_success(v_sid, 'supervisor');
    end if;

    return v_rows > 0;
end;
$$;

revoke all on function attendance.admin_set_manager_password(uuid, text) from public, anon;
revoke all on function attendance.admin_set_supervisor_password(uuid, text) from public, anon;
grant execute on function attendance.admin_set_manager_password(uuid, text) to authenticated, service_role;
grant execute on function attendance.admin_set_supervisor_password(uuid, text) to authenticated, service_role;

comment on function attendance.admin_set_manager_password(uuid, text) is
  'Admin-only: set manager login password (bcrypt) and clear manager login lockout.';
comment on function attendance.admin_set_supervisor_password(uuid, text) is
  'Admin-only: set supervisor login password (bcrypt) and clear supervisor login lockout.';
