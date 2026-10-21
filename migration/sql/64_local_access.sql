-- =====================================================================================
-- Local workers' HR table (attendance.local_worker_details, 63_local_worker_details_rls.sql) is
-- admin-only. These functions give everyone else exactly what they need, nothing more:
--   · core.worker_type_of(id)          → 'local' | 'foreign' | null     (pre-login: which login path)
--   · core.my_worker_record(token)     → the signed-in worker's OWN non-secret record (either type)
--   · core.local_worker_ids(token)     → IDs of local workers (no names, no HR) for admin / manager /
--                                        supervisor sessions, so the apps can leave them out of lists
-- =====================================================================================
create or replace function core.worker_type_of(p_employee_id text)
returns text
language sql
stable
security definer
set search_path = core
as $$
    select case
        when exists (select 1 from attendance.local_worker_details l where l.employee_id = trim(p_employee_id)) then 'local'
        when exists (select 1 from attendance.worker_details d where d.employee_id = trim(p_employee_id)) then 'foreign'
    end;
$$;

create or replace function core.my_worker_record(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = core
as $$
declare
    a record;
    r jsonb;
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is distinct from 'worker' then
        return null;
    end if;
    select jsonb_build_object(
               'employee_id', d.employee_id, 'worker_type', 'foreign', 'employee_name', d.employee_name,
               'designation', d.designation, 'in_company', coalesce(d.in_company, true),
               'annual_leave_balance', d.annual_leave_balance, 'medical_leave_balance', d.medical_leave_balance,
               'hospitalization_leave_balance', d.hospitalization_leave_balance,
               'annual_leave_limit', d.annual_leave_limit, 'medical_leave_limit', d.medical_leave_limit,
               'hospitalization_leave_limit', d.hospitalization_leave_limit)
      into r from attendance.worker_details d where d.employee_id = a.who;
    if r is null then
        select jsonb_build_object(
                   'employee_id', l.employee_id, 'worker_type', 'local', 'employee_name', l.employee_name,
                   'designation', l.designation, 'in_company', coalesce(l.in_company, true),
                   'annual_leave_balance', l.annual_leave_balance, 'medical_leave_balance', l.medical_leave_balance,
                   'hospitalization_leave_balance', l.hospitalization_leave_balance,
                   'annual_leave_limit', l.annual_leave_limit, 'medical_leave_limit', l.medical_leave_limit,
                   'hospitalization_leave_limit', l.hospitalization_leave_limit)
          into r from attendance.local_worker_details l where l.employee_id = a.who;
    end if;
    return r;
end;
$$;

create or replace function core.local_worker_ids(p_token text)
returns text[]
language plpgsql
stable
security definer
set search_path = core
as $$
declare
    a record;
begin
    select * into a from core.dep_actor(p_token);
    if a.kind is null or a.kind = 'worker' then
        raise exception 'Not allowed';
    end if;
    return coalesce((select array_agg(l.employee_id::text order by l.employee_id) from attendance.local_worker_details l), '{}');
end;
$$;

revoke all on function core.worker_type_of(text) from public, anon, authenticated;
revoke all on function core.my_worker_record(text) from public, anon, authenticated;
revoke all on function core.local_worker_ids(text) from public, anon, authenticated;
grant execute on function core.worker_type_of(text) to anon, authenticated;
grant execute on function core.my_worker_record(text) to anon, authenticated;
grant execute on function core.local_worker_ids(text) to anon, authenticated;
grant execute on all functions in schema core to service_role;
