-- AKK Hub — one hub login can be linked to SEVERAL employee IDs (e.g. 1047 and 1047r of the same person).
-- Each linked ID keeps its own card; the login picks which card to show. Idempotent; runs after 91.

do $$
begin
    if exists (select 1 from pg_constraint where conrelid = 'core.employee_links'::regclass and contype = 'p'
                  and pg_get_constraintdef(oid) = 'PRIMARY KEY (login)') then
        alter table core.employee_links drop constraint employee_links_pkey;
        alter table core.employee_links add primary key (login, employee_id);
    end if;
end $$;

-- Which linked employee a login holds: the asked one if linked, else the first employed, else the first.
create or replace function core._card_pick_holder(p_login text, p_emp text default null)
returns text
language sql stable security definer set search_path = core as $$
    select l.employee_id
      from core.employee_links l
     where l.login = lower(coalesce(p_login, ''))
     order by (l.employee_id = p_emp) desc,
              coalesce((select b.in_company from core._wi_base(l.employee_id) b), false) desc,
              l.employee_id
     limit 1;
$$;

create or replace function core._card_actor(p_token text)
returns table (kind text, who text, site_place uuid, holder_emp text)
language plpgsql stable security definer set search_path = core as $$
declare
    r record;
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    if p_token is not null and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select s.role, s.subject_id into r from attendance.role_sessions s
         where s.session_token = p_token::uuid and s.expires_at > now() and coalesce(s.session_kind, 'full') = 'full';
        if r.role = 'worker' then
            return query select 'worker'::text, r.subject_id::text, null::uuid, r.subject_id::text;
            return;
        elsif r.role = 'manager' then
            return query select 'manager'::text, r.subject_id::text, null::uuid, core._card_pick_holder(r.subject_id);
            return;
        elsif r.role = 'supervisor' then
            return query select 'supervisor'::text, r.subject_id::text,
                (select s.id from attendance.supervisors sv join core.sites s on s.attendance_site_id = sv.site_id
                  where sv.supervisor_id = r.subject_id and coalesce(sv.is_active, true) limit 1),
                core._card_pick_holder(r.subject_id);
            return;
        end if;
    end if;
    if core.is_hub_admin() then
        return query select 'admin'::text, coalesce(nullif(v_email, ''), auth.uid()::text), null::uuid, core._card_pick_holder(v_email);
        return;
    end if;
    if auth.uid() is not null and exists (select 1 from materials.staff_profiles sp where sp.user_id = auth.uid() and sp.is_active) then
        return query select 'staff'::text, coalesce(nullif(v_email, ''), auth.uid()::text), null::uuid, core._card_pick_holder(v_email);
        return;
    end if;
    return query select null::text, null::text, null::uuid, null::text;
end;
$$;

-- The employee whose card to show: workers → themselves; linked logins → p_emp if linked, else the default.
create or replace function core._card_holder(p_token text, p_emp text)
returns text
language plpgsql stable security definer set search_path = core as $$
declare a record;
begin
    select * into a from core._card_actor(p_token);
    if a.kind = 'worker' or a.kind is null then
        return a.holder_emp;
    end if;
    return coalesce(core._card_pick_holder(a.who, p_emp), a.holder_emp);
end;
$$;

drop function if exists core.my_card(text);
create or replace function core.my_card(p_token text default null, p_employee_id text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_emp text := core._card_holder(p_token, nullif(trim(coalesce(p_employee_id, '')), ''));
    v_card uuid;
begin
    if v_emp is null then
        return null;
    end if;
    v_card := core._card_ensure(v_emp);
    if v_card is null then
        select id into v_card from core.employee_cards where employee_id = v_emp order by issued_at desc limit 1;
    end if;
    if v_card is null then
        return null;
    end if;
    return core._card_payload(v_card, 'holder');
end;
$$;

-- Cards this login can show (switcher).
create or replace function core.my_card_choices(p_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare a record;
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or a.kind = 'worker' then
        return '[]'::jsonb;
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.employee_id, 'name', b.name, 'in_company', coalesce(b.in_company, false))
                                      order by coalesce(b.in_company, false) desc, l.employee_id)
                       from core.employee_links l left join core._wi_base(l.employee_id) b on true
                      where l.login = lower(a.who)), '[]'::jsonb);
end;
$$;

drop function if exists core.my_card_live_code(text);
create or replace function core.my_card_live_code(p_token text default null, p_employee_id text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_emp text := core._card_holder(p_token, nullif(trim(coalesce(p_employee_id, '')), ''));
    c core.employee_cards;
    v_ts bigint := extract(epoch from now())::bigint;
begin
    if v_emp is null then
        raise exception 'No card for this account';
    end if;
    select * into c from core.employee_cards where employee_id = v_emp and status = 'active';
    if c.id is null then
        raise exception 'No active card';
    end if;
    return jsonb_build_object(
        'code', 'AKK1L.' || replace(c.id::text, '-', '') || '.' || core._b36(v_ts) || '.' || core._card_sign(c.id, v_ts),
        'issued_at', to_timestamp(v_ts),
        'ttl_seconds', 120,
        'server_time', now());
end;
$$;

-- Admin: link a login to an employee (a login may now hold several employee IDs)
create or replace function core.admin_link_account(p_employee_id text, p_login text)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._card_admin();
    v_login text := lower(trim(coalesce(p_login, '')));
    v_emp text := trim(coalesce(p_employee_id, ''));
begin
    if not exists (select 1 from core._wi_base(v_emp)) then
        raise exception 'Worker not found';
    end if;
    if not exists (select 1 from core._hub_logins() h where h.login = v_login) then
        raise exception 'No manager / supervisor / admin login "%"', v_login;
    end if;
    insert into core.employee_links (login, employee_id, linked_by) values (v_login, v_emp, v_actor)
    on conflict (login, employee_id) do nothing;
    return core.admin_card_detail(v_emp);
end;
$$;

drop function if exists core.admin_unlink_account(text);
create or replace function core.admin_unlink_account(p_login text, p_employee_id text)
returns void
language plpgsql volatile security definer set search_path = core as $$
begin
    perform core._card_admin();
    delete from core.employee_links where login = lower(trim(coalesce(p_login, ''))) and employee_id = trim(coalesce(p_employee_id, ''));
end;
$$;

create or replace function core.admin_linkable_accounts()
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._card_admin();
    return coalesce((
        select jsonb_agg(jsonb_build_object('login', g.login, 'name', g.name, 'roles', g.roles, 'top_role', g.top,
                                            'employee_ids', coalesce((select jsonb_agg(l.employee_id order by l.employee_id) from core.employee_links l where l.login = g.login), '[]'::jsonb))
                         order by g.login)
          from (select h.login, max(nullif(h.name, '')) as name, jsonb_agg(distinct jsonb_build_object('area', h.area, 'role', h.role)) as roles,
                       (array_agg(h.role order by core._role_rank(h.role) desc))[1] as top
                  from core._hub_logins() h group by h.login) g
    ), '[]'::jsonb);
end;
$$;

do $$
declare f text;
begin
    foreach f in array array['core._card_pick_holder(text, text)', 'core._card_actor(text)', 'core._card_holder(text, text)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
    foreach f in array array['core.my_card(text, text)', 'core.my_card_choices(text)', 'core.my_card_live_code(text, text)'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
    foreach f in array array['core.admin_link_account(text, text)', 'core.admin_unlink_account(text, text)', 'core.admin_linkable_accounts()'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
