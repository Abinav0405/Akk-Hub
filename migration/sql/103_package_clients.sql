-- AKK Hub — Site work: choose WHICH clients (Export Only accounts) a package is sent to.
--   Until now "send to export" showed the package to EVERY Export Only account. Now the sender (admin) picks
--   one or more accounts, or "everyone". Packages already sent keep working exactly as before (everyone).
--   · packages.export_everyone  true = every Export Only account (default → existing sends unchanged)
--   · package_exporters         the chosen accounts when export_everyone = false
--   · a deleted / switched-off account never widens access: "chosen" with nobody left = nobody sees it
--   · client-side functions (list, photos, record export, activity, change detector) all honour it
-- Idempotent. Depends on 70+ progress schema (packages, exporter_users) and the live function definitions.

alter table progress.packages add column if not exists export_everyone boolean not null default true;

create table if not exists progress.package_exporters (
    package_id uuid not null references progress.packages(id) on delete cascade,
    exporter_id uuid not null references progress.exporter_users(id) on delete cascade,
    assigned_at timestamptz not null default now(),
    assigned_by uuid,
    primary key (package_id, exporter_id)
);
create index if not exists package_exporters_exporter_idx on progress.package_exporters (exporter_id);
alter table progress.package_exporters enable row level security;
revoke all on table progress.package_exporters from public, anon, authenticated;

-- May this Export Only account see this package?
create or replace function progress._exporter_sees_package(p_exporter uuid, p_package uuid)
returns boolean
language sql
stable
security definer
set search_path to 'progress', 'extensions'
as $$
    select exists (
        select 1 from packages p
         where p.id = p_package
           and (p.export_everyone
                or exists (select 1 from package_exporters pe where pe.package_id = p.id and pe.exporter_id = p_exporter))
    );
$$;
revoke all on function progress._exporter_sees_package(uuid, uuid) from public, anon, authenticated;

-- Validate the chosen accounts: all must exist and be active. Empty / null = everyone.
create or replace function progress._export_recipients(p_exporter_ids uuid[], out v_ids uuid[], out v_names text[])
language plpgsql
stable
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_wanted uuid[];
begin
    select coalesce(array_agg(distinct x), '{}') into v_wanted from unnest(coalesce(p_exporter_ids, '{}')) x where x is not null;
    v_ids := '{}';
    v_names := '{}';
    if cardinality(v_wanted) = 0 then
        return;
    end if;
    select coalesce(array_agg(u.id order by lower(u.display_name)), '{}'), coalesce(array_agg(u.display_name order by lower(u.display_name)), '{}')
      into v_ids, v_names
      from exporter_users u
     where u.id = any (v_wanted) and u.is_active;
    if cardinality(v_ids) <> cardinality(v_wanted) then
        raise exception 'One of the chosen Export Only accounts is switched off or no longer exists';
    end if;
end;
$$;
revoke all on function progress._export_recipients(uuid[]) from public, anon, authenticated;

-- Send approved packages to export. p_exporter_ids: the accounts that may see them (null / empty = everyone).
drop function if exists progress.admin_send_packages_to_export(uuid[]);
create or replace function progress.admin_send_packages_to_export(p_package_ids uuid[], p_exporter_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_admin uuid := _require_admin();
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
           sent_to_export_by = v_admin,
           export_everyone = (cardinality(v_rec.v_ids) = 0),
           updated_at = now()
     where id = any (v_ids);
    if cardinality(v_rec.v_ids) > 0 then
        insert into package_exporters (package_id, exporter_id, assigned_by)
        select pid, eid, v_admin from unnest(v_ids) pid cross join unnest(v_rec.v_ids) eid;
    end if;

    v_label := case when cardinality(v_rec.v_ids) = 0 then to_jsonb('everyone'::text) else to_jsonb(v_rec.v_names) end;
    insert into package_edit_log (package_id, edited_by, edited_by_role, edit_type, detail)
    select pid, v_admin, 'admin', 'send_to_export', jsonb_build_object('recipients', v_label) from unnest(v_ids) pid;

    return cardinality(v_ids);
end;
$$;
revoke all on function progress.admin_send_packages_to_export(uuid[], uuid[]) from public;
grant execute on function progress.admin_send_packages_to_export(uuid[], uuid[]) to anon, authenticated;

-- Change who can see packages that are ALREADY sent (null / empty = everyone).
create or replace function progress.admin_set_package_exporters(p_package_ids uuid[], p_exporter_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'progress', 'extensions'
as $$
declare
    v_admin uuid := _require_admin();
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
        select pid, eid, v_admin from unnest(v_ids) pid cross join unnest(v_rec.v_ids) eid;
    end if;

    v_label := case when cardinality(v_rec.v_ids) = 0 then to_jsonb('everyone'::text) else to_jsonb(v_rec.v_names) end;
    insert into package_edit_log (package_id, edited_by, edited_by_role, edit_type, detail)
    select pid, v_admin, 'admin', 'change_export_recipients', jsonb_build_object('recipients', v_label) from unnest(v_ids) pid;

    return cardinality(v_ids);
end;
$$;
revoke all on function progress.admin_set_package_exporters(uuid[], uuid[]) from public;
grant execute on function progress.admin_set_package_exporters(uuid[], uuid[]) to anon, authenticated;

-- Who each sent package was sent to (packages with export_everyone are not listed — they go to everyone).
create or replace function progress.admin_list_package_recipients()
returns table (package_id uuid, exporter_id uuid, display_name text, is_active boolean)
language plpgsql
stable
security definer
set search_path to 'progress', 'extensions'
as $$
begin
    perform _require_admin();
    return query
        select pe.package_id, pe.exporter_id, u.display_name, u.is_active
          from package_exporters pe
          join exporter_users u on u.id = pe.exporter_id
          join packages p on p.id = pe.package_id
         where p.sent_to_export and not p.export_everyone
         order by lower(u.display_name);
end;
$$;
revoke all on function progress.admin_list_package_recipients() from public;
grant execute on function progress.admin_list_package_recipients() to anon, authenticated;

-- Which sent packages are NOT for everyone (so the list can show "only X, Y" even when nobody is left).
create or replace function progress.admin_list_restricted_packages()
returns table (package_id uuid)
language plpgsql
stable
security definer
set search_path to 'progress', 'extensions'
as $$
begin
    perform _require_admin();
    return query select p.id from packages p where p.sent_to_export and not p.export_everyone;
end;
$$;
revoke all on function progress.admin_list_restricted_packages() from public;
grant execute on function progress.admin_list_restricted_packages() to anon, authenticated;

CREATE OR REPLACE FUNCTION progress.admin_unsend_packages_from_export(p_package_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  v_admin uuid := _require_admin();
  v_count integer;
begin
  if p_package_ids is null or coalesce(cardinality(p_package_ids), 0) = 0 then
    raise exception 'Select at least one package';
  end if;

  with src as (
    select distinct pkg_id
      from unnest(p_package_ids) as t(pkg_id)
     where t.pkg_id is not null
  ),
  updated as (
    update packages p
       set sent_to_export = false,
           sent_to_export_at = null,
           sent_to_export_by = null,
           updated_at = now()
      from src
     where p.id = src.pkg_id
       and p.sent_to_export = true
    returning p.id
  ),
  cleared as (
    delete from package_exporters pe using updated u where pe.package_id = u.id returning pe.package_id
  ),
  logged as (
    insert into package_edit_log (package_id, edited_by, edited_by_role, edit_type)
    select id, v_admin, 'admin', 'unsend_from_export'
      from updated
    returning package_id
  )
  select count(*)::integer into v_count from logged;

  if coalesce(v_count, 0) = 0 then
    raise exception 'No eligible packages to unsend. Only packages currently sent to export can be unsent.';
  end if;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION progress.exporter_list_approved_packages(p_exporter_token text)
 RETURNS TABLE(id uuid, display_id text, lcb_id text, section_label text, package_date date, has_before boolean, has_during boolean, has_after boolean, has_completion boolean, completion_pct integer, photo_count integer, before_count integer, during_count integer, after_count integer, completion_count integer, approval_status text, decline_reason text, created_at timestamp with time zone, site_id uuid, site_name text, worker_id uuid, worker_employee_code text, worker_display_name text, reviewed_by_name text, reviewed_by_role text, exported_by_name text, exported_at timestamp with time zone, exported_format text, export_count bigint, description text, street_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  v_exporter uuid := _require_exporter(p_exporter_token);
begin
  return query
    select p.id, p.display_id, p.lcb_id, p.section_label, p.package_date,
           p.has_before, p.has_during, p.has_after, p.has_completion,
           p.completion_pct,
           coalesce(pics.photo_count, 0), coalesce(pics.before_count, 0),
           coalesce(pics.during_count, 0), coalesce(pics.after_count, 0),
           coalesce(pics.completion_count, 0),
           p.approval_status, p.decline_reason, p.created_at,
           s.id, s.name,
           w.id, w.employee_code, w.display_name,
           _staff_display_name(p.reviewed_by, p.reviewed_by_role) as reviewed_by_name,
           p.reviewed_by_role as reviewed_by_role,
           last_exp.exporter_name as exported_by_name,
           last_exp.exported_at as exported_at,
           last_exp.format as exported_format,
           coalesce(counts.n, 0::bigint) as export_count,
           p.description,
           p.street_name
    from packages p
    left join sites s on s.id = p.site_id
    left join app_users w on w.id = p.worker_id
    left join lateral (
      select
        count(*)::int as photo_count,
        count(*) filter (where i.stage = 'before')::int as before_count,
        count(*) filter (where i.stage = 'during')::int as during_count,
        count(*) filter (where i.stage = 'after')::int as after_count,
        count(*) filter (where i.stage = 'completion')::int as completion_count
      from package_images i
      where i.package_id = p.id
    ) pics on true
    left join lateral (
      select e.exporter_name, e.exported_at, e.format
      from package_export_events e
      where e.package_id = p.id
      order by e.exported_at desc
      limit 1
    ) last_exp on true
    left join lateral (
      select count(*)::bigint as n
      from package_export_events e
      where e.package_id = p.id
    ) counts on true
    where p.approval_status = 'approved'
      and p.sent_to_export = true
      and _exporter_sees_package(v_exporter, p.id)
      and (p.has_completion or (p.has_before and p.has_after))
    order by p.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION progress.exporter_packages_head_timestamp(p_exporter_token text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  v_head timestamptz;
  v_exporter uuid := _require_exporter(p_exporter_token);
begin
  select max(ts) into v_head
  from (
    select p.updated_at as ts
    from packages p
    where (p.has_completion or (p.has_before and p.has_after))
      and _exporter_sees_package(v_exporter, p.id)
    union all
    select e.exported_at
    from package_export_events e
    where _exporter_sees_package(v_exporter, e.package_id)
  ) x;
  return v_head;
end;
$function$;

CREATE OR REPLACE FUNCTION progress.exporter_get_package_images(p_package_id uuid, p_exporter_token text)
 RETURNS TABLE(id uuid, stage text, storage_path text, sort_order integer, captured_at timestamp with time zone, captured_address text, caption text, captured_accuracy double precision, verification_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  v_exporter uuid := _require_exporter(p_exporter_token);
begin
  if not exists (
    select 1 from packages p
    where p.id = p_package_id
      and p.approval_status = 'approved'
      and p.sent_to_export = true
      and _exporter_sees_package(v_exporter, p.id)
  ) then
    raise exception 'Package not found';
  end if;
  return query
    select i.id, i.stage, i.storage_path, i.sort_order, i.captured_at, i.captured_address,
           i.caption, i.captured_accuracy, i.verification_code
    from package_images i
    where i.package_id = p_package_id
    order by i.stage, i.sort_order;
end;
$function$;

CREATE OR REPLACE FUNCTION progress.exporter_record_export(p_exporter_token text, p_package_id uuid, p_format text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  v_exporter uuid := _require_exporter(p_exporter_token);
  v_name text;
begin
  if p_format not in ('pdf', 'excel') then
    raise exception 'Invalid export format';
  end if;
  if not exists (
    select 1 from packages p
    where p.id = p_package_id
      and p.approval_status = 'approved'
      and p.sent_to_export = true
      and _exporter_sees_package(v_exporter, p.id)
  ) then
    raise exception 'Package not found';
  end if;

  select display_name into v_name from exporter_users where id = v_exporter;

  insert into package_export_events (package_id, exporter_id, exporter_name, format)
  values (p_package_id, v_exporter, v_name, p_format);

  update packages set updated_at = now() where id = p_package_id;
end;
$function$;

CREATE OR REPLACE FUNCTION progress._document_can_read(p_kind text, p_document_id uuid, p_role text, p_actor_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'progress', 'extensions'
AS $function$
declare
  v_type text;
  v_eid uuid;
begin
  if not _document_exists(p_kind, p_document_id) then
    return false;
  end if;
  if p_role in ('admin', 'manager') then
    return true;
  end if;
  if p_role <> 'exporter' or p_actor_id is null then
    return false;
  end if;

  if p_kind = 'jsr' then
    return _exporter_assigned_to_jsr(p_actor_id, p_document_id);
  elsif p_kind = 'jsr_claim' then
    return _exporter_owns_claim(p_actor_id, p_document_id);
  elsif p_kind = 'package' then
    return exists (
      select 1 from packages p
       where p.id = p_document_id
         and p.approval_status = 'approved'
         and p.sent_to_export = true
         and _exporter_sees_package(p_actor_id, p.id)
    );
  elsif p_kind = 'invoice' then
    select entity_type, entity_id into v_type, v_eid from invoices where id = p_document_id;
    if v_type = 'jsr' then
      return _exporter_owns_invoice(p_actor_id, p_document_id)
        or _exporter_assigned_to_jsr(p_actor_id, v_eid);
    elsif v_type = 'claim' then
      return _exporter_owns_invoice(p_actor_id, p_document_id);
    end if;
  end if;
  return false;
end;
$function$;

