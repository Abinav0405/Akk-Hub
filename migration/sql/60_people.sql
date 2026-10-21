-- =====================================================================================
-- AKK Hub — employee photos (passport-style, ID card). One small JPEG per employee
-- (resized on the device to ~360×450, stored as a data URL; ~30–60 KB). Admins set it from
-- worker details; a worker can set their own from Account (with their hub session).
-- =====================================================================================
create table if not exists core.worker_photos (
    employee_id text primary key,
    photo text not null,
    updated_at timestamptz not null default now(),
    updated_by text
);
alter table core.worker_photos enable row level security;
revoke all on core.worker_photos from public, anon, authenticated;
grant all on core.worker_photos to service_role;

create or replace function core._check_photo(p_photo text)
returns void
language plpgsql
immutable
as $$
begin
    if p_photo is not null and (p_photo not like 'data:image/jpeg;base64,%' or length(p_photo) > 400000) then
        raise exception 'Photo must be a JPEG under 300 KB';
    end if;
end;
$$;

create or replace function core.admin_get_worker_photo(p_employee_id text)
returns text
language plpgsql
stable
security definer
set search_path = core
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return (select photo from core.worker_photos where employee_id = trim(p_employee_id));
end;
$$;

create or replace function core.admin_set_worker_photo(p_employee_id text, p_photo text)
returns void
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    v_id text := trim(p_employee_id);
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    perform core._check_photo(p_photo);
    if not exists (select 1 from attendance.worker_details where employee_id = v_id)
       and not exists (select 1 from attendance.local_worker_details where employee_id = v_id) then
        raise exception 'Worker not found';
    end if;
    if p_photo is null then
        delete from core.worker_photos where employee_id = v_id;
    else
        insert into core.worker_photos (employee_id, photo, updated_at, updated_by)
        values (v_id, p_photo, now(), coalesce(auth.jwt() ->> 'email', auth.uid()::text))
        on conflict (employee_id) do update set photo = excluded.photo, updated_at = now(), updated_by = excluded.updated_by;
    end if;
end;
$$;

-- The signed-in worker's own photo (hub session token).
create or replace function core.my_photo(p_session_token text)
returns text
language sql
stable
security definer
set search_path = core
as $$
    select p.photo from core.hub_worker_from_session(p_session_token) w
      join core.worker_photos p on p.employee_id = w.employee_id;
$$;

create or replace function core.set_my_photo(p_session_token text, p_photo text)
returns void
language plpgsql
volatile
security definer
set search_path = core
as $$
declare
    v_id text;
begin
    select w.employee_id into v_id from core.hub_worker_from_session(p_session_token) w;
    if v_id is null then
        raise exception 'Session expired. Please log in again.';
    end if;
    perform core._check_photo(p_photo);
    if p_photo is null then
        delete from core.worker_photos where employee_id = v_id;
    else
        insert into core.worker_photos (employee_id, photo, updated_at, updated_by)
        values (v_id, p_photo, now(), 'self')
        on conflict (employee_id) do update set photo = excluded.photo, updated_at = now(), updated_by = 'self';
    end if;
end;
$$;

revoke all on function core._check_photo(text) from public, anon, authenticated;
revoke all on function core.admin_get_worker_photo(text) from public, anon, authenticated;
revoke all on function core.admin_set_worker_photo(text, text) from public, anon, authenticated;
revoke all on function core.my_photo(text) from public, anon, authenticated;
revoke all on function core.set_my_photo(text, text) from public, anon, authenticated;
grant execute on function core.admin_get_worker_photo(text) to authenticated;
grant execute on function core.admin_set_worker_photo(text, text) to authenticated;
grant execute on function core.my_photo(text) to anon, authenticated;
grant execute on function core.set_my_photo(text, text) to anon, authenticated;
grant execute on all functions in schema core to service_role;
