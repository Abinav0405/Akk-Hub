-- =====================================================================================
-- AKK Hub — Worker Information: extra employee details, ID card, admin information requests,
-- worker information checks (approve / decline), exports, audit.
--
-- Where the data lives: the 10 new (sensitive) fields are in core.worker_info, keyed by the
-- Attendance employee ID (Attendance stays the master worker record; nothing is duplicated).
-- RLS is on and nothing is granted to anon/authenticated: every read and write goes through the
-- functions below, which check the caller:
--   · admins (core.is_hub_admin)             → any worker
--   · a worker (their hub session token)     → only their own record / their own requests+checks
-- Safe to re-run. Nothing existing is dropped or overwritten.
-- =====================================================================================

create table if not exists core.worker_info (
    employee_id text primary key,
    work_permit_no text,
    hp_number text,
    permit_expiry_date date,
    passport_no text,
    passport_expiry_date date,
    nationality text,
    soc_no text,
    soc_expiry_date date,
    address text,
    emergency_contact_number text,
    updated_at timestamptz not null default now(),
    updated_by text
);

create table if not exists core.worker_info_settings (
    id int primary key default 1 check (id = 1),
    required_fields text[] not null default array[
        'hp_number', 'nationality', 'address', 'emergency_contact_number',
        'work_permit_no', 'permit_expiry_date', 'passport_no', 'passport_expiry_date'],
    auto_request boolean not null default true,
    updated_at timestamptz not null default now(),
    updated_by text
);
insert into core.worker_info_settings (id) values (1) on conflict (id) do nothing;

create table if not exists core.worker_info_requests (
    id uuid primary key default gen_random_uuid(),
    employee_id text not null,
    fields text[] not null check (cardinality(fields) > 0),
    message text,
    status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
    auto boolean not null default false,
    requested_by text,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    completed_by text
);
create index if not exists worker_info_requests_open_idx on core.worker_info_requests (employee_id) where status = 'pending';

create table if not exists core.worker_info_checks (
    id uuid primary key default gen_random_uuid(),
    employee_id text not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'resolved', 'cancelled')),
    sent_by text,
    sent_at timestamptz not null default now(),
    responded_at timestamptz,
    decline_reason text,
    decline_fields text[],
    approved_snapshot jsonb, -- exactly what the worker confirmed (protected, admin-only)
    resolved_by text,
    resolved_at timestamptz,
    resolution_note text
);
create unique index if not exists worker_info_checks_one_open on core.worker_info_checks (employee_id) where status = 'pending';

create table if not exists core.worker_info_audit (
    id bigserial primary key,
    employee_id text not null,
    action text not null,          -- admin_edit | request_sent | request_completed | request_cancelled | check_sent | check_approved | check_declined | check_resolved | import
    fields text[],                 -- which fields (never their values)
    actor text,
    ref uuid,
    at timestamptz not null default now()
);
create index if not exists worker_info_audit_emp_idx on core.worker_info_audit (employee_id, at desc);

do $$
declare t text;
begin
    foreach t in array array['worker_info', 'worker_info_settings', 'worker_info_requests', 'worker_info_checks', 'worker_info_audit'] loop
        execute format('alter table core.%I enable row level security', t);
        execute format('revoke all on core.%I from public, anon, authenticated', t);
        execute format('grant all on core.%I to service_role', t);
    end loop;
end $$;
revoke all on all sequences in schema core from public, anon, authenticated;
grant all on all sequences in schema core to service_role;

-- ---------------------------------------------------------------------------
-- Field catalogue (key, label, kind, group, who it applies to)
-- ---------------------------------------------------------------------------
create or replace function core._wi_fields()
returns table (key text, label text, kind text, grp text, applies text)
language sql immutable as $$
    values
        ('work_permit_no',           'Work Permit No.',          'text', 'employment', 'foreign'),
        ('permit_expiry_date',       'Work Permit Expiry',       'date', 'employment', 'foreign'),
        ('soc_no',                   'SOC No.',                  'text', 'employment', 'all'),
        ('soc_expiry_date',          'SOC Expiry',               'date', 'employment', 'all'),
        ('hp_number',                'Mobile (HP) Number',       'text', 'personal',   'all'),
        ('nationality',              'Nationality',              'text', 'personal',   'all'),
        ('address',                  'Residential Address',      'text', 'personal',   'all'),
        ('passport_no',              'Passport No.',             'text', 'passport',   'foreign'),
        ('passport_expiry_date',     'Passport Expiry',          'date', 'passport',   'foreign'),
        ('emergency_contact_number', 'Emergency Contact Number', 'text', 'emergency',  'all')
$$;

-- Base worker record (Attendance is the master).
create or replace function core._wi_base(p_id text)
returns table (employee_id text, name text, worker_type text, designation text, in_company boolean, date_joined date, nric_fin text)
language sql stable security definer set search_path = core as $$
    select d.employee_id::text, d.employee_name::text, 'foreign', d.designation::text, coalesce(d.in_company, true), d.date_joined, d.nric_fin::text
      from attendance.worker_details d where d.employee_id = p_id
    union all
    select l.employee_id::text, l.employee_name::text, 'local', l.designation::text, coalesce(l.in_company, true), l.date_joined, l.nric_fin::text
      from attendance.local_worker_details l where l.employee_id = p_id
    limit 1;
$$;

create or replace function core._wi_all_base()
returns table (employee_id text, name text, worker_type text, designation text, in_company boolean, date_joined date, nric_fin text)
language sql stable security definer set search_path = core as $$
    select d.employee_id::text, d.employee_name::text, 'foreign', d.designation::text, coalesce(d.in_company, true), d.date_joined, d.nric_fin::text
      from attendance.worker_details d
    union all
    select l.employee_id::text, l.employee_name::text, 'local', l.designation::text, coalesce(l.in_company, true), l.date_joined, l.nric_fin::text
      from attendance.local_worker_details l;
$$;

-- The 10 fields of one worker as jsonb (dates as YYYY-MM-DD; missing keys present as null).
create or replace function core._wi_values(p_id text)
returns jsonb
language sql stable security definer set search_path = core as $$
    select jsonb_build_object(
        'work_permit_no', i.work_permit_no, 'hp_number', i.hp_number, 'permit_expiry_date', i.permit_expiry_date,
        'passport_no', i.passport_no, 'passport_expiry_date', i.passport_expiry_date, 'nationality', i.nationality,
        'soc_no', i.soc_no, 'soc_expiry_date', i.soc_expiry_date, 'address', i.address,
        'emergency_contact_number', i.emergency_contact_number, 'updated_at', i.updated_at)
      from (select 1) one
      left join core.worker_info i on i.employee_id = p_id;
$$;

-- Required fields this worker is missing.
create or replace function core._wi_missing(p_id text, p_type text)
returns text[]
language plpgsql stable security definer set search_path = core as $$
declare
    v jsonb := core._wi_values(p_id);
    req text[] := coalesce((select required_fields from core.worker_info_settings where id = 1), '{}');
    out text[] := '{}';
    f record;
begin
    for f in select * from core._wi_fields() loop
        if f.key = any (req) and (f.applies = 'all' or f.applies = p_type)
           and nullif(trim(coalesce(v ->> f.key, '')), '') is null then
            out := out || f.key;
        end if;
    end loop;
    return out;
end;
$$;

create or replace function core._wi_pending_fields(p_id text)
returns text[]
language sql stable security definer set search_path = core as $$
    select coalesce(array_agg(distinct f), '{}') from core.worker_info_requests r, unnest(r.fields) f
     where r.employee_id = p_id and r.status = 'pending';
$$;

-- Apply submitted values (whitelisted keys, dates validated). Returns the keys written.
create or replace function core._wi_apply(p_id text, p_values jsonb, p_actor text)
returns text[]
language plpgsql volatile security definer set search_path = core as $$
declare
    f record;
    raw text;
    keys text[] := '{}';
begin
    insert into core.worker_info (employee_id, updated_by) values (p_id, p_actor) on conflict (employee_id) do nothing;
    for f in select * from core._wi_fields() loop
        if not (p_values ? f.key) then
            continue;
        end if;
        raw := nullif(trim(coalesce(p_values ->> f.key, '')), '');
        if f.kind = 'date' and raw is not null then
            begin
                perform raw::date;
            exception when others then
                raise exception '% must be a valid date', f.label;
            end;
        end if;
        if f.key in ('hp_number', 'emergency_contact_number') and raw is not null and raw !~ '^[+0-9 ()-]{6,20}$' then
            raise exception '% must be a phone number (digits, +, spaces)', f.label;
        end if;
        if raw is not null and length(raw) > 300 then
            raise exception '% is too long', f.label;
        end if;
        execute format('update core.worker_info set %I = $1::%s, updated_at = now(), updated_by = $2 where employee_id = $3',
                       f.key, case when f.kind = 'date' then 'date' else 'text' end)
          using raw, p_actor, p_id;
        keys := keys || f.key;
    end loop;
    return keys;
end;
$$;

-- Push helper: send to device tokens through the generic sender (prg-push-send). Never blocks.
create or replace function core._wi_push(p_tokens text[], p_title text, p_body text, p_path text)
returns void
language plpgsql security definer set search_path = core, extensions, net as $$
declare cfg record;
begin
    if p_tokens is null or cardinality(p_tokens) = 0 or to_regclass('core.push_config') is null then
        return;
    end if;
    execute 'select base_url, secret from core.push_config where id = 1' into cfg;
    if cfg.secret is null then
        return;
    end if;
    begin
        perform net.http_post(
            url := cfg.base_url || '/functions/v1/prg-push-send',
            body := jsonb_build_object('title', p_title, 'body', p_body, 'path', p_path, 'tokens', to_jsonb(p_tokens)),
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-spt-fcm-secret', cfg.secret));
    exception when others then
        raise warning 'worker info push failed: %', sqlerrm;
    end;
end;
$$;

create or replace function core._wi_push_worker(p_id text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = core as $$
begin
    perform core._wi_push((select array_agg(distinct t.fcm_token) from attendance.device_push_tokens t
                            where t.worker_id = p_id and coalesce(trim(t.fcm_token), '') <> ''),
                          p_title, p_body, '/me/info');
end;
$$;

create or replace function core._wi_push_admins(p_title text, p_body text)
returns void language plpgsql security definer set search_path = core as $$
begin
    perform core._wi_push((select array_agg(distinct t.fcm_token) from attendance.device_push_tokens t
                            where t.admin_email is not null and coalesce(trim(t.fcm_token), '') <> ''),
                          p_title, p_body, '/timesheet/admin?section=worker-info');
end;
$$;

-- ---------------------------------------------------------------------------
-- ADMIN
-- ---------------------------------------------------------------------------
create or replace function core._wi_admin()
returns text language plpgsql stable security definer set search_path = core as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return coalesce(auth.jwt() ->> 'email', auth.uid()::text);
end;
$$;

-- Directory for search / bulk selection. p_scope: all | employed | unemployed
create or replace function core.admin_worker_directory(p_scope text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._wi_admin();
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type, 'designation', b.designation,
            'in_company', b.in_company, 'work_permit_no', i.work_permit_no, 'hp_number', i.hp_number,
            'has_photo', exists (select 1 from core.worker_photos p where p.employee_id = b.employee_id),
            'missing', core._wi_missing(b.employee_id, b.worker_type),
            'pending_fields', core._wi_pending_fields(b.employee_id),
            'check', (select jsonb_build_object('id', c.id, 'status', c.status, 'sent_at', c.sent_at, 'responded_at', c.responded_at)
                        from core.worker_info_checks c where c.employee_id = b.employee_id order by c.sent_at desc limit 1)
        ) order by b.in_company desc, b.employee_id)
          from core._wi_all_base() b
          left join core.worker_info i on i.employee_id = b.employee_id
         where p_scope = 'all' or (p_scope = 'employed' and b.in_company) or (p_scope = 'unemployed' and not b.in_company)
    ), '[]'::jsonb);
end;
$$;

create or replace function core.admin_worker_profile(p_employee_id text)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    b record;
begin
    perform core._wi_admin();
    select * into b from core._wi_base(trim(p_employee_id));
    if b.employee_id is null then
        return null;
    end if;
    return jsonb_build_object(
        'employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type, 'designation', b.designation,
        'in_company', b.in_company, 'date_joined', b.date_joined, 'nric_fin', b.nric_fin,
        'info', core._wi_values(b.employee_id),
        'photo', (select p.photo from core.worker_photos p where p.employee_id = b.employee_id),
        'missing', core._wi_missing(b.employee_id, b.worker_type),
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'fields', r.fields, 'message', r.message,
                                    'status', r.status, 'auto', r.auto, 'requested_by', r.requested_by, 'created_at', r.created_at,
                                    'completed_at', r.completed_at, 'completed_by', r.completed_by) order by r.created_at desc)
                                from (select * from core.worker_info_requests where employee_id = b.employee_id order by created_at desc limit 20) r), '[]'::jsonb),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'sent_by', c.sent_by, 'sent_at', c.sent_at,
                                    'responded_at', c.responded_at, 'decline_reason', c.decline_reason, 'decline_fields', c.decline_fields,
                                    'resolved_by', c.resolved_by, 'resolved_at', c.resolved_at, 'resolution_note', c.resolution_note) order by c.sent_at desc)
                              from (select * from core.worker_info_checks where employee_id = b.employee_id order by sent_at desc limit 10) c), '[]'::jsonb)
    );
end;
$$;

create or replace function core.admin_save_worker_info(p_employee_id text, p_values jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    v_id text := trim(p_employee_id);
    keys text[];
    r record;
begin
    if not exists (select 1 from core._wi_base(v_id)) then
        raise exception 'Worker not found';
    end if;
    keys := core._wi_apply(v_id, coalesce(p_values, '{}'::jsonb), v_actor);
    if cardinality(keys) > 0 then
        insert into core.worker_info_audit (employee_id, action, fields, actor) values (v_id, 'admin_edit', keys, v_actor);
    end if;
    -- Requests whose fields are now all filled are done.
    for r in select * from core.worker_info_requests where employee_id = v_id and status = 'pending' loop
        if not exists (select 1 from unnest(r.fields) f where nullif(trim(coalesce(core._wi_values(v_id) ->> f, '')), '') is null) then
            update core.worker_info_requests set status = 'completed', completed_at = now(), completed_by = 'admin:' || v_actor where id = r.id;
        end if;
    end loop;
    return core.admin_worker_profile(v_id);
end;
$$;

-- Ask one or many workers for one or many fields. Fields already asked (pending) are skipped.
create or replace function core.admin_request_worker_info(p_employee_ids text[], p_fields text[], p_message text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    v_id text;
    v_type text;
    v_fields text[];
    v_created int := 0;
    v_skipped int := 0;
    v_rid uuid;
    v_labels text;
begin
    if p_fields is null or cardinality(p_fields) = 0 then
        raise exception 'Choose at least one detail to request';
    end if;
    if exists (select 1 from unnest(p_fields) f where f not in (select key from core._wi_fields())) then
        raise exception 'Unknown detail requested';
    end if;
    foreach v_id in array coalesce(p_employee_ids, '{}') loop
        select worker_type into v_type from core._wi_base(trim(v_id));
        if v_type is null then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        select coalesce(array_agg(f), '{}') into v_fields from unnest(p_fields) f
         where not (f = any (core._wi_pending_fields(trim(v_id))));
        if cardinality(v_fields) = 0 then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        insert into core.worker_info_requests (employee_id, fields, message, requested_by)
        values (trim(v_id), v_fields, nullif(trim(coalesce(p_message, '')), ''), v_actor)
        returning id into v_rid;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (trim(v_id), 'request_sent', v_fields, v_actor, v_rid);
        select string_agg(label, ', ') into v_labels from core._wi_fields() where key = any (v_fields);
        perform core._wi_push_worker(trim(v_id), 'Information needed', 'Please provide: ' || v_labels);
        v_created := v_created + 1;
    end loop;
    return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

create or replace function core.admin_cancel_info_request(p_request_id uuid)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    r record;
begin
    update core.worker_info_requests set status = 'cancelled', completed_at = now(), completed_by = 'admin:' || v_actor
     where id = p_request_id and status = 'pending' returning * into r;
    if r.id is not null then
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (r.employee_id, 'request_cancelled', r.fields, v_actor, r.id);
    end if;
end;
$$;

-- Information check: the worker reviews ALL their current details (read-only) and approves or declines.
create or replace function core.admin_send_info_checks(p_employee_ids text[])
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    v_id text;
    v_sent int := 0;
    v_skipped int := 0;
    v_cid uuid;
begin
    foreach v_id in array coalesce(p_employee_ids, '{}') loop
        v_id := trim(v_id);
        if not exists (select 1 from core._wi_base(v_id))
           or exists (select 1 from core.worker_info_checks where employee_id = v_id and status = 'pending') then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        insert into core.worker_info_checks (employee_id, sent_by) values (v_id, v_actor) returning id into v_cid;
        insert into core.worker_info_audit (employee_id, action, actor, ref) values (v_id, 'check_sent', v_actor, v_cid);
        perform core._wi_push_worker(v_id, 'Check your employee information', 'Please review your details and approve or decline.');
        v_sent := v_sent + 1;
    end loop;
    return jsonb_build_object('sent', v_sent, 'skipped', v_skipped);
end;
$$;

create or replace function core.admin_cancel_info_check(p_check_id uuid)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare v_actor text := core._wi_admin();
begin
    update core.worker_info_checks set status = 'cancelled', resolved_by = v_actor, resolved_at = now()
     where id = p_check_id and status = 'pending';
end;
$$;

create or replace function core.admin_resolve_info_check(p_check_id uuid, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    c record;
begin
    update core.worker_info_checks set status = 'resolved', resolved_by = v_actor, resolved_at = now(),
           resolution_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_check_id and status = 'declined' returning * into c;
    if c.id is null then
        raise exception 'Only a declined check can be marked resolved';
    end if;
    insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (c.employee_id, 'check_resolved', c.decline_fields, v_actor, c.id);
end;
$$;

-- Activity feed for the admin panel.
create or replace function core.admin_info_activity()
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._wi_admin();
    return jsonb_build_object(
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'employee_id', r.employee_id, 'name', b.name,
                        'fields', r.fields, 'message', r.message, 'status', r.status, 'auto', r.auto, 'created_at', r.created_at,
                        'completed_at', r.completed_at) order by (r.status = 'pending') desc, coalesce(r.completed_at, r.created_at) desc)
                      from (select * from core.worker_info_requests order by created_at desc limit 300) r
                      left join core._wi_all_base() b on b.employee_id = r.employee_id), '[]'::jsonb),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'employee_id', c.employee_id, 'name', b.name,
                        'status', c.status, 'sent_at', c.sent_at, 'responded_at', c.responded_at, 'decline_reason', c.decline_reason,
                        'decline_fields', c.decline_fields, 'resolved_at', c.resolved_at)
                        order by (c.status = 'declined') desc, (c.status = 'pending') desc, coalesce(c.responded_at, c.sent_at) desc)
                      from (select * from core.worker_info_checks order by sent_at desc limit 300) c
                      left join core._wi_all_base() b on b.employee_id = c.employee_id), '[]'::jsonb),
        'settings', (select jsonb_build_object('required_fields', s.required_fields, 'auto_request', s.auto_request) from core.worker_info_settings s where s.id = 1)
    );
end;
$$;

create or replace function core.admin_set_info_settings(p_required text[], p_auto boolean)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare v_actor text := core._wi_admin();
begin
    if exists (select 1 from unnest(coalesce(p_required, '{}')) f where f not in (select key from core._wi_fields())) then
        raise exception 'Unknown field';
    end if;
    update core.worker_info_settings set required_fields = coalesce(p_required, '{}'), auto_request = coalesce(p_auto, true),
           updated_at = now(), updated_by = v_actor where id = 1;
end;
$$;

-- Ask every employed worker for their missing REQUIRED details (one request per worker, skips
-- details already asked). Also runs automatically when a worker opens the app (my_info_tasks).
create or replace function core._wi_auto_request(p_id text, p_type text, p_actor text)
returns uuid
language plpgsql volatile security definer set search_path = core as $$
declare
    v_fields text[];
    v_rid uuid;
begin
    select coalesce(array_agg(f), '{}') into v_fields from unnest(core._wi_missing(p_id, p_type)) f
     where not (f = any (core._wi_pending_fields(p_id)));
    if cardinality(v_fields) = 0 then
        return null;
    end if;
    insert into core.worker_info_requests (employee_id, fields, message, auto, requested_by)
    values (p_id, v_fields, 'Some of your employee details are missing. Please fill them in.', true, p_actor)
    returning id into v_rid;
    insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (p_id, 'request_sent', v_fields, p_actor, v_rid);
    return v_rid;
end;
$$;

create or replace function core.admin_request_missing_info()
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    b record;
    n int := 0;
begin
    for b in select * from core._wi_all_base() where in_company loop
        if core._wi_auto_request(b.employee_id, b.worker_type, v_actor) is not null then
            n := n + 1;
            perform core._wi_push_worker(b.employee_id, 'Information needed', 'Some of your employee details are missing.');
        end if;
    end loop;
    return jsonb_build_object('created', n);
end;
$$;

-- Export: returns ONLY the selected fields (enforced here, not just in the UI) + the card fields.
-- p_employee_ids null → everyone in p_scope (all | employed | unemployed).
create or replace function core.admin_export_workers(p_employee_ids text[], p_scope text, p_fields text[])
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    allowed text[] := array['designation', 'worker_type', 'in_company', 'date_joined', 'nric_fin']
                      || (select array_agg(key) from core._wi_fields());
    sel text[];
begin
    perform core._wi_admin();
    select coalesce(array_agg(f), '{}') into sel from unnest(coalesce(p_fields, '{}')) f where f = any (allowed);
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'card', jsonb_build_object('employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type,
                                       'designation', b.designation, 'in_company', b.in_company,
                                       'work_permit_no', i.work_permit_no,
                                       'photo', (select p.photo from core.worker_photos p where p.employee_id = b.employee_id)),
            'values', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
                         from jsonb_each(core._wi_values(b.employee_id) || jsonb_build_object(
                                 'designation', b.designation, 'worker_type', b.worker_type, 'in_company', b.in_company,
                                 'date_joined', b.date_joined, 'nric_fin', b.nric_fin)) e(k, v)
                        where k = any (sel))
        ) order by b.employee_id)
          from core._wi_all_base() b
          left join core.worker_info i on i.employee_id = b.employee_id
         where (p_employee_ids is not null and b.employee_id = any (p_employee_ids))
            or (p_employee_ids is null and (p_scope = 'all' or (p_scope = 'employed' and b.in_company) or (p_scope = 'unemployed' and not b.in_company)))
    ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- WORKER (hub session token)
-- ---------------------------------------------------------------------------
create or replace function core._wi_me(p_token text)
returns text language plpgsql stable security definer set search_path = core as $$
declare a record;
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is distinct from 'worker' then
        raise exception 'Session expired. Please log in again.';
    end if;
    return a.who;
end;
$$;

create or replace function core.my_info_card(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    b record;
begin
    select * into b from core._wi_base(v_id);
    return jsonb_build_object('employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type,
        'designation', b.designation, 'in_company', b.in_company,
        'work_permit_no', (select work_permit_no from core.worker_info where employee_id = v_id),
        'photo', (select photo from core.worker_photos where employee_id = v_id));
end;
$$;

-- Open tasks for the signed-in worker. Creates the automatic "missing details" request first
-- (if enabled, and only for details not already asked).
create or replace function core.my_info_tasks(p_token text)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    b record;
    c record;
begin
    select * into b from core._wi_base(v_id);
    if b.in_company and coalesce((select auto_request from core.worker_info_settings where id = 1), true) then
        perform core._wi_auto_request(v_id, b.worker_type, 'auto');
    end if;
    select * into c from core.worker_info_checks where employee_id = v_id and status = 'pending' order by sent_at desc limit 1;
    return jsonb_build_object(
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'fields', r.fields, 'message', r.message,
                        'auto', r.auto, 'created_at', r.created_at) order by r.created_at)
                      from core.worker_info_requests r where r.employee_id = v_id and r.status = 'pending'), '[]'::jsonb),
        'check', case when c.id is null then null else jsonb_build_object(
                     'id', c.id, 'sent_at', c.sent_at,
                     'details', jsonb_build_object('employee_id', b.employee_id, 'name', b.name, 'designation', b.designation,
                                                   'worker_type', b.worker_type, 'date_joined', b.date_joined)
                                || core._wi_values(v_id)) end
    );
end;
$$;

create or replace function core.submit_info_request(p_token text, p_request_id uuid, p_values jsonb)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    r record;
    f text;
    v_name text;
begin
    select * into r from core.worker_info_requests where id = p_request_id for update;
    if r.id is null or r.employee_id <> v_id then
        raise exception 'Request not found';
    end if;
    if r.status <> 'pending' then
        raise exception 'This request was already completed';
    end if;
    foreach f in array r.fields loop
        if nullif(trim(coalesce(p_values ->> f, '')), '') is null then
            raise exception 'Please fill in: %', (select label from core._wi_fields() where key = f);
        end if;
    end loop;
    -- Only the requested fields are written.
    perform core._wi_apply(v_id, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_values) e(k, v) where k = any (r.fields)), 'worker:' || v_id);
    update core.worker_info_requests set status = 'completed', completed_at = now(), completed_by = 'worker' where id = r.id;
    insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'request_completed', r.fields, 'worker:' || v_id, r.id);
    select name into v_name from core._wi_base(v_id);
    perform core._wi_push_admins('Employee information updated', coalesce(v_name, v_id) || ' (' || v_id || ') sent the requested details.');
end;
$$;

create or replace function core.respond_info_check(p_token text, p_check_id uuid, p_approve boolean, p_reason text default null, p_fields text[] default null)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    c record;
    b record;
begin
    select * into c from core.worker_info_checks where id = p_check_id for update;
    if c.id is null or c.employee_id <> v_id then
        raise exception 'Check not found';
    end if;
    if c.status <> 'pending' then
        raise exception 'You already answered this check';
    end if;
    select * into b from core._wi_base(v_id);
    if p_approve then
        update core.worker_info_checks set status = 'approved', responded_at = now(),
               approved_snapshot = jsonb_build_object('name', b.name, 'designation', b.designation, 'worker_type', b.worker_type,
                                                      'date_joined', b.date_joined) || core._wi_values(v_id)
         where id = c.id;
        insert into core.worker_info_audit (employee_id, action, actor, ref) values (v_id, 'check_approved', 'worker:' || v_id, c.id);
    else
        if length(trim(coalesce(p_reason, ''))) < 3 then
            raise exception 'Please tell us what is wrong';
        end if;
        update core.worker_info_checks set status = 'declined', responded_at = now(), decline_reason = trim(p_reason),
               decline_fields = (select coalesce(array_agg(f), '{}') from unnest(coalesce(p_fields, '{}')) f
                                  where f = any (array['name', 'designation', 'date_joined'] || (select array_agg(key) from core._wi_fields())))
         where id = c.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'check_declined', p_fields, 'worker:' || v_id, c.id);
        perform core._wi_push_admins('Information check declined', coalesce(b.name, v_id) || ' (' || v_id || ') says some details are wrong.');
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (every function checks its caller)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
    foreach f in array array['core._wi_fields()', 'core._wi_base(text)', 'core._wi_all_base()', 'core._wi_values(text)',
        'core._wi_missing(text, text)', 'core._wi_pending_fields(text)', 'core._wi_apply(text, jsonb, text)',
        'core._wi_push(text[], text, text, text)', 'core._wi_push_worker(text, text, text)', 'core._wi_push_admins(text, text)',
        'core._wi_admin()', 'core._wi_auto_request(text, text, text)', 'core._wi_me(text)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
    foreach f in array array['core.admin_worker_directory(text)', 'core.admin_worker_profile(text)', 'core.admin_save_worker_info(text, jsonb)',
        'core.admin_request_worker_info(text[], text[], text)', 'core.admin_cancel_info_request(uuid)', 'core.admin_send_info_checks(text[])',
        'core.admin_cancel_info_check(uuid)', 'core.admin_resolve_info_check(uuid, text)', 'core.admin_info_activity()',
        'core.admin_set_info_settings(text[], boolean)', 'core.admin_request_missing_info()', 'core.admin_export_workers(text[], text, text[])'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
    foreach f in array array['core.my_info_card(text)', 'core.my_info_tasks(text)', 'core.submit_info_request(text, uuid, jsonb)',
        'core.respond_info_check(text, uuid, boolean, text, text[])'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
end $$;
grant execute on all functions in schema core to service_role;
