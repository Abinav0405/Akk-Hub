-- AKK Hub — one Managers page: Site work manager accounts can now be renamed / re-emailed by an admin,
-- so a manager keeps ONE email across the hub login, Materials and Site work.
-- Idempotent. Depends on the progress schema (manager_users, _require_admin).

create or replace function progress.admin_update_manager(p_manager_id uuid, p_login_id text, p_display_name text)
returns void
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_login text := lower(trim(coalesce(p_login_id, '')));
    v_name text := trim(coalesce(p_display_name, ''));
begin
    perform _require_admin();
    if v_login = '' or v_name = '' then
        raise exception 'Name and email are required';
    end if;
    if exists (select 1 from manager_users where lower(login_id) = v_login and id <> p_manager_id) then
        raise exception 'Another Site work manager already uses %', v_login;
    end if;
    update manager_users set login_id = v_login, display_name = v_name where id = p_manager_id;
    if not found then
        raise exception 'Manager not found';
    end if;
end;
$$;

revoke all on function progress.admin_update_manager(uuid, text, text) from public, anon;
grant execute on function progress.admin_update_manager(uuid, text, text) to authenticated;

-- Materials "remove manager" bans the sign-in; re-adding the same email reactivated the profile but left the
-- ban, so the manager could never sign in to Materials again. Lifts the ban for an ACTIVE manager profile only.
create or replace function core.admin_staff_unban(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'core'
as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    if not exists (
        select 1 from materials.staff_profiles s
         where s.user_id = p_user_id and s.is_active and 'manager' = any (s.roles)
    ) then
        raise exception 'Not an active manager';
    end if;
    update auth.users set banned_until = null where id = p_user_id and banned_until is not null;
    return found;
end;
$$;

revoke all on function core.admin_staff_unban(uuid) from public, anon;
grant execute on function core.admin_staff_unban(uuid) to authenticated;
