-- AKK Hub — worker information: NRIC / FIN and bank account number can be requested from a worker.
-- These live in the Attendance master record (payroll), so a worker's answer is NOT written directly:
-- it waits in the request (status 'review') until an admin approves it, and only then is copied to
-- attendance.worker_details / attendance.local_worker_details. Idempotent; depends on 80 + 82.

alter table core.worker_info_requests
    add column if not exists submitted jsonb,
    add column if not exists review_note text;

do $$
declare c text;
begin
    for c in select conname from pg_constraint
              where conrelid = 'core.worker_info_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%pending%completed%cancelled%' loop
        execute format('alter table core.worker_info_requests drop constraint %I', c);
    end loop;
    if not exists (select 1 from pg_constraint where conrelid = 'core.worker_info_requests'::regclass and conname = 'worker_info_requests_status_ck') then
        alter table core.worker_info_requests add constraint worker_info_requests_status_ck
            check (status in ('pending', 'review', 'completed', 'cancelled', 'rejected'));
    end if;
end $$;

-- Master-record details a worker may be asked for (admin approves before they are saved).
create or replace function core._wi_master_fields()
returns table (key text, label text)
language sql immutable as $$
    values ('nric_fin', 'NRIC / FIN'), ('bank_account_number', 'Bank Account Number')
$$;

-- Details asked and not yet settled (waiting for the worker, or for the admin's approval).
create or replace function core._wi_pending_fields(p_id text)
returns text[]
language sql stable security definer set search_path = core as $$
    select coalesce(array_agg(distinct f), '{}') from core.worker_info_requests r, unnest(r.fields) f
     where r.employee_id = p_id and r.status in ('pending', 'review');
$$;

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
        if exists (select 1 from unnest(v_fields) f
                    where f not in (select key from core._wi_fields()) and f not in (select key from core._wi_master_fields())) then
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
        select string_agg(coalesce((select label from core._wi_fields() where key = f), (select label from core._wi_master_fields() where key = f), v_labels ->> f, f), ', ')
          into v_text from unnest(v_fields) f;
        perform core._wi_push_worker(v_id, 'Information needed', 'Please provide: ' || v_text);
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
    update core.worker_info_requests set status = 'cancelled', completed_at = now(), completed_by = 'admin:' || v_actor, submitted = null
     where id = p_request_id and status in ('pending', 'review') returning * into r;
    if r.id is not null then
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (r.employee_id, 'request_cancelled', r.fields, v_actor, r.id);
    end if;
end;
$$;

-- Worker answers a request. Catalogue + custom details are saved at once; NRIC / bank go to review.
create or replace function core.submit_info_request(p_token text, p_request_id uuid, p_values jsonb)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id text := core._wi_me(p_token);
    r record;
    f text;
    v_name text;
    v_raw text;
    v_sub jsonb := '{}'::jsonb;
    v_master boolean := false;
begin
    select * into r from core.worker_info_requests where id = p_request_id for update;
    if r.id is null or r.employee_id <> v_id then
        raise exception 'Request not found';
    end if;
    if r.status <> 'pending' then
        raise exception 'This request was already completed';
    end if;
    foreach f in array r.fields loop
        v_raw := nullif(trim(coalesce(p_values ->> f, '')), '');
        if v_raw is null then
            raise exception 'Please fill in: %', coalesce((select label from core._wi_fields() where key = f),
                                                         (select label from core._wi_master_fields() where key = f), r.custom_labels ->> f, f);
        end if;
        if f = 'nric_fin' then
            v_raw := upper(v_raw);
            if v_raw !~ '^[STFGM][0-9]{7}[A-Z]$' then
                raise exception 'NRIC / FIN must look like S1234567A';
            end if;
            v_sub := v_sub || jsonb_build_object(f, v_raw);
            v_master := true;
        elsif f = 'bank_account_number' then
            if v_raw !~ '^[A-Za-z0-9 ./()-]{5,60}$' then
                raise exception 'Bank account number must be 5 to 60 characters (letters, numbers, spaces, - . /)';
            end if;
            v_sub := v_sub || jsonb_build_object(f, v_raw);
            v_master := true;
        end if;
    end loop;
    -- Catalogue + custom details are written now (master keys are ignored by _wi_apply).
    perform core._wi_apply(v_id, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_values) e(k, v) where k = any (r.fields)),
                           'worker:' || v_id, r.custom_labels);
    select name into v_name from core._wi_base(v_id);
    if v_master then
        update core.worker_info_requests set status = 'review', completed_at = now(), completed_by = 'worker', submitted = v_sub where id = r.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'request_submitted', r.fields, 'worker:' || v_id, r.id);
        perform core._wi_push_admins('Employee information needs approval', coalesce(v_name, v_id) || ' (' || v_id || ') sent NRIC / bank details to approve.');
    else
        update core.worker_info_requests set status = 'completed', completed_at = now(), completed_by = 'worker' where id = r.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref) values (v_id, 'request_completed', r.fields, 'worker:' || v_id, r.id);
        perform core._wi_push_admins('Employee information updated', coalesce(v_name, v_id) || ' (' || v_id || ') sent the requested details.');
    end if;
end;
$$;

-- Admin approves (copies the submitted NRIC / bank to the master record) or rejects (nothing is changed).
create or replace function core.admin_review_info_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    r record;
    k text;
    v text;
    n int;
begin
    select * into r from core.worker_info_requests where id = p_request_id and status = 'review' for update;
    if r.id is null then
        raise exception 'Nothing to review';
    end if;
    if p_approve then
        for k, v in select e.key, e.value #>> '{}' from jsonb_each(coalesce(r.submitted, '{}'::jsonb)) e loop
            if k = 'nric_fin' then
                update attendance.worker_details set nric_fin = v where employee_id = r.employee_id;
                get diagnostics n = row_count;
                if n = 0 then
                    update attendance.local_worker_details set nric_fin = v where employee_id = r.employee_id;
                    get diagnostics n = row_count;
                end if;
            elsif k = 'bank_account_number' then
                update attendance.worker_details set bank_account_number = v where employee_id = r.employee_id;
                get diagnostics n = row_count;
                if n = 0 then
                    update attendance.local_worker_details set bank_account_number = v where employee_id = r.employee_id;
                    get diagnostics n = row_count;
                end if;
            else
                continue;
            end if;
            if n = 0 then
                raise exception 'Worker record not found';
            end if;
        end loop;
        update core.worker_info_requests set status = 'completed', completed_at = now(), completed_by = 'admin:' || v_actor,
               submitted = null, review_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref)
        values (r.employee_id, 'master_approved', array(select jsonb_object_keys(coalesce(r.submitted, '{}'::jsonb))), v_actor, r.id);
    else
        update core.worker_info_requests set status = 'rejected', completed_at = now(), completed_by = 'admin:' || v_actor,
               submitted = null, review_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
        insert into core.worker_info_audit (employee_id, action, fields, actor, ref)
        values (r.employee_id, 'master_rejected', array(select jsonb_object_keys(coalesce(r.submitted, '{}'::jsonb))), v_actor, r.id);
        perform core._wi_push_worker(r.employee_id, 'Information not accepted', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Please check the details you sent with the office.'));
    end if;
end;
$$;

-- Profile: requests now carry what is waiting for approval.
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
                                    'completed_at', r.completed_at, 'completed_by', r.completed_by,
                                    'submitted', r.submitted, 'review_note', r.review_note) order by r.created_at desc)
                                from (select * from core.worker_info_requests where employee_id = b.employee_id order by created_at desc limit 20) r), '[]'::jsonb),
        'checks', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'sent_by', c.sent_by, 'sent_at', c.sent_at,
                                    'responded_at', c.responded_at, 'decline_reason', c.decline_reason, 'decline_fields', c.decline_fields,
                                    'resolved_by', c.resolved_by, 'resolved_at', c.resolved_at, 'resolution_note', c.resolution_note) order by c.sent_at desc)
                              from (select * from core.worker_info_checks where employee_id = b.employee_id order by sent_at desc limit 10) c), '[]'::jsonb)
    );
end;
$$;

do $$
declare f text;
begin
    execute 'revoke all on function core._wi_master_fields() from public, anon, authenticated';
    foreach f in array array['core.admin_request_worker_info_items(jsonb, text)', 'core.admin_cancel_info_request(uuid)',
        'core.admin_review_info_request(uuid, boolean, text)', 'core.admin_worker_profile(text)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
    execute 'revoke all on function core.submit_info_request(text, uuid, jsonb) from public';
    execute 'grant execute on function core.submit_info_request(text, uuid, jsonb) to anon, authenticated';
end $$;
