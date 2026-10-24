-- AKK Hub — every hub admin is an admin in Materials and Site work too (decided 2026-10-24).
--   · now: every core.attendance_admins account gets an active progress.admin_profiles row and the 'admin'
--     role in materials.staff_profiles (manager role kept).
--   · from now on a trigger keeps it so: hub admin added → admin everywhere; hub admin removed → Materials /
--     Site work admin switched off as well (manager access, if any, stays).
-- Idempotent. Depends on 20_core.sql (core.attendance_admins) and the materials / progress schemas.

create or replace function core._admin_everywhere(p_user_id uuid, p_grant boolean)
returns void
language plpgsql
security definer
set search_path to 'core'
as $$
declare
    u record;
    v_name text;
begin
    select id, lower(email) email, raw_user_meta_data m into u from auth.users where id = p_user_id;
    if u.id is null then
        return;
    end if;
    v_name := coalesce(nullif(trim(u.m ->> 'display_name'), ''), nullif(trim(u.m ->> 'name'), ''), split_part(coalesce(u.email, ''), '@', 1), 'Admin');

    if p_grant then
        insert into progress.admin_profiles (user_id, display_name, email, is_active)
        values (u.id, v_name, coalesce(u.email, ''), true)
        on conflict (user_id) do update set is_active = true;

        insert into materials.staff_profiles (user_id, display_name, email, role, roles, is_active)
        values (u.id, v_name, coalesce(u.email, ''), 'admin', array['admin'], true)
        on conflict (user_id) do update
            set roles = (select array_agg(distinct r order by r) from unnest(materials.staff_profiles.roles || array['admin']) r),
                role = 'admin',
                is_active = true,
                updated_at = now();
    else
        update progress.admin_profiles set is_active = false where user_id = u.id;
        -- keep a manager role; an admin-only profile is switched off (roles may not be empty)
        update materials.staff_profiles s
           set roles = case when 'manager' = any (s.roles) then array['manager'] else s.roles end,
               role = case when 'manager' = any (s.roles) then 'manager' else s.role end,
               is_active = case when 'manager' = any (s.roles) then s.is_active else false end,
               updated_at = now()
         where s.user_id = u.id and 'admin' = any (s.roles);
    end if;
end;
$$;
revoke all on function core._admin_everywhere(uuid, boolean) from public, anon, authenticated;

create or replace function core._attendance_admins_sync()
returns trigger
language plpgsql
security definer
set search_path to 'core'
as $$
begin
    if tg_op = 'INSERT' then
        perform core._admin_everywhere(new.user_id, true);
        return new;
    end if;
    -- deleted: only switch off if the account is not (still / again) a hub admin
    if not exists (select 1 from core.attendance_admins where user_id = old.user_id) then
        perform core._admin_everywhere(old.user_id, false);
    end if;
    return old;
end;
$$;
revoke all on function core._attendance_admins_sync() from public, anon, authenticated;

drop trigger if exists attendance_admins_everywhere on core.attendance_admins;
create trigger attendance_admins_everywhere
    after insert or delete on core.attendance_admins
    for each row execute function core._attendance_admins_sync();

-- bring every current hub admin up to date
do $$
declare r record;
begin
    for r in select user_id from core.attendance_admins loop
        perform core._admin_everywhere(r.user_id, true);
    end loop;
end $$;
