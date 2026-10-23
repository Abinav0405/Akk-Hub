-- AKK Hub — the card holder can report their own card lost: it is cancelled at once (every printed / live /
-- NFC code stops working), the office is notified, and only an admin can issue a new card.
-- Holder = the worker, or a staff login linked to the ID. Idempotent; runs after 91–93.

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
    update core.employee_cards
       set status = 'void', ended_at = clock_timestamp(), ended_by = 'holder:' || coalesce(a.who, v_emp), end_reason = 'Reported lost by the holder'
     where id = c.id;
    perform core._card_log(c.id, v_emp, a.kind, a.who, 'lost', 'holder', 'cancelled');
    select name into v_name from core._wi_base(v_emp);
    perform core._wi_push_admins('ID card reported lost', coalesce(v_name, v_emp) || ' (' || v_emp || ') reported their ID card lost. It is cancelled — issue a new one.');
    return core._card_payload(c.id, 'holder');
end;
$$;

revoke all on function core.my_card_report_lost(text, text) from public;
grant execute on function core.my_card_report_lost(text, text) to anon, authenticated;
