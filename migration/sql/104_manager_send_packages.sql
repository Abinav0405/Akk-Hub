-- AKK Hub — managers can send photo packages to clients, when an admin allows it.
--   · new manager permission  send_packages  (default OFF) — ticked per manager on "Manager JSR access"
--     (covers sending, changing which clients can see a package, and unsending)
--   · staff_* functions check the manager session + that permission; admins keep using admin_*
--   · one shared implementation (_pkg_*_core) so admin and manager behave identically
-- Idempotent. Depends on 103_package_clients.sql.

CREATE OR REPLACE FUNCTION progress._jsr_perm_false()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'progress', 'extensions'
AS $function$
  select jsonb_build_object(
    'view_jsrs', false, 'view_claims', false, 'view_invoices', false,
    'create_jsr', false, 'edit_jsr', false, 'submit_jsr', false, 'approve_jsr', false,
    'pass_out_jsr', false, 'assign_exporter', false, 'delete_jsr', false,
    'create_claim', false, 'edit_claim', false, 'submit_claim', false, 'approve_claim', false,
    'pass_out_claim', false, 'delete_claim', false,
    'payment_cert', false, 'prepare_invoice', false, 'submit_invoice', false, 'mark_payment', false,
    'catalog', false, 'companies', false,
    'delete_package_photos', false,
    'send_packages', false
  );
$function$;

CREATE OR REPLACE FUNCTION progress._jsr_perm_all()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'progress', 'extensions'
AS $function$
  select jsonb_build_object(
    'view_jsrs', true, 'view_claims', true, 'view_invoices', true,
    'create_jsr', true, 'edit_jsr', true, 'submit_jsr', true, 'approve_jsr', true,
    'pass_out_jsr', true, 'assign_exporter', true, 'delete_jsr', true,
    'create_claim', true, 'edit_claim', true, 'submit_claim', true, 'approve_claim', true,
    'pass_out_claim', true, 'delete_claim', true,
    'payment_cert', true, 'prepare_invoice', true, 'submit_invoice', true, 'mark_payment', true,
    'catalog', true, 'companies', true,
    'delete_package_photos', true,
    'send_packages', true
  );
$function$;

CREATE OR REPLACE FUNCTION progress._jsr_perm_label(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'progress', 'extensions'
AS $function$
  select case p_key
    when 'view_jsrs' then 'view JSRs'
    when 'view_claims' then 'view claims'
    when 'view_invoices' then 'view invoices'
    when 'create_jsr' then 'create JSRs'
    when 'edit_jsr' then 'edit JSRs'
    when 'submit_jsr' then 'submit JSRs'
    when 'approve_jsr' then 'approve or reject JSRs'
    when 'pass_out_jsr' then 'pass JSRs to an Export Only account'
    when 'assign_exporter' then 'assign an Export Only ID'
    when 'delete_jsr' then 'delete JSRs'
    when 'create_claim' then 'create claims'
    when 'edit_claim' then 'edit claims'
    when 'submit_claim' then 'submit claims'
    when 'approve_claim' then 'approve or reject claims'
    when 'pass_out_claim' then 'pass claims to the client'
    when 'delete_claim' then 'delete claims'
    when 'payment_cert' then 'record a payment certificate'
    when 'prepare_invoice' then 'prepare invoices'
    when 'submit_invoice' then 'submit invoices'
    when 'mark_payment' then 'mark payment pending or paid'
    when 'catalog' then 'edit the JSR catalog'
    when 'companies' then 'edit companies and contracts'
    when 'delete_package_photos' then 'delete photos from packages'
    when 'send_packages' then 'send photo packages to clients'
    else 'do that'
  end;
$function$;

CREATE OR REPLACE FUNCTION progress.staff_list_exporters(p_manager_token text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, display_name text, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
begin
  perform _require_jsr_any(p_manager_token, array['pass_out_jsr','assign_exporter','send_packages']);
  return query
    select u.id, u.display_name, u.is_active
      from exporter_users u
     where u.is_active = true
     order by lower(u.display_name);
end;
$function$;


create or replace function progress._pkg_send_core(p_actor uuid, p_role text, p_package_ids uuid[], p_exporter_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_ids uuid[];
    v_rec record;
    v_label jsonb;
begin
    if p_package_ids is null or coalesce(cardinality(p_package_ids), 0) = 0 then
        raise exception 'Select at least one package';
    end if;
    select * into v_rec from _export_recipients(p_exporter_ids);

    select coalesce(array_agg(s.id), '{}') into v_ids from (
        select p.id from packages p
         where p.id = any (p_package_ids)
           and p.approval_status = 'approved'
           and p.sent_to_export = false
           and (p.has_completion or (p.has_before and p.has_after))
         for update
    ) s;
    if cardinality(v_ids) = 0 then
        raise exception 'No eligible packages to send. Only approved packages that have not already been sent can be sent to export.';
    end if;

    delete from package_exporters where package_id = any (v_ids);
    update packages
       set sent_to_export = true,
           sent_to_export_at = now(),
           sent_to_export_by = p_actor,
           export_everyone = (cardinality(v_rec.v_ids) = 0),
           updated_at = now()
     where id = any (v_ids);
    if cardinality(v_rec.v_ids) > 0 then
        insert into package_exporters (package_id, exporter_id, assigned_by)
        select pid, eid, p_actor from unnest(v_ids) pid cross join unnest(v_rec.v_ids) eid;
    end if;

    v_label := case when cardinality(v_rec.v_ids) = 0 then to_jsonb('everyone'::text) else to_jsonb(v_rec.v_names) end;
    insert into package_edit_log (package_id, edited_by, edited_by_role, edit_type, detail)
    select pid, p_actor, p_role, 'send_to_export', jsonb_build_object('recipients', v_label) from unnest(v_ids) pid;

    return cardinality(v_ids);
end;
$$;
revoke all on function progress._pkg_send_core(uuid, text, uuid[], uuid[]) from public, anon, authenticated;

create or replace function progress._pkg_set_exporters_core(p_actor uuid, p_role text, p_package_ids uuid[], p_exporter_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_ids uuid[];
    v_rec record;
    v_label jsonb;
begin
    if p_package_ids is null or coalesce(cardinality(p_package_ids), 0) = 0 then
        raise exception 'Select at least one package';
    end if;
    select * into v_rec from _export_recipients(p_exporter_ids);

    select coalesce(array_agg(s.id), '{}') into v_ids from (
        select p.id from packages p where p.id = any (p_package_ids) and p.sent_to_export = true for update
    ) s;
    if cardinality(v_ids) = 0 then
        raise exception 'None of the selected packages has been sent to export';
    end if;

    delete from package_exporters where package_id = any (v_ids);
    update packages set export_everyone = (cardinality(v_rec.v_ids) = 0), updated_at = now() where id = any (v_ids);
    if cardinality(v_rec.v_ids) > 0 then
        insert into package_exporters (package_id, exporter_id, assigned_by)
        select pid, eid, p_actor from unnest(v_ids) pid cross join unnest(v_rec.v_ids) eid;
    end if;

    v_label := case when cardinality(v_rec.v_ids) = 0 then to_jsonb('everyone'::text) else to_jsonb(v_rec.v_names) end;
    insert into package_edit_log (package_id, edited_by, edited_by_role, edit_type, detail)
    select pid, p_actor, p_role, 'change_export_recipients', jsonb_build_object('recipients', v_label) from unnest(v_ids) pid;

    return cardinality(v_ids);
end;
$$;
revoke all on function progress._pkg_set_exporters_core(uuid, text, uuid[], uuid[]) from public, anon, authenticated;

create or replace function progress._pkg_unsend_core(p_actor uuid, p_role text, p_package_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_ids uuid[];
begin
    if p_package_ids is null or coalesce(cardinality(p_package_ids), 0) = 0 then
        raise exception 'Select at least one package';
    end if;
    select coalesce(array_agg(s.id), '{}') into v_ids from (
        select p.id from packages p where p.id = any (p_package_ids) and p.sent_to_export = true for update
    ) s;
    if cardinality(v_ids) = 0 then
        raise exception 'No eligible packages to unsend. Only packages currently sent to export can be unsent.';
    end if;
    delete from package_exporters where package_id = any (v_ids);
    update packages
       set sent_to_export = false, sent_to_export_at = null, sent_to_export_by = null, export_everyone = true, updated_at = now()
     where id = any (v_ids);
    insert into package_edit_log (package_id, edited_by, edited_by_role, edit_type)
    select pid, p_actor, p_role, 'unsend_from_export' from unnest(v_ids) pid;
    return cardinality(v_ids);
end;
$$;
revoke all on function progress._pkg_unsend_core(uuid, text, uuid[]) from public, anon, authenticated;

-- Who is acting for a manager-facing call: a manager session that holds send_packages (the manager token wins),
-- otherwise an admin. Returns (actor id, role).
create or replace function progress._pkg_sender(p_manager_token text, out v_actor uuid, out v_role text)
language plpgsql
stable
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_mgr uuid;
begin
    if p_manager_token is not null and length(trim(p_manager_token)) > 0 then
        select s.manager_id into v_mgr from verify_manager_session(p_manager_token) s;
        if v_mgr is not null then
            perform _require_jsr_perm(p_manager_token, 'send_packages');
            v_actor := v_mgr;
            v_role := 'manager';
            return;
        end if;
    end if;
    v_actor := _require_admin();
    v_role := 'admin';
end;
$$;
revoke all on function progress._pkg_sender(text) from public, anon, authenticated;

-- ---- admin entry points become thin wrappers (same signatures and grants as before)
create or replace function progress.admin_send_packages_to_export(p_package_ids uuid[], p_exporter_ids uuid[] default null)
returns integer language plpgsql security definer set search_path to 'progress', 'extensions' as $$
begin
    return _pkg_send_core(_require_admin(), 'admin', p_package_ids, p_exporter_ids);
end;
$$;
create or replace function progress.admin_set_package_exporters(p_package_ids uuid[], p_exporter_ids uuid[])
returns integer language plpgsql security definer set search_path to 'progress', 'extensions' as $$
begin
    return _pkg_set_exporters_core(_require_admin(), 'admin', p_package_ids, p_exporter_ids);
end;
$$;
create or replace function progress.admin_unsend_packages_from_export(p_package_ids uuid[])
returns integer language plpgsql security definer set search_path to 'progress', 'extensions' as $$
begin
    return _pkg_unsend_core(_require_admin(), 'admin', p_package_ids);
end;
$$;

-- ---- manager (or admin) entry points — need the send_packages permission when a manager calls
create or replace function progress.staff_send_packages_to_export(p_manager_token text, p_package_ids uuid[], p_exporter_ids uuid[] default null)
returns integer language plpgsql security definer set search_path to 'progress', 'extensions' as $$
declare s record;
begin
    select * into s from _pkg_sender(p_manager_token);
    return _pkg_send_core(s.v_actor, s.v_role, p_package_ids, p_exporter_ids);
end;
$$;
create or replace function progress.staff_set_package_exporters(p_manager_token text, p_package_ids uuid[], p_exporter_ids uuid[])
returns integer language plpgsql security definer set search_path to 'progress', 'extensions' as $$
declare s record;
begin
    select * into s from _pkg_sender(p_manager_token);
    return _pkg_set_exporters_core(s.v_actor, s.v_role, p_package_ids, p_exporter_ids);
end;
$$;
create or replace function progress.staff_unsend_packages_from_export(p_manager_token text, p_package_ids uuid[])
returns integer language plpgsql security definer set search_path to 'progress', 'extensions' as $$
declare s record;
begin
    select * into s from _pkg_sender(p_manager_token);
    return _pkg_unsend_core(s.v_actor, s.v_role, p_package_ids);
end;
$$;
create or replace function progress.staff_list_package_recipients(p_manager_token text)
returns table (package_id uuid, exporter_id uuid, display_name text, is_active boolean)
language plpgsql stable security definer set search_path to 'progress', 'extensions' as $$
declare s record;
begin
    select * into s from _pkg_sender(p_manager_token);
    return query
        select pe.package_id, pe.exporter_id, u.display_name, u.is_active
          from package_exporters pe
          join exporter_users u on u.id = pe.exporter_id
          join packages p on p.id = pe.package_id
         where p.sent_to_export and not p.export_everyone
         order by lower(u.display_name);
end;
$$;
create or replace function progress.staff_list_restricted_packages(p_manager_token text)
returns table (package_id uuid)
language plpgsql stable security definer set search_path to 'progress', 'extensions' as $$
declare s record;
begin
    select * into s from _pkg_sender(p_manager_token);
    return query select p.id from packages p where p.sent_to_export and not p.export_everyone;
end;
$$;

revoke all on function progress.staff_send_packages_to_export(text, uuid[], uuid[]) from public;
revoke all on function progress.staff_set_package_exporters(text, uuid[], uuid[]) from public;
revoke all on function progress.staff_unsend_packages_from_export(text, uuid[]) from public;
revoke all on function progress.staff_list_package_recipients(text) from public;
revoke all on function progress.staff_list_restricted_packages(text) from public;
grant execute on function progress.staff_send_packages_to_export(text, uuid[], uuid[]) to anon, authenticated;
grant execute on function progress.staff_set_package_exporters(text, uuid[], uuid[]) to anon, authenticated;
grant execute on function progress.staff_unsend_packages_from_export(text, uuid[]) to anon, authenticated;
grant execute on function progress.staff_list_package_recipients(text) to anon, authenticated;
grant execute on function progress.staff_list_restricted_packages(text) to anon, authenticated;
