-- =====================================================================================
-- AKK Hub — core: what makes the three areas one product.
--   · core.worker_access  — per worker (Attendance employee ID): Materials on/off, Site photos on/off
--   · core.sites          — one place per real site, linking the Attendance / Materials / Site
--                           Progress rows of that place (their data stays where it is, not copied)
--   · core.attendance_admins — who is an Attendance admin (replaces "any signed-in user")
--   · one-login helpers: an Attendance worker session opens Materials and Site Progress
--   · admin RPCs for the hub: list / get a worker with roles + access, set access, list places,
--     list staff
-- Requires schemas attendance, materials, progress to exist (applied after them).
-- Tables have RLS on and no policies: they are reachable only through the functions below.
-- =====================================================================================

create table if not exists core.worker_access (
    employee_id text primary key,
    worker_type text not null check (worker_type in ('local', 'foreign')),
    materials boolean not null default false,
    progress boolean not null default false,
    updated_at timestamptz not null default now(),
    updated_by text
);

create table if not exists core.sites (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    attendance_site_id text unique,
    materials_site_id uuid unique,
    progress_site_id uuid unique,
    created_at timestamptz not null default now()
);

create table if not exists core.attendance_admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    added_at timestamptz not null default now()
);

create table if not exists core.migration_log (
    id bigserial primary key,
    step text not null,
    detail jsonb not null default '{}'::jsonb,
    at timestamptz not null default now()
);

alter table core.worker_access enable row level security;
alter table core.sites enable row level security;
alter table core.attendance_admins enable row level security;
alter table core.migration_log enable row level security;
revoke all on all tables in schema core from public, anon, authenticated;
revoke all on all sequences in schema core from public, anon, authenticated;
grant all on all tables in schema core to service_role;
grant all on all sequences in schema core to service_role;

-- ---------------------------------------------------------------------------
-- Passwords: bcrypt, with the legacy plaintext fallback Attendance already uses.
-- ---------------------------------------------------------------------------
create or replace function core.verify_password(p_stored text, p_plain text)
returns boolean
language plpgsql
immutable
set search_path = extensions
as $$
begin
    if p_stored is null or p_plain is null then
        return false;
    end if;
    if p_stored like '$2%' then
        return p_stored = extensions.crypt(p_plain, p_stored);
    end if;
    return p_stored = p_plain;
end;
$$;

create or replace function core.verify_attendance_worker_password(p_employee_id text, p_password text)
returns boolean
language sql
stable
security definer
set search_path = core, attendance
as $$
    select exists (
        select 1 from attendance.worker_details d
         where d.employee_id = trim(p_employee_id) and coalesce(d.in_company, true)
           and core.verify_password(d.password_hash, p_password)
        union all
        select 1 from attendance.local_worker_details l
         where l.employee_id = trim(p_employee_id) and coalesce(l.in_company, true)
           and core.verify_password(l.password_hash::text, p_password)
    );
$$;

-- ---------------------------------------------------------------------------
-- One login: who is behind an Attendance worker session token?
-- ---------------------------------------------------------------------------
create or replace function core.hub_worker_from_session(p_token text)
returns table (employee_id text, worker_type text, worker_name text, materials boolean, progress boolean)
language plpgsql
stable
security definer
set search_path = core, attendance
as $$
declare
    v_subject text;
begin
    if p_token is null
       or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return;
    end if;

    select s.subject_id into v_subject
      from attendance.role_sessions s
     where s.session_token = p_token::uuid
       and s.role = 'worker'
       and coalesce(s.session_kind, 'full') = 'full'
       and s.expires_at > now();
    if v_subject is null then
        return;
    end if;

    return query
        select w.eid, w.wtype, w.wname, coalesce(a.materials, false), coalesce(a.progress, false)
          from (
                select d.employee_id::text as eid, 'foreign'::text as wtype, d.employee_name::text as wname,
                       coalesce(d.in_company, true) as active
                  from attendance.worker_details d where d.employee_id = v_subject
                union all
                select l.employee_id::text, 'local'::text, l.employee_name::text, coalesce(l.in_company, true)
                  from attendance.local_worker_details l where l.employee_id = v_subject
               ) w
          left join core.worker_access a on a.employee_id = w.eid
         where w.active
         limit 1;
end;
$$;

-- What the signed-in worker may open (the hub shows / hides Materials and Site photos with this).
create or replace function core.my_access(p_session_token text)
returns jsonb
language sql
stable
security definer
set search_path = core
as $$
    select jsonb_build_object(
               'employee_id', w.employee_id,
               'worker_type', w.worker_type,
               'attendance', true,
               'materials', w.materials,
               'progress', w.progress)
      from core.hub_worker_from_session(p_session_token) w;
$$;

-- Site Progress row for a hub worker (created on first use if the worker has access).
create or replace function core.progress_worker_from_hub_session(p_token text)
returns table (user_id uuid, role text, display_name text, employee_code text)
language plpgsql
volatile
security definer
set search_path = core, progress, extensions
as $$
declare
    v_eid text;
    v_name text;
    v_allowed boolean;
    v_id uuid;
    v_active boolean;
begin
    select w.employee_id, w.worker_name, w.progress into v_eid, v_name, v_allowed
      from core.hub_worker_from_session(p_token) w;
    if v_eid is null or not coalesce(v_allowed, false) then
        return;
    end if;

    select u.id, u.is_active into v_id, v_active from progress.app_users u where u.employee_code = v_eid;
    if v_id is null then
        insert into progress.app_users (role, employee_code, display_name, password_hash)
        values ('worker', v_eid, coalesce(nullif(trim(v_name), ''), v_eid),
                extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')))
        returning id into v_id;
        v_active := true;
    end if;
    if not coalesce(v_active, false) then
        return;
    end if;

    return query
        select u.id, 'worker'::text, u.display_name, u.employee_code from progress.app_users u where u.id = v_id;
end;
$$;

-- Materials requester for a hub worker (created on first use if the worker has access).
create or replace function core.materials_worker_from_hub_session(p_token text)
returns table (requester_id text, name text)
language plpgsql
volatile
security definer
set search_path = core, materials, extensions
as $$
declare
    v_eid text;
    v_name text;
    v_allowed boolean;
begin
    select w.employee_id, w.worker_name, w.materials into v_eid, v_name, v_allowed
      from core.hub_worker_from_session(p_token) w;
    if v_eid is null or not coalesce(v_allowed, false) then
        return;
    end if;

    if not exists (select 1 from materials.requesters r where r.requester_id = v_eid) then
        insert into materials.requesters (requester_id, name, password_hash)
        values (v_eid, coalesce(nullif(trim(v_name), ''), v_eid),
                extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')));
    end if;

    return query select r.requester_id, r.name from materials.requesters r where r.requester_id = v_eid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin checks
-- ---------------------------------------------------------------------------
create or replace function core.is_attendance_admin()
returns boolean
language sql
stable
security definer
set search_path = core
as $$
    select auth.uid() is not null
       and exists (select 1 from core.attendance_admins a where a.user_id = auth.uid());
$$;

-- An admin of any area (used by the hub's admin screens).
create or replace function core.is_hub_admin()
returns boolean
language sql
stable
security definer
set search_path = core
as $$
    select auth.uid() is not null and (
           exists (select 1 from core.attendance_admins a where a.user_id = auth.uid())
        or exists (select 1 from progress.admin_profiles p where p.user_id = auth.uid() and p.is_active)
        or exists (select 1 from materials.staff_profiles s
                    where s.user_id = auth.uid() and s.is_active and 'admin' = any (s.roles))
    );
$$;

-- ---------------------------------------------------------------------------
-- Admin: workers (profile from Attendance + roles/access)
-- ---------------------------------------------------------------------------
create or replace function core.admin_list_workers()
returns table (employee_id text, worker_type text, employee_name text, designation text,
               in_company boolean, face_id_set boolean, materials boolean, progress boolean)
language plpgsql
stable
security definer
set search_path = core, attendance
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return query
        select w.eid, w.wtype, w.wname, w.wdesig, w.active, w.face, coalesce(a.materials, false), coalesce(a.progress, false)
          from (
                select d.employee_id::text as eid, 'foreign'::text as wtype, d.employee_name::text as wname,
                       d.designation::text as wdesig, coalesce(d.in_company, true) as active,
                       coalesce(d.face_id_set, false) as face
                  from attendance.worker_details d
                union all
                select l.employee_id::text, 'local'::text, l.employee_name::text, l.designation::text,
                       coalesce(l.in_company, true), coalesce(l.face_id_set, false)
                  from attendance.local_worker_details l
               ) w
          left join core.worker_access a on a.employee_id = w.eid
         order by w.eid;
end;
$$;

create or replace function core.admin_get_worker(p_employee_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = core, attendance
as $$
declare
    v_id text := trim(p_employee_id);
    v_profile jsonb;
    v_type text;
    v_access core.worker_access%rowtype;
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;

    select to_jsonb(d) - 'password_hash' - 'face_embedding' - 'face_encoding', 'foreign'
      into v_profile, v_type
      from attendance.worker_details d where d.employee_id = v_id;
    if v_profile is null then
        select to_jsonb(l) - 'password_hash' - 'face_embedding' - 'face_encoding', 'local'
          into v_profile, v_type
          from attendance.local_worker_details l where l.employee_id = v_id;
    end if;
    if v_profile is null then
        return null;
    end if;

    select * into v_access from core.worker_access a where a.employee_id = v_id;

    return jsonb_build_object(
        'employee_id', v_id,
        'worker_type', v_type,
        'profile', v_profile,
        -- Job roles. A supervisor login with the same ID is a separate account; it's only shown here.
        'roles', jsonb_build_array('worker') || case
            when exists (select 1 from attendance.supervisors sv
                          where lower(sv.supervisor_id) = lower(v_id) and coalesce(sv.is_active, true))
            then jsonb_build_array('supervisor') else '[]'::jsonb end,
        'access', jsonb_build_object(
            'attendance', true,
            'materials', coalesce(v_access.materials, false),
            'progress', coalesce(v_access.progress, false),
            'updated_at', v_access.updated_at,
            'updated_by', v_access.updated_by),
        'activity', jsonb_build_object(
            'shifts', (select count(*) from attendance.shifts s where s.worker_id = v_id),
            'leave_requests', (select count(*) from attendance.leave_requests r where r.employee_id = v_id),
            'material_requests', (select count(*) from materials.transactions t where t.worker_id = v_id),
            'photo_packages', (select count(*) from progress.packages p
                                 join progress.app_users u on u.id = p.worker_id
                                where u.employee_code = v_id))
    );
end;
$$;

create or replace function core.admin_set_worker_access(p_employee_id text, p_materials boolean, p_progress boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = core, attendance, extensions
as $$
declare
    v_id text := trim(p_employee_id);
    v_type text;
    v_name text;
    v_materials boolean := coalesce(p_materials, false);
    v_progress boolean := coalesce(p_progress, false);
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;

    select 'foreign', d.employee_name::text into v_type, v_name from attendance.worker_details d where d.employee_id = v_id;
    if v_type is null then
        select 'local', l.employee_name::text into v_type, v_name from attendance.local_worker_details l where l.employee_id = v_id;
    end if;
    if v_type is null then
        raise exception 'Worker not found';
    end if;

    insert into core.worker_access as a (employee_id, worker_type, materials, progress, updated_at, updated_by)
    values (v_id, v_type, v_materials, v_progress, now(), coalesce(auth.jwt() ->> 'email', auth.uid()::text))
    on conflict (employee_id) do update
       set materials = excluded.materials,
           progress = excluded.progress,
           updated_at = now(),
           updated_by = excluded.updated_by;

    -- Keep the area records in step with the switch.
    if v_progress then
        if exists (select 1 from progress.app_users u where u.employee_code = v_id) then
            update progress.app_users set is_active = true where employee_code = v_id;
        else
            insert into progress.app_users (role, employee_code, display_name, password_hash)
            values ('worker', v_id, coalesce(nullif(trim(v_name), ''), v_id),
                    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')));
        end if;
    else
        update progress.app_users set is_active = false where employee_code = v_id;
    end if;
    if v_materials and not exists (select 1 from materials.requesters r where r.requester_id = v_id) then
        insert into materials.requesters (requester_id, name, password_hash)
        values (v_id, coalesce(nullif(trim(v_name), ''), v_id),
                extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')));
    end if;

    return jsonb_build_object('employee_id', v_id, 'attendance', true, 'materials', v_materials, 'progress', v_progress);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: places (one row per real site, with how much each area recorded there)
-- ---------------------------------------------------------------------------
create or replace function core.admin_list_sites()
returns table (id uuid, name text, attendance_site_id text, materials_site_id uuid, progress_site_id uuid,
               shifts bigint, material_requests bigint, photo_packages bigint, jsrs bigint)
language plpgsql
stable
security definer
set search_path = core
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return query
        select s.id, s.name, s.attendance_site_id, s.materials_site_id, s.progress_site_id,
               (select count(*) from attendance.shifts x where x.site_id = s.attendance_site_id),
               (select count(*) from materials.transactions x where x.site_id = s.materials_site_id),
               (select count(*) from progress.packages x where x.site_id = s.progress_site_id),
               (select count(*) from progress.jsrs x where x.site_id = s.progress_site_id)
          from core.sites s
         order by s.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: staff (separate accounts from workers; one row per login, with roles per area)
-- ---------------------------------------------------------------------------
create or replace function core.admin_list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = core
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return coalesce((
        with s as (
            select lower(m.email::text) as login, m.name::text as name, 'attendance'::text as area, 'manager'::text as role
              from attendance.managers m
            union all
            select lower(sv.supervisor_id), sv.name, 'attendance', 'supervisor'
              from attendance.supervisors sv where coalesce(sv.is_active, true)
            union all
            select lower(u.email::text), coalesce(u.raw_user_meta_data ->> 'name', ''), 'attendance', 'admin'
              from core.attendance_admins a join auth.users u on u.id = a.user_id
            union all
            select lower(sp.email), sp.display_name, 'materials', r
              from materials.staff_profiles sp cross join unnest(sp.roles) r where sp.is_active
            union all
            select lower(mu.login_id), mu.display_name, 'progress', 'manager'
              from progress.manager_users mu where mu.is_active
            union all
            select lower(ap.email), ap.display_name, 'progress', 'admin'
              from progress.admin_profiles ap where ap.is_active
        )
        select jsonb_agg(jsonb_build_object('login', g.login, 'name', g.name, 'roles', g.roles) order by g.login)
          from (
                select s.login, max(nullif(s.name, '')) as name,
                       jsonb_agg(distinct jsonb_build_object('area', s.area, 'role', s.role)) as roles
                  from s group by s.login
               ) g
    ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on all functions in schema core from public, anon, authenticated;
grant execute on function core.my_access(text) to anon, authenticated;
grant execute on function core.is_hub_admin() to anon, authenticated;
grant execute on function core.is_attendance_admin() to anon, authenticated;
grant execute on function core.admin_list_workers() to authenticated;
grant execute on function core.admin_get_worker(text) to authenticated;
grant execute on function core.admin_set_worker_access(text, boolean, boolean) to authenticated;
grant execute on function core.admin_list_sites() to authenticated;
grant execute on function core.admin_list_staff() to authenticated;
grant execute on all functions in schema core to service_role;
