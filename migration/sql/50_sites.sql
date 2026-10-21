-- =====================================================================================
-- AKK Hub — one Sites list ("places"). core.sites links each place to its Attendance /
-- Materials / Site work row; these admin functions list, edit, tick areas and merge.
-- Area rows stay where they are (each area keeps reading its own table). Turning an area off:
--   · no records there  → the area row is removed
--   · has records       → the row is kept and marked inactive (history keeps its site name)
-- =====================================================================================
alter table attendance.sites add column if not exists is_active boolean not null default true;
alter table materials.sites add column if not exists is_active boolean not null default true;

create or replace function core.admin_list_places()
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
        select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'attendance', (select jsonb_build_object(
                    'id', a.id, 'latitude', a.latitude, 'longitude', a.longitude, 'qr_token', a.qr_token,
                    'is_active', a.is_active,
                    'shifts', (select count(*) from attendance.shifts x where x.site_id = a.id),
                    'supervisors', (select count(*) from attendance.supervisors x where x.site_id = a.id))
                  from attendance.sites a where a.id = s.attendance_site_id),
            'materials', (select jsonb_build_object(
                    'id', m.id, 'is_active', m.is_active,
                    'requests', (select count(*) from materials.transactions x where x.site_id = m.id))
                  from materials.sites m where m.id = s.materials_site_id),
            'progress', (select jsonb_build_object(
                    'id', p.id, 'is_active', p.is_active, 'section_label', p.section_label,
                    'packages', (select count(*) from progress.packages x where x.site_id = p.id),
                    'jsrs', (select count(*) from progress.jsrs x where x.site_id = p.id))
                  from progress.sites p where p.id = s.progress_site_id)
        ) order by s.name)
        from core.sites s), '[]'::jsonb);
end;
$$;

-- p_areas: { attendance: {on, latitude, longitude, qr_token}, materials: {on}, progress: {on, section_label} }
create or replace function core.admin_save_place(p_id uuid, p_name text, p_areas jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = core, extensions
as $$
declare
    v_name text := trim(coalesce(p_name, ''));
    v_id uuid := p_id;
    s core.sites%rowtype;
    a jsonb := coalesce(p_areas -> 'attendance', '{}'::jsonb);
    m jsonb := coalesce(p_areas -> 'materials', '{}'::jsonb);
    p jsonb := coalesce(p_areas -> 'progress', '{}'::jsonb);
    v_new text;
    v_lat numeric;
    v_lng numeric;
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    if v_name = '' then
        raise exception 'Site name is required';
    end if;

    if v_id is null then
        insert into core.sites (name) values (v_name) returning id into v_id;
    else
        update core.sites set name = v_name where id = v_id;
        if not found then raise exception 'Site not found'; end if;
    end if;
    select * into s from core.sites where id = v_id;

    -- Attendance (location + QR) ------------------------------------------------------
    v_lat := nullif(trim(coalesce(a ->> 'latitude', '')), '')::numeric;
    v_lng := nullif(trim(coalesce(a ->> 'longitude', '')), '')::numeric;
    if coalesce((a ->> 'on')::boolean, false) then
        if s.attendance_site_id is null then
            v_new := gen_random_uuid()::text;
            insert into attendance.sites (id, site_name, latitude, longitude, qr_token, is_active)
            values (v_new, v_name, v_lat, v_lng, coalesce(nullif(trim(a ->> 'qr_token'), ''), gen_random_uuid()::text), true);
            update core.sites set attendance_site_id = v_new where id = v_id;
        else
            update attendance.sites set site_name = v_name, latitude = v_lat, longitude = v_lng,
                   qr_token = coalesce(nullif(trim(a ->> 'qr_token'), ''), qr_token), is_active = true
             where id = s.attendance_site_id;
        end if;
    elsif s.attendance_site_id is not null then
        if exists (select 1 from attendance.shifts x where x.site_id = s.attendance_site_id)
           or exists (select 1 from attendance.supervisors x where x.site_id = s.attendance_site_id) then
            update attendance.sites set site_name = v_name, is_active = false where id = s.attendance_site_id;
        else
            update core.sites set attendance_site_id = null where id = v_id;
            delete from attendance.sites where id = s.attendance_site_id;
        end if;
    end if;

    -- Materials (just a name to pick) -------------------------------------------------
    if coalesce((m ->> 'on')::boolean, false) then
        if s.materials_site_id is null then
            insert into materials.sites (name, is_active) values (v_name, true) returning id into s.materials_site_id;
            update core.sites set materials_site_id = s.materials_site_id where id = v_id;
        else
            update materials.sites set name = v_name, is_active = true where id = s.materials_site_id;
        end if;
    elsif s.materials_site_id is not null then
        if exists (select 1 from materials.transactions x where x.site_id = s.materials_site_id) then
            update materials.sites set name = v_name, is_active = false where id = s.materials_site_id;
        else
            update core.sites set materials_site_id = null where id = v_id;
            delete from materials.sites where id = s.materials_site_id;
        end if;
    end if;

    -- Site work (photo packages; section prefixes are edited in "Section prefixes") ----
    if coalesce((p ->> 'on')::boolean, false) then
        if s.progress_site_id is null then
            insert into progress.sites (name, is_active, section_label)
            values (v_name, true, coalesce(nullif(trim(p ->> 'section_label'), ''), 'LCB')) returning id into s.progress_site_id;
            update core.sites set progress_site_id = s.progress_site_id where id = v_id;
        else
            update progress.sites set name = v_name, is_active = true,
                   section_label = case when p ? 'section_label' then coalesce(nullif(trim(p ->> 'section_label'), ''), 'LCB') else section_label end
             where id = s.progress_site_id;
        end if;
    elsif s.progress_site_id is not null then
        if exists (select 1 from progress.packages x where x.site_id = s.progress_site_id)
           or exists (select 1 from progress.jsrs x where x.site_id = s.progress_site_id) then
            update progress.sites set name = v_name, is_active = false where id = s.progress_site_id;
        else
            update core.sites set progress_site_id = null where id = v_id;
            delete from progress.sites where id = s.progress_site_id;
        end if;
    end if;

    -- A place used nowhere and with nothing recorded goes away.
    if exists (select 1 from core.sites c where c.id = v_id
                and c.attendance_site_id is null and c.materials_site_id is null and c.progress_site_id is null)
       and p_id is not null then
        delete from core.sites where id = v_id;
        return null;
    end if;
    return v_id;
exception when unique_violation then
    raise exception 'A site with that name already exists in one of the areas — merge them instead.';
end;
$$;

-- Join two places into one: every record of p_remove moves to p_keep.
create or replace function core.admin_merge_places(p_keep uuid, p_remove uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    k core.sites%rowtype;
    r core.sites%rowtype;
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    if p_keep = p_remove then
        raise exception 'Pick two different sites';
    end if;
    select * into k from core.sites where id = p_keep;
    select * into r from core.sites where id = p_remove;
    if k.id is null or r.id is null then
        raise exception 'Site not found';
    end if;

    -- Detach the second place first (unique links), then fold its rows in.
    update core.sites set attendance_site_id = null, materials_site_id = null, progress_site_id = null where id = r.id;

    if r.attendance_site_id is not null then
        if k.attendance_site_id is null then
            update core.sites set attendance_site_id = r.attendance_site_id where id = k.id;
        else
            update attendance.shifts set site_id = k.attendance_site_id where site_id = r.attendance_site_id;
            update attendance.leave_blackout_dates set site_id = k.attendance_site_id where site_id = r.attendance_site_id;
            update attendance.leave_requests set site_id = k.attendance_site_id::uuid
             where site_id::text = r.attendance_site_id and k.attendance_site_id ~* '^[0-9a-f-]{36}$';
            update attendance.supervisors set site_id = k.attendance_site_id where site_id = r.attendance_site_id;
            delete from attendance.sites where id = r.attendance_site_id;
        end if;
    end if;
    if r.materials_site_id is not null then
        if k.materials_site_id is null then
            update core.sites set materials_site_id = r.materials_site_id where id = k.id;
        else
            update materials.transactions set site_id = k.materials_site_id where site_id = r.materials_site_id;
            delete from materials.sites where id = r.materials_site_id;
        end if;
    end if;
    if r.progress_site_id is not null then
        if k.progress_site_id is null then
            update core.sites set progress_site_id = r.progress_site_id where id = k.id;
        else
            update progress.packages set site_id = k.progress_site_id where site_id = r.progress_site_id;
            update progress.jsrs set site_id = k.progress_site_id where site_id = r.progress_site_id;
            update progress.site_options set site_id = k.progress_site_id where site_id = r.progress_site_id;
            delete from progress.sites where id = r.progress_site_id;
        end if;
    end if;

    delete from core.sites where id = r.id;
    return k.id;
end;
$$;

revoke all on function core.admin_list_places() from public, anon, authenticated;
revoke all on function core.admin_save_place(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function core.admin_merge_places(uuid, uuid) from public, anon, authenticated;
grant execute on function core.admin_list_places() to authenticated;
grant execute on function core.admin_save_place(uuid, text, jsonb) to authenticated;
grant execute on function core.admin_merge_places(uuid, uuid) to authenticated;
grant execute on all functions in schema core to service_role;

-- =====================================================================================
-- One employee record: the Attendance worker's NAME is the master. Materials requesters and
-- Site-work users carrying the same ID follow it, now and whenever an admin renames the worker.
-- (Records already made keep the name they were made under — e.g. materials.transactions.worker_name.)
-- =====================================================================================
create or replace function core.sync_worker_name()
returns trigger
language plpgsql
security definer
set search_path = core
as $$
begin
    if NEW.employee_name is distinct from OLD.employee_name and nullif(trim(NEW.employee_name::text), '') is not null then
        update materials.requesters set name = trim(NEW.employee_name::text)
         where requester_id = NEW.employee_id::text and name is distinct from trim(NEW.employee_name::text);
        update progress.app_users set display_name = trim(NEW.employee_name::text)
         where employee_code = NEW.employee_id::text and display_name is distinct from trim(NEW.employee_name::text);
    end if;
    return NEW;
end;
$$;
revoke all on function core.sync_worker_name() from public, anon, authenticated;

drop trigger if exists sync_worker_name on attendance.worker_details;
create trigger sync_worker_name after update of employee_name on attendance.worker_details
    for each row execute function core.sync_worker_name();
drop trigger if exists sync_worker_name on attendance.local_worker_details;
create trigger sync_worker_name after update of employee_name on attendance.local_worker_details
    for each row execute function core.sync_worker_name();
