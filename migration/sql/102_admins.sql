-- AKK Hub — Admins page: list hub admins, make an account an admin, reset an admin's password, remove admin.
-- Hub admins = core.attendance_admins; 100_admins_everywhere.sql's trigger keeps Materials / Site work admin
-- in step. Every function requires a hub admin caller. Passwords are stored bcrypt (same as the rest).
-- Idempotent. Depends on 20_core.sql, 100_admins_everywhere.sql.

create or replace function core.admin_list_admins()
returns table (user_id uuid, email text, name text, added_at timestamptz, last_sign_in_at timestamptz,
               is_self boolean, materials_admin boolean, site_admin boolean, manager_areas text[])
language plpgsql
stable
security definer
set search_path to 'core'
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return query
        select u.id, lower(u.email)::text,
               coalesce(nullif(trim(s.display_name), ''), nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
                        nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(u.email, '@', 1))::text,
               a.added_at, u.last_sign_in_at, u.id = auth.uid(),
               coalesce(s.is_active and 'admin' = any (s.roles), false),
               exists (select 1 from progress.admin_profiles p where p.user_id = u.id and p.is_active),
               array_remove(array[
                   case when exists (select 1 from attendance.managers m where lower(m.email) = lower(u.email)) then 'hub' end,
                   case when s.is_active and 'manager' = any (s.roles) then 'materials' end,
                   case when exists (select 1 from progress.manager_users m where lower(m.login_id) = lower(u.email)) then 'progress' end
               ], null)
          from core.attendance_admins a
          join auth.users u on u.id = a.user_id
          left join materials.staff_profiles s on s.user_id = u.id
         order by 3;
end;
$$;
revoke all on function core.admin_list_admins() from public, anon;
grant execute on function core.admin_list_admins() to authenticated;

-- Make an existing sign-in account a hub admin (→ admin in every area). p_admin_only: a brand-new account
-- the page just created through the Materials staff function starts as a Materials manager — drop that.
create or replace function core.admin_grant_admin(p_email text, p_admin_only boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'core'
as $$
declare
    v_id uuid;
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    select id into v_id from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
    if v_id is null then
        raise exception 'No sign-in account for % — enter a password to create one', lower(trim(p_email));
    end if;
    insert into core.attendance_admins (user_id) values (v_id) on conflict do nothing;
    -- trigger has run; make sure every area is in step even if the row already existed
    perform core._admin_everywhere(v_id, true);
    if p_admin_only then
        update materials.staff_profiles set roles = array['admin'], role = 'admin', updated_at = now()
         where user_id = v_id and 'manager' = any (roles)
           and not exists (select 1 from attendance.managers m join auth.users u on lower(u.email) = lower(m.email) where u.id = v_id)
           and not exists (select 1 from progress.manager_users m join auth.users u on lower(u.email) = lower(m.login_id) where u.id = v_id);
    end if;
    return v_id;
end;
$$;
revoke all on function core.admin_grant_admin(text, boolean) from public, anon;
grant execute on function core.admin_grant_admin(text, boolean) to authenticated;

-- New password for a hub admin. Also applied to their manager logins (hub / Site work) so it stays ONE password.
-- Someone else's reset signs them out on their other devices.
create or replace function core.admin_set_admin_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path to 'core'
as $$
declare
    v_email text;
    v_hash text;
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    if not exists (select 1 from core.attendance_admins where user_id = p_user_id) then
        raise exception 'Not a hub admin — reset a manager''s password on the Managers page';
    end if;
    if p_password is null or length(p_password) < 8 then
        raise exception 'The password must be at least 8 characters';
    end if;
    select lower(email) into v_email from auth.users where id = p_user_id;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));
    update auth.users set encrypted_password = v_hash, updated_at = now() where id = p_user_id;
    update attendance.managers set password_hash = v_hash, updated_at = now() where lower(email) = v_email;
    update progress.manager_users set password_hash = v_hash where lower(login_id) = v_email;
    if p_user_id <> auth.uid() then
        delete from auth.sessions where user_id = p_user_id;
    end if;
end;
$$;
revoke all on function core.admin_set_admin_password(uuid, text) from public, anon;
grant execute on function core.admin_set_admin_password(uuid, text) to authenticated;

-- Remove hub admin (→ admin switched off in every area; manager access stays). Never yourself, never the last one.
create or replace function core.admin_revoke_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'core'
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    if p_user_id = auth.uid() then
        raise exception 'You cannot remove your own admin access';
    end if;
    if (select count(*) from core.attendance_admins) <= 1 then
        raise exception 'There must always be at least one admin';
    end if;
    delete from core.attendance_admins where user_id = p_user_id;
    if not found then
        raise exception 'Not a hub admin';
    end if;
    delete from auth.sessions where user_id = p_user_id;
end;
$$;
revoke all on function core.admin_revoke_admin(uuid) from public, anon;
grant execute on function core.admin_revoke_admin(uuid) to authenticated;
