-- AKK Hub — document expiry alerts (safety certificate, work permit, ID card).
--   · Admin directory / lists: yellow name when any date is past or within 30 days.
--   · Worker push: once per (employee, kind, expiry_date, phase) via attendance device tokens
--     (core._wi_push_worker → prg-push-send). Same durable pattern as leave reminder_sent_at.
-- Schedule daily: edge att-expiry-reminder (or pg_cron → net.http_post) with x-akk-fcm-secret.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Durable “already notified for this expiry date” (window = ≤30d ahead; expired = on/after day)
-- ---------------------------------------------------------------------------
create table if not exists core.expiry_notifications (
    employee_id text not null,
    kind text not null check (kind in ('permit', 'safety', 'card')),
    expiry_date date not null,
    phase text not null check (phase in ('window', 'expired')),
    notified_at timestamptz not null default now(),
    primary key (employee_id, kind, expiry_date, phase)
);

create index if not exists expiry_notifications_emp_idx on core.expiry_notifications (employee_id);

alter table core.expiry_notifications enable row level security;
revoke all on table core.expiry_notifications from public, anon, authenticated;
grant all on table core.expiry_notifications to service_role;

-- True when date is real (not 9999 “no expiry”) and ≤ today+30 (includes already past).
create or replace function core._expiry_due(p_date date, p_today date)
returns boolean
language sql immutable as $$
    select p_date is not null
       and p_date < date '9999-01-01'
       and p_date <= (p_today + 30);
$$;

create or replace function core._expiry_sgt_today()
returns date
language sql stable as $$
    select (timezone('Asia/Singapore', now()))::date;
$$;

-- Active card valid_until (null if none).
create or replace function core._expiry_card_until(p_employee_id text)
returns date
language sql stable security definer set search_path = core as $$
    select c.valid_until
      from core.employee_cards c
     where c.employee_id = trim(p_employee_id) and c.status = 'active'
     order by c.issued_at desc
     limit 1;
$$;

-- Directory: card number + expiry dates + expiry_alert for admin lists / Find a worker.
create or replace function core.admin_worker_directory(p_scope text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    v_today date := core._expiry_sgt_today();
begin
    perform core._wi_admin();
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'employee_id', b.employee_id, 'name', b.name, 'worker_type', b.worker_type, 'designation', b.designation,
            'in_company', b.in_company, 'work_permit_no', i.work_permit_no, 'hp_number', i.hp_number,
            'permit_expiry_date', case when b.worker_type = 'local' then null else i.permit_expiry_date end,
            'safety_cert_expiry_date', i.safety_cert_expiry_date,
            'card_number', (
                select c.card_number from core.employee_cards c
                 where c.employee_id = b.employee_id
                 order by (c.status = 'active') desc, c.issued_at desc
                 limit 1
            ),
            'card_valid_until', core._expiry_card_until(b.employee_id),
            'expiry_alert', (
                core._expiry_due(i.safety_cert_expiry_date, v_today)
                or (b.worker_type <> 'local' and core._expiry_due(i.permit_expiry_date, v_today))
                or core._expiry_due(core._expiry_card_until(b.employee_id), v_today)
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

-- Lightweight id list for Admin Workers tables / access list (no full directory payload).
create or replace function core.admin_expiry_alert_ids()
returns text[]
language plpgsql stable security definer set search_path = core as $$
declare
    v_today date := core._expiry_sgt_today();
    v_ids text[];
begin
    perform core._wi_admin();
    select coalesce(array_agg(b.employee_id order by b.employee_id), '{}')
      into v_ids
      from core._wi_all_base() b
      left join core.worker_info i on i.employee_id = b.employee_id
     where core._expiry_due(i.safety_cert_expiry_date, v_today)
        or (b.worker_type <> 'local' and core._expiry_due(i.permit_expiry_date, v_today))
        or core._expiry_due(core._expiry_card_until(b.employee_id), v_today);
    return v_ids;
end;
$$;

-- Daily cron / edge: notify workers entering the 30-day window, and again on/after expiry day.
-- Idempotent via core.expiry_notifications. Service role only (no admin JWT).
create or replace function core.run_expiry_reminders()
returns jsonb
language plpgsql security definer set search_path = core as $$
declare
    v_today date := core._expiry_sgt_today();
    r record;
    v_sent int := 0;
    v_skipped int := 0;
    v_title text;
    v_body text;
    v_label text;
    v_when text;
begin
    for r in
        with cand as (
            select b.employee_id, b.name, 'permit'::text as kind, i.permit_expiry_date as expiry_date
              from core._wi_all_base() b
              join core.worker_info i on i.employee_id = b.employee_id
             where b.in_company and b.worker_type <> 'local' and core._expiry_due(i.permit_expiry_date, v_today)
            union all
            select b.employee_id, b.name, 'safety', i.safety_cert_expiry_date
              from core._wi_all_base() b
              join core.worker_info i on i.employee_id = b.employee_id
             where b.in_company and core._expiry_due(i.safety_cert_expiry_date, v_today)
            union all
            select b.employee_id, b.name, 'card', core._expiry_card_until(b.employee_id)
              from core._wi_all_base() b
             where b.in_company and core._expiry_due(core._expiry_card_until(b.employee_id), v_today)
        )
        select * from cand
    loop
        declare
            v_phase text := case when r.expiry_date <= v_today then 'expired' else 'window' end;
            v_days int := (r.expiry_date - v_today);
        begin
            if exists (
                select 1 from core.expiry_notifications n
                 where n.employee_id = r.employee_id and n.kind = r.kind
                   and n.expiry_date = r.expiry_date and n.phase = v_phase
            ) then
                v_skipped := v_skipped + 1;
                continue;
            end if;

            v_label := case r.kind
                when 'permit' then 'work permit'
                when 'safety' then 'safety certificate'
                else 'ID card' end;
            v_when := to_char(r.expiry_date, 'DD Mon YYYY');
            if v_phase = 'expired' then
                v_title := case r.kind
                    when 'permit' then 'Work permit expired'
                    when 'safety' then 'Safety certificate expired'
                    else 'ID card expired' end;
                v_body := 'Your ' || v_label || ' expired on ' || v_when || '. Please renew it and update your details in the app.';
            else
                v_title := case r.kind
                    when 'permit' then 'Work permit expiring soon'
                    when 'safety' then 'Safety certificate expiring soon'
                    else 'ID card expiring soon' end;
                v_body := 'Your ' || v_label || ' expires on ' || v_when
                    || ' (in ' || v_days || ' day' || case when v_days = 1 then '' else 's' end
                    || '). Please renew it soon.';
            end if;

            perform core._wi_push_worker(r.employee_id, v_title, v_body);
            insert into core.expiry_notifications (employee_id, kind, expiry_date, phase)
            values (r.employee_id, r.kind, r.expiry_date, v_phase)
            on conflict do nothing;
            v_sent := v_sent + 1;
        end;
    end loop;

    return jsonb_build_object('ok', true, 'today', v_today, 'sent', v_sent, 'skipped', v_skipped);
end;
$$;

revoke all on function core._expiry_due(date, date) from public, anon, authenticated;
revoke all on function core._expiry_sgt_today() from public, anon, authenticated;
revoke all on function core._expiry_card_until(text) from public, anon, authenticated;
revoke all on function core.run_expiry_reminders() from public, anon, authenticated;
grant execute on function core.run_expiry_reminders() to service_role;

revoke all on function core.admin_expiry_alert_ids() from public, anon;
grant execute on function core.admin_expiry_alert_ids() to authenticated;
grant execute on function core.admin_worker_directory(text) to authenticated;
grant execute on function core.admin_expiry_alert_ids() to service_role;
grant execute on function core.admin_worker_directory(text) to service_role;
