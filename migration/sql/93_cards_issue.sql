-- AKK Hub — ID cards, round 2: scan tickets (card_verify returns scan_id to staff), store issue by card,
-- (no wallet). Idempotent; runs after 91 + 92.

create or replace function core.card_verify(p_code text, p_token text default null, p_purpose text default 'verify', p_place uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    p record;
    c core.employee_cards;
    v_staff boolean;
    v_level text;
    v_payload jsonb;
    v_today jsonb;
    v_checks jsonb;
    v_overall text;
    v_place uuid;
    v_scan bigint;
    v_purpose text := case when p_purpose in ('verify', 'site', 'clock', 'materials', 'vehicle') then p_purpose else 'verify' end;
begin
    select * into a from core._card_actor(p_token);
    v_staff := coalesce(a.kind in ('admin', 'manager', 'supervisor', 'staff'), false);
    select * into p from core._card_parse(p_code);
    if p.card_id is null then
        perform core._card_log(null, null, a.kind, a.who, v_purpose, null, 'not_found');
        return jsonb_build_object('found', false, 'message', 'This is not a valid AKK card code.');
    end if;
    if p.method = 'number' and not v_staff then
        return jsonb_build_object('found', false, 'message', 'Sign in as staff to look up a card number.');
    end if;
    select * into c from core.employee_cards where id = p.card_id;
    v_level := case when a.kind = 'admin' then 'admin' when v_staff then 'staff' else 'public' end;
    v_payload := core._card_payload(c.id, case when v_level = 'admin' then 'staff' else v_level end);
    v_today := case when v_staff then core._card_today(c.employee_id) else null end;
    v_place := coalesce(p_place, a.site_place);
    v_checks := core._card_checks(v_payload, v_today, p.method, p.fresh, case when v_staff then v_place else null end);
    v_overall := core._card_overall(v_checks);
    v_scan := core._card_log(c.id, c.employee_id, a.kind, a.who, v_purpose, p.method || case when p.method = 'live' and not p.fresh then '_stale' else '' end, v_overall);
    return jsonb_build_object(
        'found', true,
        'method', p.method,
        'live', case when p.method = 'live' then p.fresh else null end,
        'verified_at', now(),
        'overall', v_overall,
        'checks', v_checks,
        'card', v_payload,
        'today', v_today,
        'place_id', case when v_staff then v_place else null end,
        'viewer', coalesce(a.kind, 'public'),
        -- staff only: a ticket for follow-up actions on this scan (e.g. issuing materials)
        'scan_id', case when v_staff then v_scan else null end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Store issue by ID card: staff scan the worker's card (card_verify → scan_id), then issue materials.
-- The scan ticket must be this staff member's own, for purpose 'materials', less than 30 minutes old,
-- and the card valid — so the worker identity always comes from a real card scan, never a typed ID.
-- The record is created already approved (handed over at the store), approved_by = the staff member.
-- ---------------------------------------------------------------------------
create or replace function core.staff_issue_materials(
    p_scan_id bigint, p_token text, p_materials jsonb, p_notes text, p_site_id text, p_site_name text)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    s core.card_scans;
    c core.employee_cards;
    b record;
    v_by text;
    v_now timestamp := (now() at time zone 'Asia/Singapore');
    v_id uuid;
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or a.kind not in ('admin', 'manager', 'staff') then
        raise exception 'Only store staff, managers and admins can issue materials';
    end if;
    select * into s from core.card_scans where id = p_scan_id;
    if s.id is null or s.purpose <> 'materials' or s.scanned_by is distinct from a.who or s.at < now() - interval '30 minutes' then
        raise exception 'Scan the worker''s ID card again';
    end if;
    if s.result = 'issued' then
        raise exception 'This scan was already used — scan the card again';
    end if;
    if s.method like '%_stale' then
        raise exception 'That was an old code (screenshot) — scan the live card';
    end if;
    select * into c from core.employee_cards where id = s.card_id;
    if c.id is null or core._card_state(c) <> 'valid' then
        raise exception 'This card is not valid';
    end if;
    if jsonb_typeof(p_materials) is distinct from 'array' or jsonb_array_length(p_materials) = 0 or jsonb_array_length(p_materials) > 100 then
        raise exception 'Add at least one material';
    end if;
    if nullif(trim(coalesce(p_site_id, '')), '') is null then
        raise exception 'Choose the site';
    end if;
    select * into b from core._wi_base(c.employee_id);
    v_by := coalesce(
        (select sp.display_name from materials.staff_profiles sp where sp.user_id = auth.uid() and sp.is_active limit 1),
        (select m.name from attendance.managers m where lower(m.email) = lower(a.who) limit 1),
        a.who);
    insert into materials.transactions (worker_name, worker_id, transaction_type, transaction_date, transaction_time,
                                        materials, notes, site_id, site_name, approval_status, approved_by, approval_date)
    values (b.name, c.employee_id, 'take', v_now::date, v_now::time(0), p_materials,
            nullif(trim(coalesce(p_notes, '')), ''), p_site_id::uuid, p_site_name, 'approved', v_by,
            to_char(v_now, 'YYYY-MM-DD HH24:MI:SS'))
    returning id into v_id;
    update core.card_scans set result = 'issued' where id = s.id; -- one ticket = one issue
    return jsonb_build_object('id', v_id, 'worker_id', c.employee_id, 'worker_name', b.name);
end;
$$;

do $$
declare f text;
begin
    foreach f in array array['core.card_verify(text, text, text, uuid)', 'core.staff_issue_materials(bigint, text, jsonb, text, text, text)'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
end $$;
