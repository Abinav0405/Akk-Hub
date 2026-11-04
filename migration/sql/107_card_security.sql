-- AKK Hub — ID card & sign-in security, round 3. Idempotent; runs after 91–98.
--   · Live phone codes are one-time: the first person to scan a code owns it; anyone else who scans the
--     same code (a forwarded screenshot) gets red. The same scanner may re-check its own scan.
--     Printed-card QR (AKK1P.) and the 16-digit number / barcode are NOT changed — they work as before.
--   · Public checks (no sign-in) are limited per connection; staff are never limited.
--   · Admin push when a cancelled / replaced / ex-employee card or a reused / old live code is scanned
--     (at most one alert per card per hour).
--   · Offline pack for supervisors / managers / admins (hashes only — no raw card numbers or QR tokens)
--     and an upload for scans made offline.
--   · On-site headcount (open shifts + today's deployment) for supervisors / managers / admins.
--   · Sign-in history + push to the worker when their account is signed in on a new device.
--   · Admin security feed. Locks down two unused, publicly callable logging functions.
--   · Expiry reminders also send the office one summary.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table core.card_scans add column if not exists ip text;
create index if not exists card_scans_ip_idx on core.card_scans (ip, at desc) where ip is not null;

create table if not exists core.card_live_uses (
    sig text primary key,
    card_id uuid not null,
    first_actor text not null,
    first_at timestamptz not null default now()
);
create index if not exists card_live_uses_at_idx on core.card_live_uses (first_at);

create table if not exists core.card_alerts (
    id bigserial primary key,
    card_id uuid,
    employee_id text,
    kind text not null,
    detail text,
    scanned_by text,
    at timestamptz not null default now()
);
create index if not exists card_alerts_card_idx on core.card_alerts (card_id, at desc);
create index if not exists card_alerts_at_idx on core.card_alerts (at desc);

do $$
declare t text;
begin
    foreach t in array array['card_live_uses', 'card_alerts'] loop
        execute format('alter table core.%I enable row level security', t);
        execute format('revoke all on core.%I from public, anon, authenticated', t);
        execute format('grant all on core.%I to service_role', t);
    end loop;
end $$;
revoke all on all sequences in schema core from public, anon, authenticated;

-- The caller's address as the API gateway saw it (null when unknown).
create or replace function core._req_ip()
returns text
language plpgsql stable as $$
declare h json;
begin
    begin
        h := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
        return null;
    end;
    return nullif(trim(coalesce(h ->> 'cf-connecting-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1))), '');
end;
$$;

-- One admin push per card per kind per hour; always recorded for the security feed.
create or replace function core._card_alert(p_card uuid, p_emp text, p_kind text, p_detail text, p_by text)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare
    v_recent boolean;
    v_name text;
begin
    select exists (select 1 from core.card_alerts a where a.card_id = p_card and a.kind = p_kind and a.at > now() - interval '1 hour') into v_recent;
    insert into core.card_alerts (card_id, employee_id, kind, detail, scanned_by) values (p_card, p_emp, p_kind, p_detail, p_by);
    if v_recent then
        return;
    end if;
    select name into v_name from core._wi_base(p_emp);
    begin
        perform core._wi_push_admins('ID card alert', coalesce(v_name, p_emp, 'Unknown') || ' (' || coalesce(p_emp, '?') || '): ' || p_detail);
    exception when others then
        null; -- a push failure must never break a scan
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- VERIFY (same as 93, plus one-time live codes, public limit, alerts, ip)
-- ---------------------------------------------------------------------------
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
    v_ip text := core._req_ip();
    v_actor text;
    v_sig text;
    v_owner text;
    v_replay boolean := false;
    v_fresh boolean;
    v_state text;
    v_purpose text := case when p_purpose in ('verify', 'site', 'clock', 'materials', 'vehicle') then p_purpose else 'verify' end;
begin
    select * into a from core._card_actor(p_token);
    v_staff := coalesce(a.kind in ('admin', 'manager', 'supervisor', 'staff'), false);
    v_actor := case when a.kind is null then 'public:' || coalesce(v_ip, '') else a.kind || ':' || coalesce(a.who, '') end;

    -- Public (no sign-in): at most 30 checks per connection per 10 minutes.
    if not v_staff and v_ip is not null and (
        select count(*) from core.card_scans s where s.ip = v_ip and s.at > now() - interval '10 minutes' and coalesce(s.scanner_kind, 'public') = 'public'
    ) >= 30 then
        return jsonb_build_object('found', false, 'message', 'Too many checks from this connection. Please wait a few minutes and try again.');
    end if;

    select * into p from core._card_parse(p_code);
    if p.card_id is null then
        v_scan := core._card_log(null, null, a.kind, a.who, v_purpose, null, 'not_found');
        update core.card_scans set ip = v_ip where id = v_scan;
        return jsonb_build_object('found', false, 'message', 'This is not a valid AKK card code.');
    end if;
    if p.method = 'number' and not v_staff then
        return jsonb_build_object('found', false, 'message', 'Sign in as staff to look up a card number.');
    end if;
    select * into c from core.employee_cards where id = p.card_id;
    v_fresh := p.fresh;

    -- One-time live codes: the first scanner owns the code; anyone else = a forwarded screenshot.
    if p.method = 'live' and p.fresh then
        v_sig := split_part(substring(trim(p_code) from 'AKK1L\.[0-9a-f]{32}\.[0-9a-z]{1,12}\.[0-9a-f]{20}'), '.', 4);
        if v_sig is not null and v_sig <> '' then
            insert into core.card_live_uses (sig, card_id, first_actor) values (v_sig, c.id, v_actor)
            on conflict (sig) do nothing;
            select first_actor into v_owner from core.card_live_uses where sig = v_sig;
            v_replay := v_owner is distinct from v_actor;
            if random() < 0.02 then
                delete from core.card_live_uses where first_at < now() - interval '1 day';
            end if;
        end if;
    end if;
    if v_replay then
        v_fresh := false;
    end if;

    v_level := case when a.kind = 'admin' then 'admin' when v_staff then 'staff' else 'public' end;
    v_payload := core._card_payload(c.id, case when v_level = 'admin' then 'staff' else v_level end);
    v_today := case when v_staff then core._card_today(c.employee_id) else null end;
    v_place := coalesce(p_place, a.site_place);
    -- A reused code gets its own message instead of the generic "old code" one.
    v_checks := core._card_checks(v_payload, v_today, p.method, case when v_replay then true else v_fresh end, case when v_staff then v_place else null end);
    if v_replay then
        v_checks := jsonb_build_array(jsonb_build_object('level', 'red', 'text',
            'This live code was already scanned by someone else — ask them to show the card again (it changes every 30 seconds).')) || v_checks;
    end if;
    v_overall := core._card_overall(v_checks);
    v_scan := core._card_log(c.id, c.employee_id, a.kind, a.who, v_purpose,
        p.method || case when v_replay then '_reused' when p.method = 'live' and not p.fresh then '_stale' else '' end, v_overall);
    update core.card_scans set ip = v_ip where id = v_scan;

    v_state := v_payload ->> 'state';
    if v_state in ('void', 'replaced', 'left') then
        perform core._card_alert(c.id, c.employee_id, 'bad_card',
            format('a %s card was scanned (%s, %s)', case v_state when 'void' then 'cancelled' when 'replaced' then 'replaced' else 'former employee''s' end, v_purpose, p.method),
            coalesce(a.who, 'public'));
    elsif v_replay then
        perform core._card_alert(c.id, c.employee_id, 'reused_code', format('a live code was reused by a second scanner (%s)', v_purpose), coalesce(a.who, 'public'));
    elsif p.method = 'live' and not p.fresh and v_staff then
        perform core._card_alert(c.id, c.employee_id, 'old_code', format('an old live code (likely a screenshot) was shown to staff (%s)', v_purpose), a.who);
    end if;

    return jsonb_build_object(
        'found', true,
        'method', p.method,
        'live', case when p.method = 'live' then v_fresh else null end,
        'reused', case when p.method = 'live' then v_replay else null end,
        'verified_at', now(),
        'overall', v_overall,
        'checks', v_checks,
        'card', v_payload,
        'today', v_today,
        'place_id', case when v_staff then v_place else null end,
        'viewer', coalesce(a.kind, 'public'),
        'scan_id', case when v_staff then v_scan else null end);
end;
$$;

-- CLOCK-IN by card (same as 91) with its own message for a reused live code.
create or replace function core.card_clock_context(p_code text, p_token text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    v jsonb;
    v_site record;
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or a.kind not in ('admin', 'manager', 'supervisor') then
        raise exception 'Only supervisors, managers and admins can clock workers in by card';
    end if;
    v := core.card_verify(p_code, p_token, 'clock', null);
    if not coalesce((v ->> 'found')::boolean, false) then
        return v;
    end if;
    if v -> 'card' ->> 'state' in ('replaced', 'void', 'left') then
        return v || jsonb_build_object('blocked', 'This card cannot be used: ' || (v -> 'checks' -> 0 ->> 'text'));
    end if;
    if v ->> 'method' = 'live' and coalesce((v ->> 'reused')::boolean, false) then
        return v || jsonb_build_object('blocked', 'This code was already used by someone else — ask the worker to show the live card again.');
    end if;
    if v ->> 'method' = 'live' and not coalesce((v ->> 'live')::boolean, false) then
        return v || jsonb_build_object('blocked', 'Old code — ask the worker to open the live card in the app.');
    end if;
    if a.kind = 'supervisor' then
        select st.id, st.site_name into v_site from attendance.supervisors sv join attendance.sites st on st.id = sv.site_id
         where sv.supervisor_id = a.who and coalesce(sv.is_active, true) limit 1;
        if v_site.id is null then
            return v || jsonb_build_object('blocked', 'Your supervisor account has no site. Ask an admin to set it.');
        end if;
        v := v || jsonb_build_object('site', jsonb_build_object('id', v_site.id, 'site_name', v_site.site_name));
    end if;
    return v || jsonb_build_object('worker_id', v -> 'card' ->> 'employee_id', 'actor_kind', a.kind, 'actor', a.who);
end;
$$;

-- ---------------------------------------------------------------------------
-- OFFLINE: a pack of card fingerprints for scanning without signal (supervisor / manager / admin).
-- Only SHA-256 hashes of the QR token and card number leave the server.
-- ---------------------------------------------------------------------------
create or replace function core.card_offline_pack(p_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = core, extensions as $$
declare a record;
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or a.kind not in ('admin', 'manager', 'supervisor') then
        raise exception 'Only supervisors, managers and admins can download the offline card list';
    end if;
    return jsonb_build_object(
        'generated_at', now(),
        'cards', coalesce((
            select jsonb_agg(jsonb_build_object(
                'card_id', replace(c.id::text, '-', ''),
                'employee_id', c.employee_id,
                'name', b.name,
                'designation', b.designation,
                'worker_type', b.worker_type,
                'role', core._card_role(c.employee_id),
                'state', core._card_state(c),
                'valid_until', core._card_effective_until(c),
                'permit_expiry_date', case when b.worker_type = 'local' then null else i.permit_expiry_date end,
                'safety_cert_expiry_date', i.safety_cert_expiry_date,
                'token_hash', encode(extensions.digest(c.qr_token, 'sha256'), 'hex'),
                'number_hash', encode(extensions.digest(c.card_number, 'sha256'), 'hex')))
              from core.employee_cards c
              left join lateral core._wi_base(c.employee_id) b on true
              left join core.worker_info i on i.employee_id = c.employee_id
             where c.status = 'active' or coalesce(c.ended_at, c.issued_at) > now() - interval '2 years'
        ), '[]'::jsonb));
end;
$$;

-- Scans made offline, uploaded when the phone is back online (max 200 per call, last 7 days only).
create or replace function core.card_log_offline(p_token text, p_items jsonb)
returns int
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    it jsonb;
    v_card core.employee_cards;
    n int := 0;
    v_at timestamptz;
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or a.kind not in ('admin', 'manager', 'supervisor') then
        raise exception 'Not allowed';
    end if;
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 200 loop
        begin
            v_at := (it ->> 'at')::timestamptz;
        exception when others then
            continue;
        end;
        if v_at is null or v_at < now() - interval '7 days' or v_at > now() + interval '5 minutes' then
            continue;
        end if;
        select * into v_card from core.employee_cards
         where replace(id::text, '-', '') = it ->> 'card_id' or employee_id = it ->> 'employee_id'
         order by (replace(id::text, '-', '') = it ->> 'card_id') desc, issued_at desc limit 1;
        insert into core.card_scans (card_id, employee_id, scanned_by, scanner_kind, purpose, method, result, at)
        values (v_card.id, coalesce(v_card.employee_id, it ->> 'employee_id'), a.who, a.kind, 'offline',
                'offline_' || coalesce(nullif(it ->> 'method', ''), 'unknown'),
                case when it ->> 'result' in ('green', 'amber', 'red', 'not_found') then it ->> 'result' else 'amber' end, v_at);
        n := n + 1;
    end loop;
    return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- ON SITE NOW: open shifts per site + who is deployed today but not clocked in.
-- Supervisors see their own site; managers and admins see every site.
-- ---------------------------------------------------------------------------
create or replace function core.site_headcount(p_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    a record;
    v_site text;
    v_today date := core._sg_today();
begin
    select * into a from core._card_actor(p_token);
    if a.kind is null or a.kind not in ('admin', 'manager', 'supervisor') then
        raise exception 'Only supervisors, managers and admins can see the headcount';
    end if;
    if a.kind = 'supervisor' then
        select sv.site_id::text into v_site from attendance.supervisors sv
         where sv.supervisor_id = a.who and coalesce(sv.is_active, true) limit 1;
        if v_site is null then
            raise exception 'Your supervisor account has no site. Ask an admin to set it.';
        end if;
    end if;
    return jsonb_build_object(
        'at', now(),
        'scope', case when v_site is null then 'all' else 'site' end,
        'on_site', coalesce((
            select jsonb_agg(jsonb_build_object(
                'worker_id', sh.worker_id,
                'name', b.name,
                'site_id', sh.site_id,
                'site', st.site_name,
                'entry_time', sh.entry_time,
                'work_date', sh.work_date,
                'on_break', exists (select 1 from attendance.breaks br where br.shift_id = sh.id and br.break_end is null),
                'last_scan', (select max(cs.at) from core.card_scans cs where cs.employee_id = sh.worker_id
                                and cs.at >= (v_today::timestamp at time zone 'Asia/Singapore')))
                order by st.site_name, b.name)
              from attendance.shifts sh
              left join attendance.sites st on st.id::text = sh.site_id::text
              left join lateral core._wi_base(sh.worker_id) b on true
             where not coalesce(sh.has_left, false)
               and sh.work_date >= v_today - 1
               and (v_site is null or sh.site_id::text = v_site)
        ), '[]'::jsonb),
        'expected', coalesce((
            select jsonb_agg(jsonb_build_object('employee_id', da.employee_id, 'name', b.name, 'place', s.name,
                                                'site_id', s.attendance_site_id, 'start', da.start_time, 'end', da.end_time)
                order by s.name, b.name)
              from core.deployment_days d
              join core.deployment_assignments da on da.day_id = d.id
              join core.deployment_sites ds on ds.id = da.site_row_id
              left join core.sites s on s.id = ds.place_id
              left join lateral core._wi_base(da.employee_id) b on true
             where d.day = v_today and d.status = 'published'
               and (v_site is null or s.attendance_site_id::text = v_site)
               and not exists (select 1 from attendance.shifts sh
                                where sh.worker_id = da.employee_id and not coalesce(sh.has_left, false))
        ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- SIGN-INS: history + "signed in on a new device" push to the worker.
-- create_role_session ends the account's previous full session before adding the new one, in the same
-- transaction. The delete trigger notes that a still-valid session was ended; the insert trigger then
-- records the sign-in and, if one was ended, pushes the worker. Logging out (delete only) sends nothing.
-- Both triggers swallow every error: a sign-in must never fail because of them.
-- ---------------------------------------------------------------------------
create or replace function attendance._session_ended_note()
returns trigger
language plpgsql security definer set search_path = attendance as $$
begin
    begin
        if old.session_kind = 'full' and old.expires_at > now() then
            perform set_config('akk.session_ended', old.role || ':' || old.subject_id, true);
        end if;
    exception when others then
        null;
    end;
    return old;
end;
$$;

create or replace function attendance._session_started_note()
returns trigger
language plpgsql security definer set search_path = attendance, core as $$
declare
    v_replaced boolean;
begin
    begin
        if new.session_kind = 'full' then
            v_replaced := coalesce(current_setting('akk.session_ended', true), '') = new.role || ':' || new.subject_id;
            insert into attendance.login_events (role, identifier, event_type, user_agent, device_label, metadata)
            values (new.role, new.subject_id, case when v_replaced then 'signin_replaced' else 'signin' end, null, null,
                    jsonb_build_object('ip', core._req_ip()));
            if v_replaced then
                perform set_config('akk.session_ended', '', true);
                if new.role = 'worker' then
                    perform core._wi_push_worker(new.subject_id, 'New sign-in to your AKK Hub account',
                        'Your account was just signed in on a device, and the earlier sign-in was ended. If this was not you, tell the office straight away.');
                end if;
            end if;
        end if;
    exception when others then
        null;
    end;
    return new;
end;
$$;

drop trigger if exists role_sessions_ended_note on attendance.role_sessions;
create trigger role_sessions_ended_note before delete on attendance.role_sessions
    for each row execute function attendance._session_ended_note();
drop trigger if exists role_sessions_started_note on attendance.role_sessions;
create trigger role_sessions_started_note after insert on attendance.role_sessions
    for each row execute function attendance._session_started_note();

-- Unused by the app and callable by anyone: anyone could write fake alerts / login events.
revoke all on function attendance.create_security_alert(text, text, text, text) from public, anon, authenticated;
revoke all on function attendance.log_login_event(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function attendance.create_security_alert(text, text, text, text) to service_role;
grant execute on function attendance.log_login_event(text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- ADMIN security feed: card alerts, sign-ins, lockouts, existing security alerts.
-- ---------------------------------------------------------------------------
create or replace function core.admin_security_feed(p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return jsonb_build_object(
        'card_alerts', coalesce((select jsonb_agg(x order by x.at desc) from (
            select ca.kind, ca.detail, ca.employee_id, b.name, ca.scanned_by, ca.at
              from core.card_alerts ca left join lateral core._wi_base(ca.employee_id) b on true
             order by ca.at desc limit v_lim) x), '[]'::jsonb),
        'signins', coalesce((select jsonb_agg(x order by x.at desc) from (
            select le.role, le.identifier, le.event_type, le.metadata ->> 'ip' as ip, le.created_at as at
              from attendance.login_events le order by le.created_at desc limit v_lim) x), '[]'::jsonb),
        'lockouts', coalesce((select jsonb_agg(x order by x.at desc) from (
            select la.role, la.identifier, la.failed_count, la.locked_until, la.last_failed_at as at
              from attendance.login_attempts la
             where la.locked_until > now() - interval '7 days' or la.failed_count >= 3
             order by la.last_failed_at desc nulls last limit v_lim) x), '[]'::jsonb),
        'alerts', coalesce((select jsonb_agg(x order by x.at desc) from (
            select sa.alert_type, sa.role, sa.identifier, sa.message, sa.created_at as at
              from attendance.security_alerts sa order by sa.created_at desc limit v_lim) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- EXPIRY reminders (98) + one summary push to the office when any were sent.
-- ---------------------------------------------------------------------------
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
    v_cards int := 0;
    v_permits int := 0;
    v_safety int := 0;
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
            if r.kind = 'card' then v_cards := v_cards + 1;
            elsif r.kind = 'permit' then v_permits := v_permits + 1;
            else v_safety := v_safety + 1; end if;
        end;
    end loop;

    if v_sent > 0 then
        begin
            perform core._wi_push_admins('Expiry reminders sent',
                concat_ws(', ',
                    case when v_cards > 0 then v_cards || ' ID card' || case when v_cards = 1 then '' else 's' end end,
                    case when v_permits > 0 then v_permits || ' work permit' || case when v_permits = 1 then '' else 's' end end,
                    case when v_safety > 0 then v_safety || ' safety certificate' || case when v_safety = 1 then '' else 's' end end)
                || ' expiring or expired. See Employees → ID cards for the list.');
        exception when others then
            null;
        end;
    end if;

    return jsonb_build_object('ok', true, 'today', v_today, 'sent', v_sent, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function core._req_ip() from public, anon, authenticated;
revoke all on function core._card_alert(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function attendance._session_ended_note() from public, anon, authenticated;
revoke all on function attendance._session_started_note() from public, anon, authenticated;
grant execute on function core.card_verify(text, text, text, uuid) to anon, authenticated;
revoke all on function core.card_offline_pack(text) from public;
grant execute on function core.card_offline_pack(text) to anon, authenticated;
revoke all on function core.card_log_offline(text, jsonb) from public;
grant execute on function core.card_log_offline(text, jsonb) to anon, authenticated;
revoke all on function core.site_headcount(text) from public;
grant execute on function core.site_headcount(text) to anon, authenticated;
revoke all on function core.admin_security_feed(int) from public, anon;
grant execute on function core.admin_security_feed(int) to authenticated;
revoke all on function core.run_expiry_reminders() from public, anon, authenticated;
grant execute on function core.run_expiry_reminders() to service_role;
