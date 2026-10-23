-- AKK Hub — Deployment: night shifts and an END DATE per site / per worker.
--   · end_plus (0..2) = how many days after the planned day the shift ENDS (night shift 20:00 → 06:00 = +1).
--     Stored as an offset so copying a day / a template moves the end date with it.
--   · a worker can no longer be double-booked ACROSS days (24th night shift into the 25th morning).
--   · workers' deployments, the crew view, notifications and the ID-card "deployed today" check understand it.
-- Idempotent. Depends on 70_deployment.sql and 91_cards.sql.

alter table core.deployment_sites add column if not exists end_plus smallint not null default 0;
alter table core.deployment_assignments add column if not exists end_plus smallint not null default 0;
alter table core.deployment_assignments add column if not exists day date;

update core.deployment_assignments a set day = d.day from core.deployment_days d where d.id = a.day_id and a.day is null;

create or replace function core._dep_set_assignment_day()
returns trigger language plpgsql as $$
begin
    select d.day into new.day from core.deployment_days d where d.id = new.day_id;
    return new;
end;
$$;
drop trigger if exists deployment_assignment_day on core.deployment_assignments;
create trigger deployment_assignment_day before insert or update of day_id on core.deployment_assignments
    for each row execute function core._dep_set_assignment_day();
alter table core.deployment_assignments alter column day set not null;

do $$
declare c text;
begin
    for c in select conname from pg_constraint
              where conrelid in ('core.deployment_sites'::regclass, 'core.deployment_assignments'::regclass)
                and contype = 'c' and pg_get_constraintdef(oid) = 'CHECK ((end_time > start_time))' loop
        execute format('alter table %s drop constraint %I',
                       (select conrelid::regclass::text from pg_constraint where conname = c limit 1), c);
    end loop;
end $$;
alter table core.deployment_sites drop constraint if exists deployment_sites_end_ck;
alter table core.deployment_sites add constraint deployment_sites_end_ck
    check (end_plus between 0 and 2 and (end_plus > 0 or end_time > start_time));
alter table core.deployment_assignments drop constraint if exists deployment_assignments_end_ck;
alter table core.deployment_assignments add constraint deployment_assignments_end_ck
    check (end_plus between 0 and 2 and (end_plus > 0 or end_time > start_time));

-- Overlap across the whole timeline (not only inside one day): a worker is one place at a time.
alter table core.deployment_assignments drop constraint if exists deployment_no_double_booking;
alter table core.deployment_assignments add constraint deployment_no_double_booking exclude using gist (
    employee_id with =,
    tsrange((day + start_time), ((day + end_time) + make_interval(days => end_plus::int))) with &&);

CREATE OR REPLACE FUNCTION core._dep_day_json(p_day_id uuid, p_foreign_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'core'
AS $function$
    select jsonb_build_object(
        'id', d.id, 'day', d.day, 'status', d.status, 'version', d.version, 'rev', d.rev, 'dirty', d.dirty,
        'notes', d.notes, 'updated_at', d.updated_at, 'updated_by', d.updated_by,
        'published_at', d.published_at, 'published_by', d.published_by,
        'sites', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', s.id, 'place_id', s.place_id, 'place_name', p.name,
                'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'), 'end_plus', s.end_plus,
                'team_lead', case when p_foreign_only and exists (select 1 from attendance.local_worker_details l where l.employee_id = s.team_lead) then null else s.team_lead end,
                'vehicle_id', s.vehicle_id,
                'driver_id', case when p_foreign_only and exists (select 1 from attendance.local_worker_details l where l.employee_id = s.driver_id) then null else s.driver_id end,
                'job_ref', s.job_ref, 'notes', s.notes,
                'crew', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'employee_id', a.employee_id, 'name', w.name,
                        'start_time', to_char(a.start_time, 'HH24:MI'), 'end_time', to_char(a.end_time, 'HH24:MI'), 'end_plus', a.end_plus,
                        'leave_override', a.leave_override, 'seen_at', a.seen_at) order by w.name)
                      from core.deployment_assignments a
                      left join core._dep_workers() w on w.employee_id = a.employee_id
                     where a.site_row_id = s.id
                       and (not p_foreign_only or exists (select 1 from attendance.worker_details fd where fd.employee_id = a.employee_id))), '[]'::jsonb)
            ) order by s.sort, p.name)
              from core.deployment_sites s join core.sites p on p.id = s.place_id
             where s.day_id = d.id), '[]'::jsonb))
      from core.deployment_days d where d.id = p_day_id;
$function$;

CREATE OR REPLACE FUNCTION core._dep_payload_from(p_day_json jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select jsonb_build_object(
        'notes', p_day_json -> 'notes',
        'sites', coalesce((select jsonb_agg(jsonb_build_object(
                    'place_id', s -> 'place_id', 'start_time', s -> 'start_time', 'end_time', s -> 'end_time', 'end_plus', coalesce(s -> 'end_plus', '0'::jsonb),
                    'team_lead', s -> 'team_lead', 'vehicle_id', s -> 'vehicle_id', 'driver_id', s -> 'driver_id',
                    'job_ref', s -> 'job_ref', 'notes', s -> 'notes',
                    'crew', coalesce((select jsonb_agg(jsonb_build_object(
                                'employee_id', c -> 'employee_id', 'start_time', c -> 'start_time', 'end_time', c -> 'end_time', 'end_plus', coalesce(c -> 'end_plus', '0'::jsonb)))
                              from jsonb_array_elements(s -> 'crew') c), '[]'::jsonb)))
                  from jsonb_array_elements(coalesce(p_day_json -> 'sites', '[]'::jsonb)) s), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION core._dep_worker_view(p_snapshot jsonb, p_employee text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
               'place', s ->> 'place_name', 'start', c ->> 'start_time', 'end', c ->> 'end_time', 'end_plus', coalesce(c ->> 'end_plus', '0'),
               'lead', s ->> 'team_lead', 'vehicle', s ->> 'vehicle_id', 'driver', s ->> 'driver_id',
               'job_ref', s ->> 'job_ref', 'notes', s ->> 'notes',
               'crew', (select jsonb_agg(c2 ->> 'employee_id' order by c2 ->> 'employee_id') from jsonb_array_elements(s -> 'crew') c2))
             order by c ->> 'start_time'), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_snapshot -> 'sites', '[]'::jsonb)) s,
           jsonb_array_elements(coalesce(s -> 'crew', '[]'::jsonb)) c
     where c ->> 'employee_id' = p_employee;
$function$;

CREATE OR REPLACE FUNCTION core.dep_crew(p_token text, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'core'
AS $function$
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
            'place', s ->> 'place_name', 'start', s ->> 'start_time', 'end', s ->> 'end_time', 'end_plus', coalesce(s ->> 'end_plus', '0'), 'notes', s ->> 'notes',
            'lead', (select w.name from core._dep_workers() w where w.employee_id = s ->> 'team_lead' and (a.kind = 'admin' or w.worker_type = 'foreign')),
            'crew', (select jsonb_agg(jsonb_build_object(
                        'employee_id', c ->> 'employee_id', 'name', c ->> 'name',
                        'start', c ->> 'start_time', 'end', c ->> 'end_time', 'end_plus', coalesce(c ->> 'end_plus', '0'),
                        'clocked_in', exists (select 1 from attendance.shifts sh
                                               where sh.worker_id = c ->> 'employee_id' and sh.work_date = p_day and sh.entry_time is not null),
                        'clocked_site', (select ast2.site_name from attendance.shifts sh join attendance.sites ast2 on ast2.id = sh.site_id
                                          where sh.worker_id = c ->> 'employee_id' and sh.work_date = p_day order by sh.entry_time desc limit 1))
                      order by c ->> 'name')
                       from jsonb_array_elements(s -> 'crew') c
                      where a.kind = 'admin' or exists (select 1 from attendance.worker_details fd where fd.employee_id = c ->> 'employee_id'))))
          from jsonb_array_elements(v_snap -> 'sites') s
          join core.sites ps on ps.id = (s ->> 'place_id')::uuid
         where a.kind in ('admin', 'manager') or ps.attendance_site_id = a.site_id), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION core.dep_my(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'core'
AS $function$
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
                        'start', c ->> 'start_time', 'end', c ->> 'end_time', 'end_plus', coalesce(c ->> 'end_plus', '0'),
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
$function$;

CREATE OR REPLACE FUNCTION core.dep_publish(p_token text, p_day date, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core'
AS $function$
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
            select to_char(p_day, 'Dy DD Mon') || ': ' || string_agg((x ->> 'place') || ' ' || (x ->> 'start') || '–' || (x ->> 'end') || case when coalesce(x ->> 'end_plus', '0') <> '0' then ' (+' || (x ->> 'end_plus') || ' day)' else '' end, ', ')
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
$function$;

CREATE OR REPLACE FUNCTION core.dep_save_day(p_token text, p_day date, p_payload jsonb, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'extensions'
AS $function$
declare
    v_who text := core._dep_planner(p_token);
    v_fo boolean := core._dep_foreign_only(p_token);
    v_keep jsonb := '[]'::jsonb;
    k jsonb;
    v_row uuid;
    d core.deployment_days%rowtype;
    s jsonb;
    c jsonb;
    v_site uuid;
    v_sort int := 0;
    v_seen jsonb;
    v_start time;
    v_end time;
    v_endp int;
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
    select coalesce(jsonb_object_agg(a.employee_id || '|' || s2.place_id || '|' || a.start_time || '|' || a.end_time || '|' || a.end_plus, a.seen_at), '{}'::jsonb)
      into v_seen
      from core.deployment_assignments a join core.deployment_sites s2 on s2.id = a.site_row_id
     where a.day_id = d.id and a.seen_at is not null;

    -- A manager's plan never touches local workers an admin deployed: remember them, put them back.
    if v_fo then
        select coalesce(jsonb_agg(jsonb_build_object(
                   'place_id', s2.place_id, 's_start', s2.start_time, 's_end', s2.end_time, 's_endp', s2.end_plus, 'lead', s2.team_lead,
                   'vehicle', s2.vehicle_id, 'driver', s2.driver_id, 'job', s2.job_ref, 'notes', s2.notes,
                   'emp', a.employee_id, 'a_start', a.start_time, 'a_end', a.end_time, 'a_endp', a.end_plus, 'lo', a.leave_override, 'seen', a.seen_at)), '[]'::jsonb)
          into v_keep
          from core.deployment_assignments a join core.deployment_sites s2 on s2.id = a.site_row_id
         where a.day_id = d.id and exists (select 1 from attendance.local_worker_details l where l.employee_id = a.employee_id);
    end if;

    delete from core.deployment_sites where day_id = d.id;

    for s in select * from jsonb_array_elements(coalesce(p_payload -> 'sites', '[]'::jsonb)) loop
        v_sort := v_sort + 1;
        if not exists (select 1 from core.sites p join attendance.sites a on a.id = p.attendance_site_id
                        where p.id = (s ->> 'place_id')::uuid and a.is_active) then
            raise exception 'One of the sites is not an active Attendance site';
        end if;
        insert into core.deployment_sites (day_id, place_id, start_time, end_time, end_plus, team_lead, vehicle_id, driver_id, job_ref, notes, sort)
        values (d.id, (s ->> 'place_id')::uuid, (s ->> 'start_time')::time, (s ->> 'end_time')::time, coalesce(nullif(s ->> 'end_plus', '')::int, 0),
                nullif(s ->> 'team_lead', ''), nullif(s ->> 'vehicle_id', '')::uuid, nullif(s ->> 'driver_id', ''),
                nullif(trim(s ->> 'job_ref'), ''), nullif(trim(s ->> 'notes'), ''), v_sort)
        returning id into v_site;

        for c in select * from jsonb_array_elements(coalesce(s -> 'crew', '[]'::jsonb)) loop
            select w.name into v_name from core._dep_workers() w
             where w.employee_id = c ->> 'employee_id' and w.in_company and (not v_fo or w.worker_type = 'foreign');
            if v_name is null then
                raise exception 'Worker % can''t be deployed (not employed, or not a foreign worker)', c ->> 'employee_id';
            end if;
            if core._dep_on_leave(c ->> 'employee_id', p_day) and not coalesce((c ->> 'leave_override')::boolean, false) then
                raise exception '% is on approved leave on %', v_name, to_char(p_day, 'DD Mon');
            end if;
            v_start := coalesce(nullif(c ->> 'start_time', '')::time, (s ->> 'start_time')::time);
            v_end := coalesce(nullif(c ->> 'end_time', '')::time, (s ->> 'end_time')::time);
            v_endp := coalesce(nullif(c ->> 'end_plus', '')::int, nullif(s ->> 'end_plus', '')::int, 0);
            if v_endp not between 0 and 2 then
                raise exception 'A shift can end on the same day or up to 2 days later';
            end if;
            begin
                insert into core.deployment_assignments (day_id, site_row_id, employee_id, start_time, end_time, end_plus, leave_override, seen_at)
                values (d.id, v_site, c ->> 'employee_id', v_start, v_end, v_endp, coalesce((c ->> 'leave_override')::boolean, false),
                        (v_seen ->> ((c ->> 'employee_id') || '|' || (s ->> 'place_id') || '|' || v_start || '|' || v_end || '|' || v_endp))::timestamptz);
            exception when exclusion_violation then
                raise exception '% is booked twice at overlapping times', v_name;
            end;
        end loop;
    end loop;

    for k in select * from jsonb_array_elements(v_keep) loop
        select id into v_row from core.deployment_sites where day_id = d.id and place_id = (k ->> 'place_id')::uuid order by sort limit 1;
        if v_row is null then
            v_sort := v_sort + 1;
            insert into core.deployment_sites (day_id, place_id, start_time, end_time, end_plus, team_lead, vehicle_id, driver_id, job_ref, notes, sort)
            values (d.id, (k ->> 'place_id')::uuid, (k ->> 's_start')::time, (k ->> 's_end')::time, coalesce((k ->> 's_endp')::int, 0),
                    case when exists (select 1 from attendance.local_worker_details l where l.employee_id = k ->> 'lead') then k ->> 'lead' end,
                    nullif(k ->> 'vehicle', '')::uuid,
                    case when exists (select 1 from attendance.local_worker_details l where l.employee_id = k ->> 'driver') then k ->> 'driver' end,
                    k ->> 'job', k ->> 'notes', v_sort)
            returning id into v_row;
        else
            update core.deployment_sites set team_lead = k ->> 'lead'
             where id = v_row and team_lead is null and exists (select 1 from attendance.local_worker_details l where l.employee_id = k ->> 'lead');
        end if;
        begin
            insert into core.deployment_assignments (day_id, site_row_id, employee_id, start_time, end_time, end_plus, leave_override, seen_at)
            values (d.id, v_row, k ->> 'emp', (k ->> 'a_start')::time, (k ->> 'a_end')::time, coalesce((k ->> 'a_endp')::int, 0), coalesce((k ->> 'lo')::boolean, false), nullif(k ->> 'seen', '')::timestamptz);
        exception when exclusion_violation then
            null; -- an admin-deployed local worker never blocks a manager's save
        end;
    end loop;

    update core.deployment_days
       set notes = nullif(trim(p_payload ->> 'notes'), ''), rev = rev + 1, dirty = true,
           updated_at = now(), updated_by = v_who
     where id = d.id;
    return core._dep_day_json(d.id, v_fo);
exception when check_violation then
    raise exception 'The end must be after the start — for a night shift, set the end date to the next day';
end;
$function$;

create or replace function core._card_today(p_emp text)
returns jsonb
language sql stable security definer set search_path = core as $$
    select jsonb_build_object(
        'plan_published', exists (select 1 from core.deployment_days d where d.day = core._sg_today() and d.status = 'published'),
        'deployment', (select jsonb_build_object('place_id', ds.place_id, 'place', s.name, 'start', a.start_time, 'end', a.end_time)
                         from core.deployment_days d
                         join core.deployment_assignments a on a.day_id = d.id
                         join core.deployment_sites ds on ds.id = a.site_row_id
                         left join core.sites s on s.id = ds.place_id
                        where d.status = 'published' and a.employee_id = p_emp
                          and (d.day = core._sg_today()
                               or (d.day = core._sg_today() - 1 and a.end_plus > 0
                                   and (now() at time zone 'Asia/Singapore') < (d.day + a.end_time) + make_interval(days => a.end_plus::int)))
                        order by d.day desc
                        limit 1),
        'shift', (select jsonb_build_object('id', sh.id, 'site_id', sh.site_id, 'site', st.site_name, 'entry_time', sh.entry_time,
                                            'work_date', sh.work_date,
                                            'on_break', exists (select 1 from attendance.breaks br where br.shift_id = sh.id and br.break_end is null))
                    from attendance.shifts sh left join attendance.sites st on st.id = sh.site_id
                   where sh.worker_id = p_emp and not coalesce(sh.has_left, false)
                   order by sh.entry_time desc limit 1),
        'vehicle', (select jsonb_build_object('vehicle', v.vehicle_number, 'status', j.status, 'started_at', j.started_at)
                      from attendance.vehicle_journeys j left join attendance.vehicles v on v.id = j.vehicle_id
                     where j.worker_id = p_emp and j.status in ('active', 'on_break')
                     order by j.started_at desc limit 1)
    );
$$;
