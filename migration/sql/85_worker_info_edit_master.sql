-- AKK Hub — admin can edit Attendance master fields from the worker profile sheet
-- (not only the 10 worker_info catalogue details). Idempotent; depends on 80 + 82 + 84.
-- Employee ID and worker type stay immutable here (ID rename needs cascading FKs;
-- type change would move the row between local/foreign tables). Face enrollment
-- flags and record-created stay system-owned.

-- Editable master keys the admin profile form may send (API key → DB column where different).
create or replace function core._wi_master_edit_fields()
returns table (key text, label text, kind text, col text, applies text)
language sql immutable as $$
    values
        ('name',                          'Full Name',                         'text',   'employee_name',               'all'),
        ('nric_fin',                      'NRIC / FIN',                        'text',   'nric_fin',                    'all'),
        ('designation',                   'Designation',                       'text',   'designation',                 'all'),
        ('in_company',                    'Employment Status',                 'bool',   'in_company',                  'all'),
        ('date_joined',                   'Date Joined',                       'date',   'date_joined',                 'all'),
        ('date_of_cessation',             'Date of Cessation',                 'date',   'date_of_cessation',           'all'),
        ('rejoin_dates',                  'Rejoin Dates',                      'dates',  'rejoin_dates',                'all'),
        ('age',                           'Age',                               'num',    'age',                         'foreign'),
        ('birthday',                      'Birthday',                          'date',   'birthday',                    'local'),
        ('bank_account_number',           'Bank Account Number',               'text',   'bank_account_number',         'all'),
        ('basic_salary_per_day',          'Basic Salary (per day)',            'money',  'basic_salary_per_day',        'all'),
        ('ot_rate_per_hour',              'OT Rate (per hour)',                'money',  'ot_rate_per_hour',            'all'),
        ('sun_ph_rate_per_day',           'Sunday / PH Rate (per day)',        'money',  'sun_ph_rate_per_day',         'all'),
        ('monthly_allowance',             'Monthly Allowance',                 'money',  'monthly_allowance',           'all'),
        ('accumulated_net_pay',           'Accumulated Net Pay',               'money',  'accumulated_net_pay',         'all'),
        ('last_accumulation_date',        'Last Accumulation Date',            'date',   'last_accumulation_date',      'all'),
        ('cpf_employee_contribution',     'CPF — Employee',                    'money',  'cpf_employee_contribution',   'local'),
        ('cpf_employer_contribution',     'CPF — Employer',                    'money',  'cpf_employer_contribution',   'local'),
        ('sinda_contribution',            'SINDA Contribution',                'money',  'sinda_contribution',          'local'),
        ('sinda_eligible',                'SINDA Eligible',                    'bool',   'sinda_eligible',              'local'),
        ('deduction_1_name',              'Deduction 1 — Name',                'text',   'deduction_1_name',            'all'),
        ('deduction_1_amount',            'Deduction 1 — Amount',              'money',  'deduction_1_amount',          'all'),
        ('deduction_2_name',              'Deduction 2 — Name',                'text',   'deduction_2_name',            'all'),
        ('deduction_2_amount',            'Deduction 2 — Amount',              'money',  'deduction_2_amount',          'all'),
        ('deduction_3_name',              'Deduction 3 — Name',                'text',   'deduction_3_name',            'all'),
        ('deduction_3_amount',            'Deduction 3 — Amount',              'money',  'deduction_3_amount',          'all'),
        ('annual_leave_balance',          'Annual Leave Balance',              'num',    'annual_leave_balance',        'all'),
        ('annual_leave_limit',            'Annual Leave Limit',                'num',    'annual_leave_limit',          'all'),
        ('medical_leave_balance',         'Medical Leave Balance',             'num',    'medical_leave_balance',       'all'),
        ('medical_leave_limit',           'Medical Leave Limit',               'num',    'medical_leave_limit',         'all'),
        ('hospitalization_leave_balance', 'Hospitalisation Leave Balance',     'num',    'hospitalization_leave_balance','all'),
        ('hospitalization_leave_limit',   'Hospitalisation Leave Limit',       'num',    'hospitalization_leave_limit', 'all'),
        ('face_id_enabled',               'Face ID Enabled',                   'bool',   'face_id_enabled',             'all')
$$;

-- Write whitelisted master fields onto attendance.worker_details / local_worker_details.
create or replace function core._wi_apply_master(p_id text, p_values jsonb, p_actor text)
returns text[]
language plpgsql volatile security definer set search_path = core as $$
declare
    v_type text;
    f record;
    raw text;
    keys text[] := '{}';
    v_bool boolean;
    v_num numeric;
    v_dates jsonb;
    v_name text;
    n int;
    tbl text;
begin
    select worker_type into v_type from core._wi_base(p_id);
    if v_type is null then
        raise exception 'Worker not found';
    end if;
    tbl := case when v_type = 'local' then 'attendance.local_worker_details' else 'attendance.worker_details' end;

    for f in select * from core._wi_master_edit_fields() loop
        if not (p_values ? f.key) then
            continue;
        end if;
        if f.applies <> 'all' and f.applies <> v_type then
            continue;
        end if;

        raw := nullif(trim(coalesce(p_values ->> f.key, '')), '');

        if f.key = 'name' then
            v_name := coalesce(raw, '');
            if v_name = '' then
                raise exception 'Full Name is required';
            end if;
            if length(v_name) > 120 then
                raise exception 'Full Name is too long';
            end if;
            execute format('update %s set employee_name = $1 where employee_id = $2', tbl) using v_name, p_id;
            get diagnostics n = row_count;
            if n = 0 then raise exception 'Worker record not found'; end if;
            keys := keys || f.key;
            continue;
        end if;

        if f.key = 'nric_fin' then
            if raw is not null then
                raw := upper(raw);
                -- Accept a full NRIC/FIN, or leave transitional / already-masked values editable.
                if raw ~ '^[STFGM]' and raw !~ '^[STFGM][0-9]{7}[A-Z]$' and raw !~ 'x' then
                    raise exception 'NRIC / FIN must look like S1234567A';
                end if;
                if length(raw) > 20 then
                    raise exception 'NRIC / FIN is too long';
                end if;
            end if;
            execute format('update %s set nric_fin = $1 where employee_id = $2', tbl) using raw, p_id;
            get diagnostics n = row_count;
            if n = 0 then raise exception 'Worker record not found'; end if;
            keys := keys || f.key;
            continue;
        end if;

        if f.kind = 'bool' then
            if raw is null then
                v_bool := null;
            elsif lower(raw) in ('true', '1', 'yes', 'y', 'employed') then
                v_bool := true;
            elsif lower(raw) in ('false', '0', 'no', 'n', 'not in company') then
                v_bool := false;
            else
                raise exception '% must be yes or no', f.label;
            end if;
            if f.key = 'in_company' and v_bool is null then
                v_bool := true;
            end if;
            execute format('update %s set %I = $1 where employee_id = $2', tbl, f.col) using v_bool, p_id;
            get diagnostics n = row_count;
            if n = 0 then raise exception 'Worker record not found'; end if;
            keys := keys || f.key;
            continue;
        end if;

        if f.kind = 'date' then
            if raw is not null then
                begin
                    perform raw::date;
                exception when others then
                    raise exception '% must be a valid date', f.label;
                end;
            end if;
            execute format('update %s set %I = $1::date where employee_id = $2', tbl, f.col)
              using raw, p_id;
            get diagnostics n = row_count;
            if n = 0 then raise exception 'Worker record not found'; end if;
            keys := keys || f.key;
            continue;
        end if;

        if f.kind = 'dates' then
            -- Comma / newline separated YYYY-MM-DD → jsonb array (Attendance.rejoin_dates is jsonb).
            select coalesce(jsonb_agg(d order by d), '[]'::jsonb) into v_dates
              from (
                select distinct trim(both from x) as d
                  from regexp_split_to_table(coalesce(raw, ''), '[,;\n]+') x
                 where nullif(trim(both from x), '') is not null
              ) s;
            if exists (
                select 1 from jsonb_array_elements_text(v_dates) d
                 where d !~ '^\d{4}-\d{2}-\d{2}$'
            ) then
                raise exception 'Rejoin Dates must be YYYY-MM-DD (comma-separated)';
            end if;
            begin
                perform d::date from jsonb_array_elements_text(v_dates) d;
            exception when others then
                raise exception 'Rejoin Dates must be valid dates';
            end;
            execute format('update %s set rejoin_dates = $1 where employee_id = $2', tbl) using v_dates, p_id;
            get diagnostics n = row_count;
            if n = 0 then raise exception 'Worker record not found'; end if;
            keys := keys || f.key;
            continue;
        end if;

        if f.kind in ('money', 'num') then
            if raw is null then
                v_num := null;
            else
                begin
                    v_num := raw::numeric;
                exception when others then
                    raise exception '% must be a number', f.label;
                end;
            end if;
            execute format('update %s set %I = $1 where employee_id = $2', tbl, f.col) using v_num, p_id;
            get diagnostics n = row_count;
            if n = 0 then raise exception 'Worker record not found'; end if;
            keys := keys || f.key;
            continue;
        end if;

        -- text
        if raw is not null and length(raw) > 300 then
            raise exception '% is too long', f.label;
        end if;
        execute format('update %s set %I = $1 where employee_id = $2', tbl, f.col) using raw, p_id;
        get diagnostics n = row_count;
        if n = 0 then raise exception 'Worker record not found'; end if;
        keys := keys || f.key;
    end loop;

    return keys;
end;
$$;

-- Save: catalogue (worker_info) + master (Attendance) in one admin call.
create or replace function core.admin_save_worker_info(p_employee_id text, p_values jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._wi_admin();
    v_id text := trim(p_employee_id);
    keys text[];
    master_keys text[];
    r record;
    all_keys text[];
begin
    if not exists (select 1 from core._wi_base(v_id)) then
        raise exception 'Worker not found';
    end if;
    keys := core._wi_apply(v_id, coalesce(p_values, '{}'::jsonb), v_actor, core._wi_custom_labels(v_id));
    master_keys := core._wi_apply_master(v_id, coalesce(p_values, '{}'::jsonb), v_actor);
    all_keys := coalesce(keys, '{}') || coalesce(master_keys, '{}');
    if cardinality(all_keys) > 0 then
        insert into core.worker_info_audit (employee_id, action, fields, actor)
        values (v_id, 'admin_edit', all_keys, v_actor);
    end if;
    for r in select * from core.worker_info_requests where employee_id = v_id and status = 'pending' loop
        if not exists (select 1 from unnest(r.fields) f where nullif(trim(coalesce(core._wi_values(v_id) ->> f, '')), '') is null) then
            update core.worker_info_requests set status = 'completed', completed_at = now(), completed_by = 'admin:' || v_actor where id = r.id;
        end if;
    end loop;
    return core.admin_worker_profile(v_id);
end;
$$;

do $$
declare f text;
begin
    execute 'revoke all on function core._wi_master_edit_fields() from public, anon, authenticated';
    execute 'revoke all on function core._wi_apply_master(text, jsonb, text) from public, anon, authenticated';
    foreach f in array array['core.admin_save_worker_info(text, jsonb)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
