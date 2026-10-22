-- AKK Hub — worker information, round 2 (idempotent; safe to re-run)
--   * (no new standard fields: the catalogue stays the ten details from 80)
--   * "custom" details: any other question the admin types (stored with its label, per worker)
--   * per-worker request items (each worker gets their own list of details)
--   * export can include every non-secret employee detail (every column of the master record except the password hash and face data)
-- Depends on 80_worker_info.sql. Access stays: RLS on, no grants, everything through checked SECURITY DEFINER functions.

alter table core.worker_info
    add column if not exists extra jsonb not null default '{}'::jsonb;

alter table core.worker_info_requests
    add column if not exists custom_labels jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Catalogue
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

-- EVERY column of the Attendance master record (foreign: worker_details, local: local_worker_details) EXCEPT
-- the password hash and the face-recognition data. Read-only from here; admin functions only.
create or replace function core._wi_base_values(p_id text)
returns jsonb
language sql stable security definer set search_path = core as $$
    select to_jsonb(x) from (
        select d.employee_id::text as employee_id, d.employee_name::text as name, d.nric_fin::text as nric_fin, d.designation::text as designation,
               'foreign'::text as worker_type, coalesce(d.in_company, true) as in_company, d.date_joined, d.date_of_cessation, d.rejoin_dates,
               d.age, null::date as birthday, d.created_at,
               d.bank_account_number::text as bank_account_number,
               d.basic_salary_per_day, d.ot_rate_per_hour, d.sun_ph_rate_per_day, d.monthly_allowance,
               d.deduction_1_name::text as deduction_1_name, d.deduction_1_amount, d.deduction_2_name::text as deduction_2_name, d.deduction_2_amount,
               d.deduction_3_name::text as deduction_3_name, d.deduction_3_amount,
               d.accumulated_net_pay, d.last_accumulation_date,
               null::numeric as cpf_employee_contribution, null::numeric as cpf_employer_contribution, null::numeric as sinda_contribution, null::boolean as sinda_eligible,
               d.annual_leave_balance::numeric as annual_leave_balance, d.annual_leave_limit::numeric as annual_leave_limit,
               d.medical_leave_balance::numeric as medical_leave_balance, d.medical_leave_limit::numeric as medical_leave_limit,
               d.hospitalization_leave_balance::numeric as hospitalization_leave_balance, d.hospitalization_leave_limit::numeric as hospitalization_leave_limit,
               d.biometric_enrolled, d.face_id_set, d.face_id_enabled
          from attendance.worker_details d where d.employee_id = p_id
        union all
        select l.employee_id::text, l.employee_name::text, l.nric_fin::text, l.designation::text,
               'local'::text, coalesce(l.in_company, true), l.date_joined, l.date_of_cessation, l.rejoin_dates,
               l.age, l.birthday, null::timestamptz,
               l.bank_account_number::text,
               l.basic_salary_per_day, l.ot_rate_per_hour, l.sun_ph_rate_per_day, l.monthly_allowance,
               l.deduction_1_name::text, l.deduction_1_amount, l.deduction_2_name::text, l.deduction_2_amount,
               l.deduction_3_name::text, l.deduction_3_amount,
               l.accumulated_net_pay, l.last_accumulation_date,
               l.cpf_employee_contribution, l.cpf_employer_contribution, l.sinda_contribution, l.sinda_eligible,
               l.annual_leave_balance::numeric, l.annual_leave_limit::numeric,
               l.medical_leave_balance::numeric, l.medical_leave_limit::numeric,
               l.hospitalization_leave_balance::numeric, l.hospitalization_leave_limit::numeric,
               null::boolean, l.face_id_set, l.face_id_enabled
          from attendance.local_worker_details l where l.employee_id = p_id
    ) x limit 1;
$$;

-- The worker's values as jsonb: every catalogue key (null when missing) + custom details keyed x_<slug>.
create or replace function core._wi_values(p_id text)
returns jsonb
language sql stable security definer set search_path = core as $$
    select jsonb_build_object('updated_at', i.updated_at)
        || coalesce((select jsonb_object_agg(f.key, to_jsonb(i) -> f.key) from core._wi_fields() f), '{}'::jsonb)
        || coalesce((select jsonb_object_agg(e.k, e.v -> 'value') from jsonb_each(i.extra) e(k, v)), '{}'::jsonb)
      from (select 1) one
      left join core.worker_info i on i.employee_id = p_id;
$$;

-- Custom detail names. p_id null → every custom detail anyone has; otherwise this worker's (stored values + any asked).
create or replace function core._wi_custom_labels(p_id text default null)
returns jsonb
language sql stable security definer set search_path = core as $$
    select coalesce(jsonb_object_agg(t.k, t.label), '{}'::jsonb) from (
        select distinct on (k) k, label from (
            select e.k, e.v ->> 'label' as label from core.worker_info i, jsonb_each(i.extra) e(k, v)
             where p_id is null or i.employee_id = p_id
            union all
            select e.key, e.value #>> '{}' from core.worker_info_requests r, jsonb_each(r.custom_labels) e
             where p_id is null or r.employee_id = p_id
        ) u where label is not null order by k, label
    ) t;
$$;

-- Apply submitted values (whitelisted keys, dates validated). Custom keys need a label (from p_labels or already stored).
drop function if exists core._wi_apply(text, jsonb, text);
create or replace function core._wi_apply(p_id text, p_values jsonb, p_actor text, p_labels jsonb default '{}'::jsonb)
returns text[]
language plpgsql volatile security definer set search_path = core as $$
declare
    f record;
    k text;
    raw text;
    lbl text;
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
    for k in select jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) loop
        if k !~ '^x_[a-z0-9_]{1,40}$' then
            continue;
        end if;
        lbl := coalesce(p_labels ->> k, (select i.extra -> k ->> 'label' from core.worker_info i where i.employee_id = p_id));
        if lbl is null then
            raise exception 'Unknown detail';
        end if;
        raw := nullif(trim(coalesce(p_values ->> k, '')), '');
        if raw is not null and length(raw) > 300 then
            raise exception '% is too long', lbl;
        end if;
        update core.worker_info
           set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object(k, jsonb_build_object('label', lbl, 'value', raw)),
               updated_at = now(), updated_by = p_actor
         where employee_id = p_id;
        keys := keys || k;
    end loop;
    return keys;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: save (custom labels of the worker's open requests are usable), profile, activity
-- ---------------------------------------------------------------------------
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
    keys := core._wi_apply(v_id, coalesce(p_values, '{}'::jsonb), v_actor, core._wi_custom_labels(v_id));
    if cardinality(keys) > 0 then
        insert into core.worker_info_audit (employee_id, action, fields, actor) values (v_id, 'admin_edit', keys, v_actor);
    end if;
    for r in select * from core.worker_info_requests where employee_id = v_id and status = 'pending' loop
        if not exists (select 1 from unnest(r.fields) f where nullif(trim(coalesce(core._wi_values(v_id) ->> f, '')), '') is null) then
            update core.worker_info_requests set status = 'completed', completed_at = now(), completed_by = 'admin:' || v_actor where id = r.id;
        end if;
    end loop;
    return core.admin_worker_profile(v_id);
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
        'base', core._wi_base_values(b.employee_id),
        'custom_labels', core._wi_custom_labels(b.employee_id),
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

create or replace function core.admin_info_activity()
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._wi_admin();
    return jsonb_build_object(
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'employee_id', r.employee_id, 'name', b.name,
                        'fields', r.fields, 'message', r.message, 'status', r.status, 'auto', r.auto, 'created_at', r.created_at,
                        'completed_at', r.completed_at, 'custom_labels', r.custom_labels) order by (r.status = 'pending') desc, coalesce(r.completed_at, r.created_at) desc)
                      from (select * from core.worker_info_requests order by created_at desc limit 300) r
                      left join core._wi_all_base() b on b.employee_id = r.employee_id), '[]'::jsonb),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'employee_id', c.employee_id, 'name', b.name,
                        'status', c.status, 'sent_at', c.sent_at, 'responded_at', c.responded_at, 'decline_reason', c.decline_reason,
                        'decline_fields', c.decline_fields, 'resolved_at', c.resolved_at)
                        order by (c.status = 'declined') desc, (c.status = 'pending') desc, coalesce(c.responded_at, c.sent_at) desc)
                      from (select * from core.worker_info_checks order by sent_at desc limit 300) c
                      left join core._wi_all_base() b on b.employee_id = c.employee_id), '[]'::jsonb),
        'settings', (select jsonb_build_object('required_fields', s.required_fields, 'auto_request', s.auto_request) from core.worker_info_settings s where s.id = 1),
        'custom_labels', core._wi_custom_labels(null)
    );
end;
$$;

create or replace function core.admin_info_custom_labels()
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._wi_admin();
    return core._wi_custom_labels(null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Request: a list of items, one per worker, each with its own details (+ custom questions)
--   p_items = [{"employee_id":"1006","fields":["hp_number","address"],"custom":["Shoe size"]}, ...]
-- ---------------------------------------------------------------------------
create or replace function core.admin_request_worker_info_items(p_items jsonb, p_message text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    it jsonb;
    v_id text;
    v_type text;
    v_fields text[];
    v_custom jsonb;
    v_labels jsonb;
    v_created int := 0;
    v_skipped int := 0;
    v_rid uuid;
    v_text text;
    c text;
    k text;
begin
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'Choose at least one worker';
    end if;
    if jsonb_array_length(p_items) > 500 then
        raise exception 'Too many workers at once';
    end if;
    for it in select * from jsonb_array_elements(p_items) loop
        v_id := trim(coalesce(it ->> 'employee_id', ''));
        select worker_type into v_type from core._wi_base(v_id);
        if v_type is null then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        select coalesce(array_agg(distinct f), '{}') into v_fields from jsonb_array_elements_text(coalesce(it -> 'fields', '[]'::jsonb)) f;
        if exists (select 1 from unnest(v_fields) f where f not in (select key from core._wi_fields())) then
            raise exception 'Unknown detail requested';
        end if;
        v_custom := '{}'::jsonb;
        for c in select jsonb_array_elements_text(coalesce(it -> 'custom', '[]'::jsonb)) loop
            c := trim(c);
            if length(c) < 2 or length(c) > 60 then
                raise exception 'A custom detail name must be 2 to 60 characters';
            end if;
            k := 'x_' || left(trim(both '_' from regexp_replace(lower(c), '[^a-z0-9]+', '_', 'g')), 38);
            if k = 'x_' then
                raise exception 'A custom detail name needs letters or numbers';
            end if;
            v_custom := v_custom || jsonb_build_object(k, c);
        end loop;
        v_fields := v_fields || coalesce((select array_agg(e.key) from jsonb_each(v_custom) e), '{}');
        select coalesce(array_agg(f), '{}') into v_fields from unnest(v_fields) f where not (f = any (core._wi_pending_fields(v_id)));
        if cardinality(v_fields) = 0 then
            v_skipped := v_skipped + 1;
            continue;
        end if;
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_labels from jsonb_each(v_custom) e where e.key = any (v_fields);
        insert into core.worker_info_requests (employee_id, fields, message, requested_by, custom_labels)
        values (v_id, v_fields, nullif(trim(coalesce(p_message, '')), ''), v_actor, v_labels)
        returning id into v_rid;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'request_sent', v_fields, v_actor, v_rid);
        select string_agg(coalesce((select label from core._wi_fields() where key = f), v_labels ->> f, f), ', ') into v_text from unnest(v_fields) f;
        perform core._wi_push_worker(v_id, 'Information needed', 'Please provide: ' || v_text);
        v_created := v_created + 1;
    end loop;
    return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Export: any non-secret detail (catalogue, master record, pay, leave, custom). Enforced here.
-- ---------------------------------------------------------------------------
create or replace function core.admin_export_workers(p_employee_ids text[], p_scope text, p_fields text[])
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    allowed text[] := array['employee_id', 'name', 'nric_fin', 'designation', 'worker_type', 'in_company', 'date_joined', 'date_of_cessation',
                            'rejoin_dates', 'age', 'birthday', 'created_at', 'bank_account_number', 'basic_salary_per_day', 'ot_rate_per_hour',
                            'sun_ph_rate_per_day', 'monthly_allowance', 'deduction_1_name', 'deduction_1_amount', 'deduction_2_name',
                            'deduction_2_amount', 'deduction_3_name', 'deduction_3_amount', 'accumulated_net_pay', 'last_accumulation_date',
                            'cpf_employee_contribution', 'cpf_employer_contribution', 'sinda_contribution', 'sinda_eligible',
                            'annual_leave_balance', 'annual_leave_limit', 'medical_leave_balance', 'medical_leave_limit',
                            'hospitalization_leave_balance', 'hospitalization_leave_limit', 'biometric_enrolled', 'face_id_set', 'face_id_enabled']
                      || (select array_agg(key) from core._wi_fields());
    sel text[];
begin
    perform core._wi_admin();
    select coalesce(array_agg(f), '{}') into sel from unnest(coalesce(p_fields, '{}')) f where f = any (allowed) or f ~ '^x_[a-z0-9_]{1,40}$';
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'card', jsonb_build_object('employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type,
                                       'designation', b.designation, 'in_company', b.in_company,
                                       'work_permit_no', i.work_permit_no,
                                       'photo', (select p.photo from core.worker_photos p where p.employee_id = b.employee_id)),
            'values', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
                         from jsonb_each(coalesce(core._wi_base_values(b.employee_id), '{}'::jsonb) || core._wi_values(b.employee_id)) e(k, v)
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
-- Worker side: custom labels travel with the request / the check
-- ---------------------------------------------------------------------------
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
                        'auto', r.auto, 'created_at', r.created_at, 'custom_labels', r.custom_labels) order by r.created_at)
                      from core.worker_info_requests r where r.employee_id = v_id and r.status = 'pending'), '[]'::jsonb),
        'check', case when c.id is null then null else jsonb_build_object(
                     'id', c.id, 'sent_at', c.sent_at,
                     'details', jsonb_build_object('employee_id', b.employee_id, 'name', b.name, 'designation', b.designation,
                                                   'worker_type', b.worker_type, 'date_joined', b.date_joined,
                                                   'custom_labels', core._wi_custom_labels(v_id))
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
            raise exception 'Please fill in: %', coalesce((select label from core._wi_fields() where key = f), r.custom_labels ->> f, f);
        end if;
    end loop;
    -- Only the requested fields are written.
    perform core._wi_apply(v_id, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_values) e(k, v) where k = any (r.fields)),
                           'worker:' || v_id, r.custom_labels);
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
                                  where f = any (array['name', 'designation', 'date_joined'] || (select array_agg(key) from core._wi_fields()))
                                     or f ~ '^x_[a-z0-9_]{1,40}$')
         where id = c.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'check_declined', p_fields, 'worker:' || v_id, c.id);
        perform core._wi_push_admins('Information check declined', coalesce(b.name, v_id) || ' (' || v_id || ') says some details are wrong.');
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
    foreach f in array array['core._wi_base_values(text)', 'core._wi_custom_labels(text)', 'core._wi_apply(text, jsonb, text, jsonb)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
    foreach f in array array['core.admin_save_worker_info(text, jsonb)', 'core.admin_worker_profile(text)', 'core.admin_info_activity()',
        'core.admin_info_custom_labels()', 'core.admin_request_worker_info_items(jsonb, text)', 'core.admin_export_workers(text[], text, text[])'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
    foreach f in array array['core.my_info_tasks(text)', 'core.submit_info_request(text, uuid, jsonb)',
        'core.respond_info_check(text, uuid, boolean, text, text[])'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
end $$;
