-- =====================================================================================
-- AKK Hub — Deployment: managers / admins plan who goes to which site, when; workers see their
-- own published deployment; supervisors see their site's crew (view only).
--   · A day is a draft until published. Workers only ever see PUBLISHED versions (history).
--   · A worker can be at several sites in one day; overlapping times are impossible (DB rule).
--   · Publish notifies only the workers whose deployment is new / changed / removed.
-- Callers: admins (Supabase Auth) or a hub role-session token (manager / supervisor / worker).
-- =====================================================================================
create extension if not exists btree_gist with schema extensions;

create table if not exists core.deployment_days (
    id uuid primary key default gen_random_uuid(),
    day date not null unique,
    status text not null default 'draft' check (status in ('draft', 'published')),
    version int not null default 0,      -- published versions
    rev int not null default 0,          -- edit counter (stops two planners overwriting each other)
    dirty boolean not null default true, -- edited since the last publish
    notes text,
    updated_at timestamptz not null default now(),
    updated_by text,
    published_at timestamptz,
    published_by text
);

create table if not exists core.deployment_sites (
    id uuid primary key default gen_random_uuid(),
    day_id uuid not null references core.deployment_days (id) on delete cascade,
    place_id uuid not null references core.sites (id),
    start_time time not null,
    end_time time not null,
    team_lead text,
    vehicle_id uuid,
    driver_id text,
    job_ref text,
    notes text,
    sort int not null default 0,
    check (end_time > start_time)
);

create table if not exists core.deployment_assignments (
    id uuid primary key default gen_random_uuid(),
    day_id uuid not null references core.deployment_days (id) on delete cascade,
    site_row_id uuid not null references core.deployment_sites (id) on delete cascade,
    employee_id text not null,
    start_time time not null,
    end_time time not null,
    leave_override boolean not null default false,
    seen_at timestamptz,
    check (end_time > start_time),
    constraint deployment_no_double_booking exclude using gist (
        day_id with =,
        employee_id with =,
        tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) with &&)
);
create index if not exists deployment_assignments_employee_idx on core.deployment_assignments (employee_id);

create table if not exists core.deployment_history (
    id uuid primary key default gen_random_uuid(),
    day_id uuid not null references core.deployment_days (id) on delete cascade,
    day date not null,
    version int not null,
    snapshot jsonb not null,
    published_at timestamptz not null default now(),
    published_by text,
    unique (day_id, version)
);

create table if not exists core.deployment_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    payload jsonb not null,
    created_by text,
    created_at timestamptz not null default now()
);

create table if not exists core.deployment_notifications (
    id bigserial primary key,
    employee_id text not null,
    day date not null,
    kind text not null check (kind in ('new', 'changed', 'removed')),
    version int not null,
    message text not null,
    created_at timestamptz not null default now()
);

do $$
declare t text;
begin
    foreach t in array array['deployment_days','deployment_sites','deployment_assignments','deployment_history','deployment_templates','deployment_notifications'] loop
        execute format('alter table core.%I enable row level security', t);
        execute format('revoke all on core.%I from public, anon, authenticated', t);
        execute format('grant all on core.%I to service_role', t);
    end loop;
end $$;
revoke all on all sequences in schema core from public, anon, authenticated;
grant all on all sequences in schema core to service_role;

-- ---------------------------------------------------------------------------
-- Who is calling?
-- ---------------------------------------------------------------------------
create or replace function core.dep_actor(p_token text)
returns table (kind text, who text, site_id text)
language plpgsql
stable
security definer
set search_path = core
as $$
declare
    r record;
begin
    if core.is_hub_admin() then
        return query select 'admin'::text, coalesce(auth.jwt() ->> 'email', auth.uid()::text), null::text;
        return;
    end if;
    if p_token is null or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return;
    end if;
    select s.role, s.subject_id into r
      from attendance.role_sessions s
     where s.session_token = p_token::uuid and s.expires_at > now() and coalesce(s.session_kind, 'full') = 'full';
    if r.role = 'manager' then
        return query select 'manager'::text, r.subject_id, null::text;
    elsif r.role = 'supervisor' then
        return query select 'supervisor'::text, r.subject_id,
            (select sv.site_id from attendance.supervisors sv
              where sv.supervisor_id = r.subject_id and coalesce(sv.is_active, true) limit 1);
    elsif r.role = 'worker' then
        return query select 'worker'::text, r.subject_id, null::text;
    end if;
end;
$$;

create or replace function core._dep_planner(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = core
as $$
declare
    a record;
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is null or a.kind not in ('admin', 'manager') then
        raise exception 'Only managers and admins can plan deployments';
    end if;
    return a.kind || ':' || a.who;
end;
$$;

create or replace function core._sg_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Singapore')::date $$;

-- All workers (Attendance is the master record).
create or replace function core._dep_workers()
returns table (employee_id text, name text, worker_type text, designation text, in_company boolean)
language sql stable security definer set search_path = core as $$
    select d.employee_id::text, d.employee_name::text, 'foreign', d.designation::text, coalesce(d.in_company, true) from attendance.worker_details d
    union all
    select l.employee_id::text, l.employee_name::text, 'local', l.designation::text, coalesce(l.in_company, true) from attendance.local_worker_details l;
$$;

create or replace function core._dep_on_leave(p_employee text, p_day date)
returns boolean language sql stable security definer set search_path = core as $$
    select exists (select 1 from attendance.leave_requests r
                    where r.employee_id = p_employee and r.status = 'approved' and p_day between r.from_date and r.to_date);
$$;

-- One day as JSON (live rows; planners only).
create or replace function core._dep_day_json(p_day_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = core
as $$
    select jsonb_build_object(
        'id', d.id, 'day', d.day, 'status', d.status, 'version', d.version, 'rev', d.rev, 'dirty', d.dirty,
        'notes', d.notes, 'updated_at', d.updated_at, 'updated_by', d.updated_by,
        'published_at', d.published_at, 'published_by', d.published_by,
        'sites', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', s.id, 'place_id', s.place_id, 'place_name', p.name,
                'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'),
                'team_lead', s.team_lead, 'vehicle_id', s.vehicle_id, 'driver_id', s.driver_id,
                'job_ref', s.job_ref, 'notes', s.notes,
                'crew', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'employee_id', a.employee_id, 'name', w.name,
                        'start_time', to_char(a.start_time, 'HH24:MI'), 'end_time', to_char(a.end_time, 'HH24:MI'),
                        'leave_override', a.leave_override, 'seen_at', a.seen_at) order by w.name)
                      from core.deployment_assignments a
                      left join core._dep_workers() w on w.employee_id = a.employee_id
                     where a.site_row_id = s.id), '[]'::jsonb)
            ) order by s.sort, p.name)
              from core.deployment_sites s join core.sites p on p.id = s.place_id
             where s.day_id = d.id), '[]'::jsonb))
      from core.deployment_days d where d.id = p_day_id;
$$;

-- ---------------------------------------------------------------------------
-- Planner: board for a date range (week view + day editor)
-- ---------------------------------------------------------------------------
create or replace function core.dep_board(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = core
as $$
begin
    perform core._dep_planner(p_token);
    if p_to < p_from or p_to - p_from > 31 then
        raise exception 'Pick a range of up to 31 days';
    end if;
    return jsonb_build_object(
        'today', core._sg_today(),
        'days', coalesce((select jsonb_agg(core._dep_day_json(d.id) order by d.day)
                            from core.deployment_days d where d.day between p_from and p_to), '[]'::jsonb),
        'places', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', s.id, 'name', s.name, 'latitude', a.latitude, 'longitude', a.longitude,
                                'has_location', a.latitude is not null, 'has_qr', nullif(a.qr_token, '') is not null) order by s.name)
                              from core.sites s join attendance.sites a on a.id = s.attendance_site_id
                             where a.is_active), '[]'::jsonb),
        'workers', coalesce((select jsonb_agg(jsonb_build_object(
                                'employee_id', w.employee_id, 'name', w.name, 'worker_type', w.worker_type,
                                'designation', w.designation) order by w.name)
                              from core._dep_workers() w where w.in_company), '[]'::jsonb),
        'leave', coalesce((select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'from', r.from_date, 'to', r.to_date, 'type', r.leave_type))
                             from attendance.leave_requests r
                            where r.status = 'approved' and r.to_date >= p_from and r.from_date <= p_to), '[]'::jsonb),
        'vehicles', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'number', v.vehicle_number, 'description', v.description) order by v.vehicle_number)
                                from attendance.vehicles v where coalesce(v.is_active, true)), '[]'::jsonb),
        'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name) from core.deployment_templates t), '[]'::jsonb)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Planner: save a day (replaces its plan). Payload:
--   { notes, sites: [ { place_id, start_time, end_time, team_lead, vehicle_id, driver_id, job_ref, notes,
--                       crew: [ { employee_id, start_time?, end_time?, leave_override? } ] } ] }
-- p_rev = the rev the planner loaded (null for a new day) → refuses to overwrite someone else's edit.
-- ---------------------------------------------------------------------------
create or replace function core.dep_save_day(p_token text, p_day date, p_payload jsonb, p_rev int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = core, extensions
as $$
declare
    v_who text := core._dep_planner(p_token);
    d core.deployment_days%rowtype;
    s jsonb;
    c jsonb;
    v_site uuid;
    v_sort int := 0;
    v_seen jsonb;
    v_start time;
    v_end time;
    v_name text;
begin
    if p_day < core._sg_today() - 1 then
        raise exception 'Past days can''t be changed';
    end if;

    select * into d from core.deployment_days where day = p_day for update;
    if d.id is null then
        insert into core.deployment_days (day, updated_by) values (p_day, v_who) returning * into d;
    elsif p_rev is null or p_rev <> d.rev then
        raise exception 'Someone else changed this day — reload to see their changes';
    end if;

    -- Keep "seen" for crew whose site + times don't change.
    select coalesce(jsonb_object_agg(a.employee_id || '|' || s2.place_id || '|' || a.start_time || '|' || a.end_time, a.seen_at), '{}'::jsonb)
      into v_seen
      from core.deployment_assignments a join core.deployment_sites s2 on s2.id = a.site_row_id
     where a.day_id = d.id and a.seen_at is not null;

    delete from core.deployment_sites where day_id = d.id;

    for s in select * from jsonb_array_elements(coalesce(p_payload -> 'sites', '[]'::jsonb)) loop
        v_sort := v_sort + 1;
        if not exists (select 1 from core.sites p join attendance.sites a on a.id = p.attendance_site_id
                        where p.id = (s ->> 'place_id')::uuid and a.is_active) then
            raise exception 'One of the sites is not an active Attendance site';
        end if;
        insert into core.deployment_sites (day_id, place_id, start_time, end_time, team_lead, vehicle_id, driver_id, job_ref, notes, sort)
        values (d.id, (s ->> 'place_id')::uuid, (s ->> 'start_time')::time, (s ->> 'end_time')::time,
                nullif(s ->> 'team_lead', ''), nullif(s ->> 'vehicle_id', '')::uuid, nullif(s ->> 'driver_id', ''),
                nullif(trim(s ->> 'job_ref'), ''), nullif(trim(s ->> 'notes'), ''), v_sort)
        returning id into v_site;

        for c in select * from jsonb_array_elements(coalesce(s -> 'crew', '[]'::jsonb)) loop
            select w.name into v_name from core._dep_workers() w where w.employee_id = c ->> 'employee_id' and w.in_company;
            if v_name is null then
                raise exception 'Worker % is not in the company', c ->> 'employee_id';
            end if;
            if core._dep_on_leave(c ->> 'employee_id', p_day) and not coalesce((c ->> 'leave_override')::boolean, false) then
                raise exception '% is on approved leave on %', v_name, to_char(p_day, 'DD Mon');
            end if;
            v_start := coalesce(nullif(c ->> 'start_time', '')::time, (s ->> 'start_time')::time);
            v_end := coalesce(nullif(c ->> 'end_time', '')::time, (s ->> 'end_time')::time);
            begin
                insert into core.deployment_assignments (day_id, site_row_id, employee_id, start_time, end_time, leave_override, seen_at)
                values (d.id, v_site, c ->> 'employee_id', v_start, v_end, coalesce((c ->> 'leave_override')::boolean, false),
                        (v_seen ->> ((c ->> 'employee_id') || '|' || (s ->> 'place_id') || '|' || v_start || '|' || v_end))::timestamptz);
            exception when exclusion_violation then
                raise exception '% is booked twice at overlapping times', v_name;
            end;
        end loop;
    end loop;

    update core.deployment_days
       set notes = nullif(trim(p_payload ->> 'notes'), ''), rev = rev + 1, dirty = true,
           updated_at = now(), updated_by = v_who
     where id = d.id;
    return core._dep_day_json(d.id);
exception when check_violation then
    raise exception 'End time must be after start time';
end;
$$;

-- Remove an unpublished day completely (published days: save an empty plan + publish instead).
create or replace function core.dep_discard_day(p_token text, p_day date)
returns void
language plpgsql
volatile
security definer
set search_path = core
as $$
begin
    perform core._dep_planner(p_token);
    if exists (select 1 from core.deployment_days where day = p_day and version > 0) then
        raise exception 'This day was already sent — remove the crew and send changes instead';
    end if;
    delete from core.deployment_days where day = p_day;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publish / send changes. Notifies only workers whose own deployment changed.
-- ---------------------------------------------------------------------------
create or replace function core._dep_worker_view(p_snapshot jsonb, p_employee text)
returns jsonb
language sql
immutable
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'place', s ->> 'place_name', 'start', c ->> 'start_time', 'end', c ->> 'end_time',
               'lead', s ->> 'team_lead', 'vehicle', s ->> 'vehicle_id', 'driver', s ->> 'driver_id',
               'job_ref', s ->> 'job_ref', 'notes', s ->> 'notes',
               'crew', (select jsonb_agg(c2 ->> 'employee_id' order by c2 ->> 'employee_id') from jsonb_array_elements(s -> 'crew') c2))
             order by c ->> 'start_time'), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_snapshot -> 'sites', '[]'::jsonb)) s,
           jsonb_array_elements(coalesce(s -> 'crew', '[]'::jsonb)) c
     where c ->> 'employee_id' = p_employee;
$$;

create or replace function core.dep_publish(p_token text, p_day date, p_rev int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    v_who text := core._dep_planner(p_token);
    d core.deployment_days%rowtype;
    v_new jsonb;
    v_old jsonb;
    e text;
    v_now jsonb;
    v_was jsonb;
    v_msg text;
    v_kind text;
    n_new int := 0;
    n_changed int := 0;
    n_removed int := 0;
begin
    select * into d from core.deployment_days where day = p_day for update;
    if d.id is null then
        raise exception 'Nothing planned for this day yet';
    end if;
    if p_rev is not null and p_rev <> d.rev then
        raise exception 'Someone else changed this day — reload before sending';
    end if;
    if d.status = 'published' and not d.dirty then
        return jsonb_build_object('new', 0, 'changed', 0, 'removed', 0, 'version', d.version);
    end if;

    v_new := core._dep_day_json(d.id);
    select h.snapshot into v_old from core.deployment_history h where h.day_id = d.id order by h.version desc limit 1;

    update core.deployment_days
       set status = 'published', version = version + 1, dirty = false, rev = rev + 1,
           published_at = now(), published_by = v_who, updated_at = now(), updated_by = v_who
     where id = d.id
    returning * into d;
    v_new := core._dep_day_json(d.id);
    insert into core.deployment_history (day_id, day, version, snapshot, published_by) values (d.id, d.day, d.version, v_new, v_who);

    for e in
        select distinct x from (
            select c ->> 'employee_id' x from jsonb_array_elements(v_new -> 'sites') s, jsonb_array_elements(s -> 'crew') c
            union
            select c ->> 'employee_id' from jsonb_array_elements(coalesce(v_old -> 'sites', '[]'::jsonb)) s, jsonb_array_elements(s -> 'crew') c
        ) q where x is not null
    loop
        v_now := core._dep_worker_view(v_new, e);
        v_was := core._dep_worker_view(coalesce(v_old, '{}'::jsonb), e);
        if v_now = v_was then
            continue;
        end if;
        if jsonb_array_length(v_now) = 0 then
            v_kind := 'removed';
            n_removed := n_removed + 1;
            v_msg := to_char(p_day, 'Dy DD Mon') || ': your deployment was cancelled';
        else
            v_kind := case when jsonb_array_length(v_was) = 0 then 'new' else 'changed' end;
            if v_kind = 'new' then n_new := n_new + 1; else n_changed := n_changed + 1; end if;
            select to_char(p_day, 'Dy DD Mon') || ': ' || string_agg((x ->> 'place') || ' ' || (x ->> 'start') || '–' || (x ->> 'end'), ', ')
                   || case when v_kind = 'changed' then ' (changed)' else '' end
              into v_msg
              from jsonb_array_elements(v_now) x;
            -- A changed deployment must be looked at again.
            update core.deployment_assignments set seen_at = null where day_id = d.id and employee_id = e;
        end if;
        insert into core.deployment_notifications (employee_id, day, kind, version, message)
        values (e, p_day, v_kind, d.version, v_msg);
    end loop;

    return jsonb_build_object('new', n_new, 'changed', n_changed, 'removed', n_removed, 'version', d.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Copy / templates (skip crew who are on leave or left the company on the new day)
-- ---------------------------------------------------------------------------
create or replace function core._dep_payload_from(p_day_json jsonb)
returns jsonb
language sql
immutable
as $$
    select jsonb_build_object(
        'notes', p_day_json -> 'notes',
        'sites', coalesce((select jsonb_agg(jsonb_build_object(
                    'place_id', s -> 'place_id', 'start_time', s -> 'start_time', 'end_time', s -> 'end_time',
                    'team_lead', s -> 'team_lead', 'vehicle_id', s -> 'vehicle_id', 'driver_id', s -> 'driver_id',
                    'job_ref', s -> 'job_ref', 'notes', s -> 'notes',
                    'crew', coalesce((select jsonb_agg(jsonb_build_object(
                                'employee_id', c -> 'employee_id', 'start_time', c -> 'start_time', 'end_time', c -> 'end_time'))
                              from jsonb_array_elements(s -> 'crew') c), '[]'::jsonb)))
                  from jsonb_array_elements(coalesce(p_day_json -> 'sites', '[]'::jsonb)) s), '[]'::jsonb));
$$;

create or replace function core._dep_filter_payload(p_payload jsonb, p_day date)
returns jsonb
language sql
stable
security definer
set search_path = core
as $$
    select jsonb_build_object(
        'notes', p_payload -> 'notes',
        'sites', coalesce((select jsonb_agg(s || jsonb_build_object('crew', coalesce((
                    select jsonb_agg(c) from jsonb_array_elements(coalesce(s -> 'crew', '[]'::jsonb)) c
                     where exists (select 1 from core._dep_workers() w where w.employee_id = c ->> 'employee_id' and w.in_company)
                       and not core._dep_on_leave(c ->> 'employee_id', p_day)), '[]'::jsonb)))
                  from jsonb_array_elements(coalesce(p_payload -> 'sites', '[]'::jsonb)) s
                 where exists (select 1 from core.sites p join attendance.sites a on a.id = p.attendance_site_id
                                where p.id = (s ->> 'place_id')::uuid and a.is_active)), '[]'::jsonb));
$$;

create or replace function core.dep_copy_day(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    src uuid;
    dst core.deployment_days%rowtype;
begin
    perform core._dep_planner(p_token);
    select id into src from core.deployment_days where day = p_from;
    if src is null then
        raise exception 'Nothing planned on % to copy', to_char(p_from, 'DD Mon');
    end if;
    select * into dst from core.deployment_days where day = p_to;
    if dst.id is not null and exists (select 1 from core.deployment_sites where day_id = dst.id) then
        raise exception '% already has a plan — clear it first', to_char(p_to, 'DD Mon');
    end if;
    return core.dep_save_day(p_token, p_to, core._dep_filter_payload(core._dep_payload_from(core._dep_day_json(src)), p_to), dst.rev);
end;
$$;

create or replace function core.dep_save_template(p_token text, p_name text, p_day date)
returns void
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    v_who text := core._dep_planner(p_token);
    src uuid;
begin
    select id into src from core.deployment_days where day = p_day;
    if src is null or trim(coalesce(p_name, '')) = '' then
        raise exception 'Pick a planned day and a template name';
    end if;
    insert into core.deployment_templates (name, payload, created_by)
    values (trim(p_name), core._dep_payload_from(core._dep_day_json(src)), v_who)
    on conflict (name) do update set payload = excluded.payload, created_by = excluded.created_by, created_at = now();
end;
$$;

create or replace function core.dep_apply_template(p_token text, p_template uuid, p_day date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    v_payload jsonb;
    dst core.deployment_days%rowtype;
begin
    perform core._dep_planner(p_token);
    select payload into v_payload from core.deployment_templates where id = p_template;
    if v_payload is null then
        raise exception 'Template not found';
    end if;
    select * into dst from core.deployment_days where day = p_day;
    if dst.id is not null and exists (select 1 from core.deployment_sites where day_id = dst.id) then
        raise exception '% already has a plan — clear it first', to_char(p_day, 'DD Mon');
    end if;
    return core.dep_save_day(p_token, p_day, core._dep_filter_payload(v_payload, p_day), dst.rev);
end;
$$;

create or replace function core.dep_delete_template(p_token text, p_template uuid)
returns void
language plpgsql volatile security definer set search_path = core as $$
begin
    perform core._dep_planner(p_token);
    delete from core.deployment_templates where id = p_template;
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker: my deployments (published versions only) + mark seen
-- ---------------------------------------------------------------------------
create or replace function core.dep_my(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = core
as $$
declare
    a record;
    v_today date := core._sg_today();
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is distinct from 'worker' then
        raise exception 'Session expired. Please log in again.';
    end if;
    return jsonb_build_object('today', v_today, 'days', coalesce((
        select jsonb_agg(day_json order by day_json ->> 'day')
          from (
            select jsonb_build_object(
                'day', h.day,
                'version', h.version,
                'published_at', h.published_at,
                'notes', h.snapshot ->> 'notes',
                'seen', not exists (select 1 from core.deployment_assignments x
                                     where x.day_id = h.day_id and x.employee_id = a.who and x.seen_at is null),
                'items', (
                    select jsonb_agg(jsonb_build_object(
                        'place', s ->> 'place_name',
                        'start', c ->> 'start_time', 'end', c ->> 'end_time',
                        'latitude', ast.latitude, 'longitude', ast.longitude,
                        'lead', (select w.name from core._dep_workers() w where w.employee_id = s ->> 'team_lead'),
                        'is_lead', (s ->> 'team_lead') = a.who,
                        'vehicle', (select v.vehicle_number from attendance.vehicles v where v.id::text = s ->> 'vehicle_id'),
                        'driver', (select w.name from core._dep_workers() w where w.employee_id = s ->> 'driver_id'),
                        'is_driver', (s ->> 'driver_id') = a.who,
                        'job_ref', s ->> 'job_ref',
                        'notes', s ->> 'notes',
                        'crew', (select jsonb_agg(c2 ->> 'name' order by c2 ->> 'name') from jsonb_array_elements(s -> 'crew') c2
                                  where c2 ->> 'employee_id' <> a.who))
                        order by c ->> 'start_time')
                      from jsonb_array_elements(h.snapshot -> 'sites') s
                      join jsonb_array_elements(s -> 'crew') c on c ->> 'employee_id' = a.who
                      left join core.sites ps on ps.id = (s ->> 'place_id')::uuid
                      left join attendance.sites ast on ast.id = ps.attendance_site_id)
            ) as day_json
              from core.deployment_history h
             where h.day between v_today - 7 and v_today + 14
               and h.version = (select max(h2.version) from core.deployment_history h2 where h2.day_id = h.day_id)
        ) q
         where day_json -> 'items' is not null and jsonb_typeof(day_json -> 'items') = 'array'), '[]'::jsonb));
end;
$$;

create or replace function core.dep_mark_seen(p_token text, p_day date)
returns void
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    a record;
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is distinct from 'worker' then
        raise exception 'Session expired. Please log in again.';
    end if;
    update core.deployment_assignments x set seen_at = now()
      from core.deployment_days d
     where d.id = x.day_id and d.day = p_day and d.version > 0 and x.employee_id = a.who and x.seen_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supervisor (their site) / planner: crew for a day, with clock-in status
-- ---------------------------------------------------------------------------
create or replace function core.dep_crew(p_token text, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = core
as $$
declare
    a record;
    v_snap jsonb;
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is null or a.kind = 'worker' then
        raise exception 'Not allowed';
    end if;
    select h.snapshot into v_snap from core.deployment_history h where h.day = p_day order by h.version desc limit 1;
    if v_snap is null then
        return jsonb_build_object('day', p_day, 'sites', '[]'::jsonb);
    end if;
    return jsonb_build_object('day', p_day, 'sites', coalesce((
        select jsonb_agg(jsonb_build_object(
            'place', s ->> 'place_name', 'start', s ->> 'start_time', 'end', s ->> 'end_time', 'notes', s ->> 'notes',
            'lead', (select w.name from core._dep_workers() w where w.employee_id = s ->> 'team_lead'),
            'crew', (select jsonb_agg(jsonb_build_object(
                        'employee_id', c ->> 'employee_id', 'name', c ->> 'name',
                        'start', c ->> 'start_time', 'end', c ->> 'end_time',
                        'clocked_in', exists (select 1 from attendance.shifts sh
                                               where sh.worker_id = c ->> 'employee_id' and sh.work_date = p_day and sh.entry_time is not null),
                        'clocked_site', (select ast2.site_name from attendance.shifts sh join attendance.sites ast2 on ast2.id = sh.site_id
                                          where sh.worker_id = c ->> 'employee_id' and sh.work_date = p_day order by sh.entry_time desc limit 1))
                      order by c ->> 'name')
                       from jsonb_array_elements(s -> 'crew') c)))
          from jsonb_array_elements(v_snap -> 'sites') s
          join core.sites ps on ps.id = (s ->> 'place_id')::uuid
         where a.kind in ('admin', 'manager') or ps.attendance_site_id = a.site_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Push on publish: reuse the generic sender (prg-push-send) with the Attendance device tokens.
-- ---------------------------------------------------------------------------
create or replace function core.dep_push()
returns trigger
language plpgsql
security definer
set search_path = core, extensions, net
as $$
declare
    cfg record;
    v_tokens text[];
begin
    if to_regclass('core.push_config') is null then
        return NEW;
    end if;
    execute 'select base_url, secret from core.push_config where id = 1' into cfg;
    if cfg.secret is null then
        return NEW;
    end if;
    select array_agg(distinct t.fcm_token) into v_tokens
      from attendance.device_push_tokens t
     where t.worker_id = NEW.employee_id and coalesce(trim(t.fcm_token), '') <> '';
    if v_tokens is null then
        return NEW;
    end if;
    begin
        perform net.http_post(
            url := cfg.base_url || '/functions/v1/prg-push-send',
            body := jsonb_build_object(
                'title', case NEW.kind when 'removed' then 'Deployment cancelled' when 'changed' then 'Deployment changed' else 'New deployment' end,
                'body', NEW.message,
                'path', '/me/deployment',
                'tokens', to_jsonb(v_tokens)),
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-spt-fcm-secret', cfg.secret));
    exception when others then
        raise warning 'deployment push failed: %', sqlerrm;
    end;
    return NEW;
end;
$$;
drop trigger if exists dep_push on core.deployment_notifications;
create trigger dep_push after insert on core.deployment_notifications for each row execute function core.dep_push();

-- ---------------------------------------------------------------------------
-- Who may call what (every function checks the caller itself)
-- ---------------------------------------------------------------------------
revoke all on function core.dep_actor(text) from public, anon, authenticated;
revoke all on function core._dep_planner(text) from public, anon, authenticated;
revoke all on function core._dep_workers() from public, anon, authenticated;
revoke all on function core._dep_on_leave(text, date) from public, anon, authenticated;
revoke all on function core._dep_day_json(uuid) from public, anon, authenticated;
revoke all on function core._dep_worker_view(jsonb, text) from public, anon, authenticated;
revoke all on function core._dep_payload_from(jsonb) from public, anon, authenticated;
revoke all on function core._dep_filter_payload(jsonb, date) from public, anon, authenticated;
revoke all on function core.dep_push() from public, anon, authenticated;
do $$
declare f text;
begin
    foreach f in array array[
        'core.dep_board(text, date, date)', 'core.dep_save_day(text, date, jsonb, integer)', 'core.dep_discard_day(text, date)',
        'core.dep_publish(text, date, integer)', 'core.dep_copy_day(text, date, date)', 'core.dep_save_template(text, text, date)',
        'core.dep_apply_template(text, uuid, date)', 'core.dep_delete_template(text, uuid)', 'core.dep_my(text)',
        'core.dep_mark_seen(text, date)', 'core.dep_crew(text, date)'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
end $$;
grant execute on all functions in schema core to service_role;
