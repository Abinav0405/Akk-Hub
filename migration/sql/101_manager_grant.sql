-- AKK Hub — Managers page: "give access" to an area a manager is missing from, KEEPING their password.
-- All three areas store bcrypt ($2a$), so the stored hash is copied across — nobody sees or retypes a password.
--   source of the password, in order: hub login → Site work → Materials
--   · hub      → insert attendance.managers (hash kept as-is by hash_password_on_write)
--   · progress → progress.admin_create_manager (view-only JSR) then the copied hash
--   · materials→ the Supabase sign-in is created by the mat-manage-staff function first; for a FRESH
--                manager-only account the hash is copied in. An existing sign-in (e.g. an admin's) is never
--                given a different password.
-- Idempotent. Depends on 20_core.sql, 99_manager_update.sql (admin_staff_unban), 100_admins_everywhere.sql.

create or replace function core.admin_signin_exists(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'core'
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
end;
$$;
revoke all on function core.admin_signin_exists(text) from public, anon;
grant execute on function core.admin_signin_exists(text) to authenticated;

create or replace function core.admin_manager_grant(p_email text, p_area text)
returns text
language plpgsql
security definer
set search_path to 'core'
as $$
declare
    v_email text := lower(trim(coalesce(p_email, '')));
    v_hub attendance.managers%rowtype;
    v_site progress.manager_users%rowtype;
    v_user auth.users%rowtype;
    v_prof materials.staff_profiles%rowtype;
    v_name text;
    v_hash text;
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    if p_area not in ('hub', 'progress', 'materials') then
        raise exception 'Unknown area %', p_area;
    end if;

    select * into v_hub from attendance.managers where lower(email) = v_email limit 1;
    select * into v_site from progress.manager_users where lower(login_id) = v_email limit 1;
    select * into v_user from auth.users where lower(email) = v_email limit 1;
    if v_user.id is not null then
        select * into v_prof from materials.staff_profiles where user_id = v_user.id and is_active and 'manager' = any (roles);
    end if;
    if v_hub.id is null and v_site.id is null and v_prof.user_id is null then
        raise exception '% is not a manager anywhere yet — use Add manager', v_email;
    end if;
    v_name := coalesce(v_hub.name, v_site.display_name, v_prof.display_name, split_part(v_email, '@', 1));

    -- the password they already use (never the area being added)
    v_hash := case
        when p_area <> 'hub' and v_hub.password_hash like '$2%' then v_hub.password_hash
        when p_area <> 'progress' and v_site.password_hash like '$2%' then v_site.password_hash
        when p_area <> 'materials' and v_prof.user_id is not null and v_user.encrypted_password like '$2%' then v_user.encrypted_password
    end;

    if p_area = 'hub' then
        if v_hub.id is not null then return 'already'; end if;
        if v_hash is null then raise exception 'No password on file to copy — use Reset password'; end if;
        insert into attendance.managers (email, name, password_hash, created_at, updated_at)
        values (v_email, v_name, v_hash, now(), now());
        return 'added';
    end if;

    if p_area = 'progress' then
        if v_site.id is not null then return 'already'; end if;
        if v_hash is null then raise exception 'No password on file to copy — use Reset password'; end if;
        perform progress.admin_create_manager(v_email, v_name, gen_random_uuid()::text, null); -- view-only JSR
        update progress.manager_users set password_hash = v_hash where lower(login_id) = v_email;
        return 'added';
    end if;

    -- materials: the sign-in + manager profile must exist (created by the mat-manage-staff function)
    if v_prof.user_id is null then
        raise exception 'The Materials sign-in was not created';
    end if;
    perform core.admin_staff_unban(v_user.id);
    -- copy the password only into a brand-new, manager-only sign-in
    if v_hash is not null
       and v_prof.roles = array['manager']
       and v_user.created_at > now() - interval '15 minutes' then
        update auth.users set encrypted_password = v_hash, updated_at = now() where id = v_user.id;
        return 'added';
    end if;
    return 'added-own-password';
end;
$$;
revoke all on function core.admin_manager_grant(text, text) from public, anon;
grant execute on function core.admin_manager_grant(text, text) to authenticated;
