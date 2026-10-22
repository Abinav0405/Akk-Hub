-- AKK Hub — worker information: Age is calculated from the date of birth (the worker's Date of Birth detail,
-- or the payroll birthday for local staff); the stored age is only used when no birth date exists. Idempotent.
create or replace function core._wi_base_values(p_id text)
returns jsonb
language sql stable security definer set search_path = core as $$
    select to_jsonb(x) from (
        select d.employee_id::text as employee_id, d.employee_name::text as name, d.nric_fin::text as nric_fin, d.designation::text as designation,
               'foreign'::text as worker_type, coalesce(d.in_company, true) as in_company, d.date_joined, d.date_of_cessation, d.rejoin_dates,
               case when wi.date_of_birth is null then d.age else date_part('year', age(current_date, wi.date_of_birth))::int end as age, null::date as birthday, d.created_at,
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
          from attendance.worker_details d left join core.worker_info wi on wi.employee_id = d.employee_id where d.employee_id = p_id
        union all
        select l.employee_id::text, l.employee_name::text, l.nric_fin::text, l.designation::text,
               'local'::text, coalesce(l.in_company, true), l.date_joined, l.date_of_cessation, l.rejoin_dates,
               case when coalesce(wi.date_of_birth, l.birthday) is null then l.age else date_part('year', age(current_date, coalesce(wi.date_of_birth, l.birthday)))::int end, l.birthday, null::timestamptz,
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
          from attendance.local_worker_details l left join core.worker_info wi on wi.employee_id = l.employee_id where l.employee_id = p_id
    ) x limit 1;
$$;
revoke all on function core._wi_base_values(text) from public, anon, authenticated;
