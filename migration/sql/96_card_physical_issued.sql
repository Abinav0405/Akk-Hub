-- AKK Hub — "physical card issued": an admin marks when the printed card was handed to the person.
-- The holder's self-report "Lost your card?" only works once the physical card has been issued (a digital-only
-- card cannot be lost). A renewed card starts as not-issued again. Idempotent; runs after 91–95.

alter table core.employee_cards
    add column if not exists physical_issued_at timestamptz,
    add column if not exists physical_issued_by text;

create or replace function core._card_payload(p_card_id uuid, p_level text)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    c core.employee_cards;
    b record;
    i record;
    v_until date;
    v_role text;
    v_out jsonb;
    v_today date := core._sg_today();
begin
    select * into c from core.employee_cards where id = p_card_id;
    if c.id is null then
        return null;
    end if;
    select * into b from core._wi_base(c.employee_id);
    select * into i from core.worker_info where employee_id = c.employee_id;
    v_until := core._card_effective_until(c);
    v_role := core._card_role(c.employee_id);
    v_out := jsonb_build_object(
        'card_id', c.id,
        'employee_id', c.employee_id,
        'name', b.name,
        'designation', b.designation,
        'worker_type', b.worker_type,
        'in_company', coalesce(b.in_company, false),
        'role', v_role,
        'state', core._card_state(c),
        'valid_from', c.valid_from,
        'valid_until', v_until,
        'card_last4', right(c.card_number, 4),
        'photo', (select p.photo from core.worker_photos p where p.employee_id = c.employee_id),
        -- validity of documents without their numbers
        'permit_ok', case when b.worker_type = 'local' then null
                          when i.permit_expiry_date is null then null else i.permit_expiry_date >= v_today end,
        'safety_ok', case when i.safety_cert_expiry_date is null then null else i.safety_cert_expiry_date >= v_today end
    );
    if p_level in ('staff', 'holder', 'admin') then
        v_out := v_out || jsonb_build_object(
            'work_permit_no', case when b.worker_type = 'local' then null else i.work_permit_no end,
            'permit_expiry_date', case when b.worker_type = 'local' then null else i.permit_expiry_date end,
            'safety_cert_no', i.safety_cert_no,
            'safety_cert_expiry_date', i.safety_cert_expiry_date,
            'date_joined', b.date_joined,
            'card_number_masked', '•••• •••• •••• ' || right(c.card_number, 4)
        );
    end if;
    if p_level in ('holder', 'admin') then
        v_out := v_out || jsonb_build_object('card_number', c.card_number, 'issued_at', c.issued_at,
                                             'physical_issued_at', c.physical_issued_at, 'physical_issued_by', case when p_level = 'admin' then c.physical_issued_by else null end);
    end if;
    if p_level = 'admin' then
        v_out := v_out || jsonb_build_object('qr_token', c.qr_token, 'status', c.status, 'printed_count', c.printed_count,
                                             'last_printed_at', c.last_printed_at, 'issued_by', c.issued_by);
    end if;
    return v_out;
end;
$$;

create or replace function core.admin_card_set_physical(p_employee_ids text[], p_issued boolean)
returns int
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._card_admin();
    n int;
begin
    if p_employee_ids is null or cardinality(p_employee_ids) = 0 or cardinality(p_employee_ids) > 500 then
        raise exception 'Choose between 1 and 500 people';
    end if;
    update core.employee_cards
       set physical_issued_at = case when p_issued then coalesce(physical_issued_at, clock_timestamp()) else null end,
           physical_issued_by = case when p_issued then coalesce(physical_issued_by, v_actor) else null end
     where employee_id = any (select trim(x) from unnest(p_employee_ids) x) and status = 'active';
    get diagnostics n = row_count;
    return n;
end;
$$;

create or replace function core.my_card_report_lost(p_token text default null, p_employee_id text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    v_emp text := core._card_holder(p_token, nullif(trim(coalesce(p_employee_id, '')), ''));
    c core.employee_cards;
    v_name text;
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or v_emp is null then
        raise exception 'Session expired. Please log in again.';
    end if;
    select * into c from core.employee_cards where employee_id = v_emp and status = 'active' for update;
    if c.id is null then
        raise exception 'You have no active card to report';
    end if;
    if c.physical_issued_at is null then
        raise exception 'No physical card has been issued to you yet — there is nothing to report lost';
    end if;
    update core.employee_cards
       set status = 'void', ended_at = clock_timestamp(), ended_by = 'holder:' || coalesce(a.who, v_emp), end_reason = 'Reported lost by the holder'
     where id = c.id;
    perform core._card_log(c.id, v_emp, a.kind, a.who, 'lost', 'holder', 'cancelled');
    select name into v_name from core._wi_base(v_emp);
    perform core._wi_push_admins('ID card reported lost', coalesce(v_name, v_emp) || ' (' || v_emp || ') reported their ID card lost. It is cancelled — issue a new one.');
    return core._card_payload(c.id, 'holder');
end;
$$;

revoke all on function core._card_payload(uuid, text) from public, anon, authenticated;
revoke all on function core.admin_card_set_physical(text[], boolean) from public, anon;
grant execute on function core.admin_card_set_physical(text[], boolean) to authenticated;
revoke all on function core.my_card_report_lost(text, text) from public;
grant execute on function core.my_card_report_lost(text, text) to anon, authenticated;
