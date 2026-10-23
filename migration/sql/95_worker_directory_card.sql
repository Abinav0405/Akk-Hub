-- AKK Hub — include current AKK ID card_number on admin_worker_directory so
-- "Find a worker" can search by card number (same employee_id link as core.employee_cards).

create or replace function core.admin_worker_directory(p_scope text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._wi_admin();
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type, 'designation', b.designation,
            'in_company', b.in_company, 'work_permit_no', i.work_permit_no, 'hp_number', i.hp_number,
            'card_number', (
                select c.card_number from core.employee_cards c
                 where c.employee_id = b.employee_id
                 order by (c.status = 'active') desc, c.issued_at desc
                 limit 1
            ),
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
