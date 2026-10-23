-- =====================================================================================
-- AKK Hub — Employee ID cards 2.0
--   · one card per person: random 16-digit number (Luhn check digit), random QR token
--   · valid 2 years, or until the date of cessation; renew = new number, old one "replaced"
--   · card colour = highest linked role: admin (white + red band) > manager (green) >
--     supervisor (blue) > employee (red). Admin links a person's hub logins to their employee ID.
--   · live QR on the phone: signed with a server secret, valid ~2 minutes → a screenshot shows as old
--   · printed (PVC) card: static QR token + barcode of the card number
--   · verify by scan / typed number, site access check, supervisor clock-in, store issue, vehicle
-- Security: RLS on, no table grants; everything goes through SECURITY DEFINER functions that check
-- the caller. The public verify answer never contains NRIC, pay, passport, permit/certificate numbers.
-- Idempotent.
-- =====================================================================================

create table if not exists core.employee_cards (
    id uuid primary key default gen_random_uuid(),
    employee_id text not null,
    card_number text not null unique check (card_number ~ '^[1-9][0-9]{15}$'),
    qr_token text not null unique,
    status text not null default 'active' check (status in ('active', 'replaced', 'void')),
    valid_from date not null,
    valid_until date not null,
    issued_at timestamptz not null default clock_timestamp(),
    issued_by text,
    ended_at timestamptz,
    ended_by text,
    end_reason text,
    printed_count int not null default 0,
    last_printed_at timestamptz
);
create unique index if not exists employee_cards_one_active on core.employee_cards (employee_id) where status = 'active';
create index if not exists employee_cards_emp_idx on core.employee_cards (employee_id, issued_at desc);

-- One hub login (lower-case e-mail / login ID / supervisor ID) belongs to at most one employee.
create table if not exists core.employee_links (
    login text primary key check (login = lower(login) and length(login) between 1 and 200),
    employee_id text not null,
    linked_by text,
    linked_at timestamptz not null default now()
);
create index if not exists employee_links_emp_idx on core.employee_links (employee_id);

create table if not exists core.card_scans (
    id bigserial primary key,
    card_id uuid,
    employee_id text,
    scanned_by text,
    scanner_kind text,
    purpose text,
    method text,
    result text,
    at timestamptz not null default now()
);
create index if not exists card_scans_emp_idx on core.card_scans (employee_id, at desc);
create index if not exists card_scans_at_idx on core.card_scans (at desc);

create table if not exists core.card_secret (
    id int primary key default 1 check (id = 1),
    secret bytea not null
);
insert into core.card_secret (id, secret) values (1, extensions.gen_random_bytes(32)) on conflict (id) do nothing;

do $$
declare t text;
begin
    foreach t in array array['employee_cards', 'employee_links', 'card_scans', 'card_secret'] loop
        execute format('alter table core.%I enable row level security', t);
        execute format('revoke all on core.%I from public, anon, authenticated', t);
        execute format('grant all on core.%I to service_role', t);
    end loop;
end $$;
revoke all on all sequences in schema core from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Numbers and tokens
-- ---------------------------------------------------------------------------
create or replace function core._card_luhn(p_digits text)
returns int
language sql immutable as $$
    -- check digit for p_digits (15 digits) so that p_digits || check passes Luhn
    select (10 - (sum(d) % 10)) % 10 from (
        select case when (length(p_digits) - i) % 2 = 0
                    then case when substr(p_digits, i, 1)::int * 2 > 9 then substr(p_digits, i, 1)::int * 2 - 9 else substr(p_digits, i, 1)::int * 2 end
                    else substr(p_digits, i, 1)::int end as d
          from generate_series(1, length(p_digits)) i
    ) x;
$$;

create or replace function core._card_luhn_ok(p_number text)
returns boolean
language sql immutable as $$
    select p_number ~ '^[0-9]{16}$' and core._card_luhn(left(p_number, 15)) = right(p_number, 1)::int;
$$;

create or replace function core._card_new_number()
returns text
language plpgsql volatile security definer set search_path = core, extensions as $$
declare
    b bytea;
    body text;
    n text;
begin
    loop
        b := extensions.gen_random_bytes(15);
        body := ((get_byte(b, 0) % 9) + 1)::text;
        for i in 1..14 loop
            body := body || (get_byte(b, i) % 10)::text;
        end loop;
        n := body || core._card_luhn(body)::text;
        exit when not exists (select 1 from core.employee_cards where card_number = n);
    end loop;
    return n;
end;
$$;

create or replace function core._card_new_token()
returns text
language plpgsql volatile security definer set search_path = core, extensions as $$
declare t text;
begin
    loop
        t := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
        exit when not exists (select 1 from core.employee_cards where qr_token = t);
    end loop;
    return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Issue / ensure
-- ---------------------------------------------------------------------------
create or replace function core._card_issue(p_emp text, p_actor text)
returns uuid
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id uuid;
    v_from date := core._sg_today();
begin
    insert into core.employee_cards (employee_id, card_number, qr_token, valid_from, valid_until, issued_by)
    values (p_emp, core._card_new_number(), core._card_new_token(), v_from, (v_from + interval '2 years' - interval '1 day')::date, p_actor)
    returning id into v_id;
    return v_id;
end;
$$;

-- Active card for an employed person (issued on first need). Returns null for unknown / not-in-company
-- people without a card.
create or replace function core._card_ensure(p_emp text)
returns uuid
language plpgsql volatile security definer set search_path = core as $$
declare
    v_id uuid;
    b record;
begin
    select id into v_id from core.employee_cards where employee_id = p_emp and status = 'active';
    if v_id is not null then
        return v_id;
    end if;
    -- Only the FIRST card is automatic. After a card is cancelled / replaced, a new one is an admin decision.
    if exists (select 1 from core.employee_cards where employee_id = p_emp) then
        return null;
    end if;
    select * into b from core._wi_base(p_emp);
    if b.employee_id is null or not b.in_company then
        return null;
    end if;
    begin
        return core._card_issue(p_emp, 'auto');
    exception when unique_violation then
        select id into v_id from core.employee_cards where employee_id = p_emp and status = 'active';
        return v_id;
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles (hub logins) and links
-- ---------------------------------------------------------------------------
create or replace function core._hub_logins()
returns table (login text, name text, area text, role text)
language sql stable security definer set search_path = core as $$
    select lower(m.email::text), m.name::text, 'attendance', 'manager' from attendance.managers m where m.email is not null
    union all
    select lower(sv.supervisor_id), sv.name, 'attendance', 'supervisor' from attendance.supervisors sv where coalesce(sv.is_active, true)
    union all
    select lower(u.email::text), coalesce(u.raw_user_meta_data ->> 'name', ''), 'attendance', 'admin'
      from core.attendance_admins a join auth.users u on u.id = a.user_id where u.email is not null
    union all
    select lower(sp.email), sp.display_name, 'materials', r from materials.staff_profiles sp cross join unnest(sp.roles) r
     where sp.is_active and sp.email is not null and r in ('admin', 'manager')
    union all
    select lower(mu.login_id), mu.display_name, 'progress', 'manager' from progress.manager_users mu where mu.is_active
    union all
    select lower(ap.email), ap.display_name, 'progress', 'admin' from progress.admin_profiles ap where ap.is_active and ap.email is not null;
$$;

create or replace function core._role_rank(p_role text)
returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'manager' then 3 when 'supervisor' then 2 else 1 end;
$$;

-- Highest role among the logins linked to this employee ('employee' when none).
create or replace function core._card_role(p_emp text)
returns text
language sql stable security definer set search_path = core as $$
    select coalesce((
        select h.role from core.employee_links l join core._hub_logins() h on h.login = l.login
         where l.employee_id = p_emp
         order by core._role_rank(h.role) desc limit 1), 'employee');
$$;

-- ---------------------------------------------------------------------------
-- Who is calling
--   kind: admin | manager | supervisor | worker | staff (materials staff) | null (public)
--   holder_emp: the employee whose card this caller holds (worker = self, staff = via link)
-- ---------------------------------------------------------------------------
create or replace function core._card_actor(p_token text)
returns table (kind text, who text, site_place uuid, holder_emp text)
language plpgsql stable security definer set search_path = core as $$
declare
    r record;
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
    -- A hub role-session token wins (a worker on a shared browser where an admin is signed in too).
    if p_token is not null and p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select s.role, s.subject_id into r from attendance.role_sessions s
         where s.session_token = p_token::uuid and s.expires_at > now() and coalesce(s.session_kind, 'full') = 'full';
        if r.role = 'worker' then
            return query select 'worker'::text, r.subject_id::text, null::uuid, r.subject_id::text;
            return;
        elsif r.role = 'manager' then
            return query select 'manager'::text, r.subject_id::text, null::uuid,
                (select l.employee_id from core.employee_links l where l.login = lower(r.subject_id));
            return;
        elsif r.role = 'supervisor' then
            return query select 'supervisor'::text, r.subject_id::text,
                (select s.id from attendance.supervisors sv join core.sites s on s.attendance_site_id = sv.site_id
                  where sv.supervisor_id = r.subject_id and coalesce(sv.is_active, true) limit 1),
                (select l.employee_id from core.employee_links l where l.login = lower(r.subject_id));
            return;
        end if;
    end if;
    if core.is_hub_admin() then
        return query select 'admin'::text, coalesce(nullif(v_email, ''), auth.uid()::text), null::uuid,
            (select l.employee_id from core.employee_links l where l.login = v_email);
        return;
    end if;
    if auth.uid() is not null and exists (select 1 from materials.staff_profiles sp where sp.user_id = auth.uid() and sp.is_active) then
        return query select 'staff'::text, coalesce(nullif(v_email, ''), auth.uid()::text), null::uuid,
            (select l.employee_id from core.employee_links l where l.login = v_email);
        return;
    end if;
    return query select null::text, null::text, null::uuid, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Card data
-- ---------------------------------------------------------------------------
-- Effective validity: the 2-year window, cut at the date of cessation when the person left during it.
create or replace function core._card_effective_until(p_card core.employee_cards)
returns date
language sql stable security definer set search_path = core as $$
    select case
        when bv ->> 'date_of_cessation' is not null and (bv ->> 'date_of_cessation')::date >= p_card.valid_from
             and not coalesce((bv ->> 'in_company')::boolean, true)
        then least(p_card.valid_until, (bv ->> 'date_of_cessation')::date)
        else p_card.valid_until end
      from (select coalesce(core._wi_base_values(p_card.employee_id), '{}'::jsonb) bv) x;
$$;

create or replace function core._card_state(p_card core.employee_cards)
returns text
language sql stable security definer set search_path = core as $$
    select case
        when p_card.status = 'replaced' then 'replaced'
        when p_card.status = 'void' then 'void'
        when not coalesce((select in_company from core._wi_base(p_card.employee_id)), false) then 'left'
        when core._card_effective_until(p_card) < core._sg_today() then 'expired'
        else 'valid' end;
$$;

-- p_level: public | staff | holder | admin
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
        v_out := v_out || jsonb_build_object('card_number', c.card_number, 'issued_at', c.issued_at);
    end if;
    if p_level = 'admin' then
        v_out := v_out || jsonb_build_object('qr_token', c.qr_token, 'status', c.status, 'printed_count', c.printed_count,
                                             'last_printed_at', c.last_printed_at, 'issued_by', c.issued_by);
    end if;
    return v_out;
end;
$$;

-- What a verifier sees about today: deployment, open shift, vehicle.
create or replace function core._card_today(p_emp text)
returns jsonb
language sql stable security definer set search_path = core as $$
    select jsonb_build_object(
        'plan_published', exists (select 1 from core.deployment_days d where d.day = core._sg_today() and d.status = 'published'),
        'deployment', (select jsonb_build_object('place_id', ds.place_id, 'place', s.name, 'start', a.start_time, 'end', a.end_time)
                         from core.deployment_days d
                         join core.deployment_assignments a on a.day_id = d.id
                         join core.deployment_sites ds on ds.id = a.site_row_id
                         left join core.sites s on s.id = ds.place_id
                        where d.day = core._sg_today() and d.status = 'published' and a.employee_id = p_emp
                        limit 1),
        'shift', (select jsonb_build_object('id', sh.id, 'site_id', sh.site_id, 'site', st.site_name, 'entry_time', sh.entry_time,
                                            'work_date', sh.work_date,
                                            'on_break', exists (select 1 from attendance.breaks br where br.shift_id = sh.id and br.break_end is null))
                    from attendance.shifts sh left join attendance.sites st on st.id = sh.site_id
                   where sh.worker_id = p_emp and not coalesce(sh.has_left, false)
                   order by sh.entry_time desc limit 1),
        'vehicle', (select jsonb_build_object('vehicle', v.vehicle_number, 'status', j.status, 'started_at', j.started_at)
                      from attendance.vehicle_journeys j left join attendance.vehicles v on v.id = j.vehicle_id
                     where j.worker_id = p_emp and j.status in ('active', 'on_break')
                     order by j.started_at desc limit 1)
    );
$$;

-- Red / amber / green list. p_place: the site the check is for (supervisor's site, or chosen).
create or replace function core._card_checks(p_payload jsonb, p_today jsonb, p_method text, p_fresh boolean, p_place uuid)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
declare
    v_res jsonb := '[]'::jsonb;
    d date;
    v_today date := core._sg_today();
    dep jsonb := p_today -> 'deployment';
    add_ text;
begin
    -- card
    case p_payload ->> 'state'
        when 'replaced' then v_res := v_res || jsonb_build_object('level', 'red', 'text', 'This card was replaced by a newer card');
        when 'void' then v_res := v_res || jsonb_build_object('level', 'red', 'text', 'This card was cancelled');
        when 'left' then v_res := v_res || jsonb_build_object('level', 'red', 'text', 'No longer with the company');
        when 'expired' then v_res := v_res || jsonb_build_object('level', 'red', 'text', 'Card expired');
        else
            d := (p_payload ->> 'valid_until')::date;
            if d - v_today <= 30 then
                v_res := v_res || jsonb_build_object('level', 'amber', 'text', format('Card expires in %s day(s)', d - v_today));
            end if;
    end case;
    if p_method = 'live' and not p_fresh then
        v_res := v_res || jsonb_build_object('level', 'red', 'text', 'Old code — this looks like a screenshot. Ask for the live card in the app.');
    end if;
    -- work permit (foreign workers)
    if p_payload ->> 'worker_type' <> 'local' then
        if p_payload ? 'permit_expiry_date' and p_payload ->> 'permit_expiry_date' is not null then
            d := (p_payload ->> 'permit_expiry_date')::date;
            if d < v_today then v_res := v_res || jsonb_build_object('level', 'red', 'text', 'Work permit expired');
            elsif d - v_today <= 30 then v_res := v_res || jsonb_build_object('level', 'amber', 'text', format('Work permit expires in %s day(s)', d - v_today));
            end if;
        elsif p_payload ->> 'permit_ok' = 'false' then
            v_res := v_res || jsonb_build_object('level', 'red', 'text', 'Work permit expired');
        elsif p_payload ->> 'permit_ok' is null then
            v_res := v_res || jsonb_build_object('level', 'amber', 'text', 'No work permit expiry on file');
        end if;
    end if;
    -- safety certificate
    if p_payload ? 'safety_cert_expiry_date' and p_payload ->> 'safety_cert_expiry_date' is not null then
        d := (p_payload ->> 'safety_cert_expiry_date')::date;
        if d < v_today then v_res := v_res || jsonb_build_object('level', 'red', 'text', 'Safety certificate expired');
        elsif d - v_today <= 30 then v_res := v_res || jsonb_build_object('level', 'amber', 'text', format('Safety certificate expires in %s day(s)', d - v_today));
        end if;
    elsif p_payload ->> 'safety_ok' = 'false' then
        v_res := v_res || jsonb_build_object('level', 'red', 'text', 'Safety certificate expired');
    elsif p_payload ->> 'safety_ok' is null then
        v_res := v_res || jsonb_build_object('level', 'amber', 'text', 'No safety certificate on file');
    end if;
    -- today's deployment (staff only: p_today is null for the public)
    if p_today is not null then
        if dep is not null then
            if p_place is not null and (dep ->> 'place_id')::uuid is distinct from p_place then
                v_res := v_res || jsonb_build_object('level', 'red', 'text', format('Deployed to %s today, not this site', coalesce(dep ->> 'place', 'another site')));
            else
                add_ := format('Deployed to %s today', coalesce(dep ->> 'place', 'a site'));
                v_res := v_res || jsonb_build_object('level', 'green', 'text', add_);
            end if;
        elsif coalesce((p_today ->> 'plan_published')::boolean, false) then
            v_res := v_res || jsonb_build_object('level', 'amber', 'text', 'Not on today''s deployment plan');
        else
            v_res := v_res || jsonb_build_object('level', 'info', 'text', 'No deployment plan published for today');
        end if;
    end if;
    return v_res;
end;
$$;

create or replace function core._card_overall(p_checks jsonb)
returns text language sql immutable as $$
    select case
        when exists (select 1 from jsonb_array_elements(p_checks) e where e ->> 'level' = 'red') then 'red'
        when exists (select 1 from jsonb_array_elements(p_checks) e where e ->> 'level' = 'amber') then 'amber'
        else 'green' end;
$$;

-- ---------------------------------------------------------------------------
-- Codes
--   live (phone):   AKK1L.<card id hex>.<unix seconds base 36>.<20-hex HMAC>   — fresh for 120 s
--   printed (PVC):  AKK1P.<qr token>
--   typed / barcode: the 16-digit card number (staff only)
-- A code may arrive inside a URL (…?c=CODE or …/verify/CODE).
-- ---------------------------------------------------------------------------
create or replace function core._card_sign(p_card uuid, p_ts bigint)
returns text
language sql stable security definer set search_path = core, extensions as $$
    select left(encode(extensions.hmac(convert_to(p_card::text || ':' || p_ts::text, 'UTF8'), (select secret from core.card_secret where id = 1), 'sha256'), 'hex'), 20);
$$;

create or replace function core._b36(p bigint)
returns text language plpgsql immutable as $$
declare
    chars text := '0123456789abcdefghijklmnopqrstuvwxyz';
    n bigint := p;
    v_res text := '';
begin
    if n = 0 then return '0'; end if;
    while n > 0 loop
        v_res := substr(chars, (n % 36)::int + 1, 1) || v_res;
        n := n / 36;
    end loop;
    return v_res;
end;
$$;

create or replace function core._unb36(p text)
returns bigint language plpgsql immutable as $$
declare
    chars text := '0123456789abcdefghijklmnopqrstuvwxyz';
    n bigint := 0;
    ch text;
begin
    if p is null or p !~ '^[0-9a-z]{1,12}$' then return null; end if;
    foreach ch in array regexp_split_to_array(p, '') loop
        n := n * 36 + (strpos(chars, ch) - 1);
    end loop;
    return n;
end;
$$;

-- -> card id, method (live | printed | number), fresh (live code within 120 s)
create or replace function core._card_parse(p_code text)
returns table (card_id uuid, method text, fresh boolean)
language plpgsql stable security definer set search_path = core as $$
declare
    s text := trim(coalesce(p_code, ''));
    parts text[];
    v_id uuid;
    v_ts bigint;
    v_age bigint;
    digits text;
begin
    -- unwrap URLs
    if s ~* '^https?://' then
        if s ~ '[?&]c=' then
            s := substring(s from '[?&]c=([^&#]+)');
        else
            s := regexp_replace(s, '^.*/', '');
        end if;
    end if;
    if length(s) > 120 then
        return;
    end if;
    if s ~ '^AKK1L\.[0-9a-f]{32}\.[0-9a-z]{1,12}\.[0-9a-f]{20}$' then
        parts := string_to_array(s, '.');
        begin
            v_id := (substr(parts[2], 1, 8) || '-' || substr(parts[2], 9, 4) || '-' || substr(parts[2], 13, 4) || '-' || substr(parts[2], 17, 4) || '-' || substr(parts[2], 21, 12))::uuid;
        exception when others then
            return;
        end;
        v_ts := core._unb36(parts[3]);
        if v_ts is null or core._card_sign(v_id, v_ts) <> parts[4] then
            return; -- forged / tampered
        end if;
        v_age := extract(epoch from now())::bigint - v_ts;
        return query select v_id, 'live'::text, (v_age between -30 and 120);
        return;
    end if;
    if s ~ '^AKK1P\.[A-Za-z0-9_-]{24}$' then
        return query select c.id, 'printed'::text, true from core.employee_cards c where c.qr_token = substr(s, 7);
        return;
    end if;
    digits := regexp_replace(s, '[\s-]', '', 'g');
    if core._card_luhn_ok(digits) then
        return query select c.id, 'number'::text, true from core.employee_cards c where c.card_number = digits;
    end if;
end;
$$;

create or replace function core._card_log(p_card uuid, p_emp text, p_actor_kind text, p_actor text, p_purpose text, p_method text, p_result text)
returns bigint
language plpgsql volatile security definer set search_path = core as $$
declare v_id bigint;
begin
    insert into core.card_scans (card_id, employee_id, scanned_by, scanner_kind, purpose, method, result)
    values (p_card, p_emp, p_actor, coalesce(p_actor_kind, 'public'), p_purpose, p_method, p_result)
    returning id into v_id;
    return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- HOLDER: my card (worker, or staff linked to an employee)
-- ---------------------------------------------------------------------------
create or replace function core.my_card(p_token text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    v_card uuid;
begin
    select * into a from core._card_actor(p_token);
    if a.holder_emp is null then
        return null; -- staff login not linked to an employee
    end if;
    v_card := core._card_ensure(a.holder_emp);
    if v_card is null then
        select id into v_card from core.employee_cards where employee_id = a.holder_emp order by issued_at desc limit 1;
    end if;
    if v_card is null then
        return null;
    end if;
    return core._card_payload(v_card, 'holder');
end;
$$;

-- Fresh signed code for the holder's live QR (refresh every ~30 s).
create or replace function core.my_card_live_code(p_token text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    a record;
    c core.employee_cards;
    v_ts bigint := extract(epoch from now())::bigint;
begin
    select * into a from core._card_actor(p_token);
    if a.holder_emp is null then
        raise exception 'No card for this account';
    end if;
    select * into c from core.employee_cards where employee_id = a.holder_emp and status = 'active';
    if c.id is null then
        raise exception 'No active card';
    end if;
    return jsonb_build_object(
        'code', 'AKK1L.' || replace(c.id::text, '-', '') || '.' || core._b36(v_ts) || '.' || core._card_sign(c.id, v_ts),
        'issued_at', to_timestamp(v_ts),
        'ttl_seconds', 120,
        'server_time', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- VERIFY (anyone may verify a QR; typed numbers need a staff sign-in)
--   p_purpose: verify | site | clock | materials | vehicle
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
    perform core._card_log(c.id, c.employee_id, a.kind, a.who, v_purpose, p.method || case when p.method = 'live' and not p.fresh then '_stale' else '' end, v_overall);
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
        'viewer', coalesce(a.kind, 'public'));
end;
$$;

-- ---------------------------------------------------------------------------
-- CLOCK-IN by card (supervisor / manager / admin): resolve + check; the app then records the shift
-- with the same rules as a worker's own scan.
-- ---------------------------------------------------------------------------
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
-- ADMIN
-- ---------------------------------------------------------------------------
create or replace function core._card_admin()
returns text language plpgsql stable security definer set search_path = core as $$
begin
    if not core.is_hub_admin() then
        raise exception 'Admin access required';
    end if;
    return coalesce(auth.jwt() ->> 'email', auth.uid()::text);
end;
$$;

-- Every person + their current card; issues missing cards for employed people first.
create or replace function core.admin_cards()
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    r record;
begin
    perform core._card_admin();
    for r in select employee_id from core._wi_all_base() where in_company loop
        perform core._card_ensure(r.employee_id);
    end loop;
    return coalesce((
        select jsonb_agg(x order by (x ->> 'in_company')::boolean desc, x ->> 'employee_id')
          from (
            select (coalesce(core._card_payload(c.id, 'admin'),
                            jsonb_build_object('employee_id', b.employee_id, 'name', b.name, 'designation', b.designation,
                                               'worker_type', b.worker_type, 'in_company', b.in_company, 'state', 'none',
                                               'role', core._card_role(b.employee_id))) - 'photo')
                   || jsonb_build_object('has_photo', exists (select 1 from core.worker_photos p where p.employee_id = b.employee_id),
                                         'linked', (select coalesce(jsonb_agg(l.login order by l.login), '[]'::jsonb) from core.employee_links l where l.employee_id = b.employee_id)) as x
              from core._wi_all_base() b
              left join lateral (select * from core.employee_cards c2 where c2.employee_id = b.employee_id
                                  order by (c2.status = 'active') desc, c2.issued_at desc limit 1) c on true
          ) y
    ), '[]'::jsonb);
end;
$$;

create or replace function core.admin_card_detail(p_employee_id text)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_card uuid;
begin
    perform core._card_admin();
    v_card := core._card_ensure(trim(p_employee_id));
    if v_card is null then
        select id into v_card from core.employee_cards where employee_id = trim(p_employee_id) order by issued_at desc limit 1;
    end if;
    return jsonb_build_object(
        'card', case when v_card is null then null else core._card_payload(v_card, 'admin') end,
        'history', coalesce((select jsonb_agg(jsonb_build_object('card_last4', right(c.card_number, 4), 'status', c.status,
                                    'valid_from', c.valid_from, 'valid_until', c.valid_until, 'issued_at', c.issued_at,
                                    'ended_at', c.ended_at, 'end_reason', c.end_reason) order by c.issued_at desc)
                              from core.employee_cards c where c.employee_id = trim(p_employee_id)), '[]'::jsonb),
        'scans', coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'purpose', s.purpose, 'method', s.method,
                                    'result', s.result, 'by', s.scanned_by, 'kind', s.scanner_kind) order by s.at desc)
                             from (select * from core.card_scans where employee_id = trim(p_employee_id) order by at desc limit 30) s), '[]'::jsonb),
        'links', coalesce((select jsonb_agg(jsonb_build_object('login', l.login, 'roles',
                                    (select coalesce(jsonb_agg(distinct h.role), '[]'::jsonb) from core._hub_logins() h where h.login = l.login),
                                    'name', (select max(nullif(h.name, '')) from core._hub_logins() h where h.login = l.login)) order by l.login)
                             from core.employee_links l where l.employee_id = trim(p_employee_id)), '[]'::jsonb),
        'role', core._card_role(trim(p_employee_id)));
end;
$$;

-- Renew (or re-issue after cancel): the current card becomes "replaced", a new number + QR is issued.
create or replace function core.admin_card_renew(p_employee_id text, p_reason text default null)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._card_admin();
    v_emp text := trim(p_employee_id);
    v_new uuid;
begin
    if not exists (select 1 from core._wi_base(v_emp)) then
        raise exception 'Worker not found';
    end if;
    if not coalesce((select in_company from core._wi_base(v_emp)), false) then
        raise exception 'This person is not in the company — mark them employed first';
    end if;
    update core.employee_cards set status = 'replaced', ended_at = clock_timestamp(), ended_by = v_actor,
           end_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Renewed')
     where employee_id = v_emp and status = 'active';
    v_new := core._card_issue(v_emp, v_actor);
    return core._card_payload(v_new, 'admin');
end;
$$;

create or replace function core.admin_card_void(p_employee_id text, p_reason text)
returns void
language plpgsql volatile security definer set search_path = core as $$
declare v_actor text := core._card_admin();
begin
    if length(trim(coalesce(p_reason, ''))) < 3 then
        raise exception 'Give a reason (e.g. Lost card)';
    end if;
    update core.employee_cards set status = 'void', ended_at = clock_timestamp(), ended_by = v_actor, end_reason = trim(p_reason)
     where employee_id = trim(p_employee_id) and status = 'active';
end;
$$;

-- Data for printing PVC cards (admin only); counts the print.
create or replace function core.admin_cards_for_print(p_employee_ids text[])
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_out jsonb := '[]'::jsonb;
    v_emp text;
    v_card uuid;
begin
    perform core._card_admin();
    if p_employee_ids is null or cardinality(p_employee_ids) = 0 or cardinality(p_employee_ids) > 500 then
        raise exception 'Choose between 1 and 500 people';
    end if;
    foreach v_emp in array p_employee_ids loop
        v_card := core._card_ensure(trim(v_emp));
        if v_card is null then
            continue; -- not in company and no card: nothing to print
        end if;
        update core.employee_cards set printed_count = printed_count + 1, last_printed_at = now() where id = v_card and status = 'active';
        v_out := v_out || jsonb_build_array(core._card_payload(v_card, 'admin'));
    end loop;
    return v_out;
end;
$$;

-- Linking hub logins to employees
create or replace function core.admin_linkable_accounts()
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._card_admin();
    return coalesce((
        select jsonb_agg(jsonb_build_object('login', g.login, 'name', g.name, 'roles', g.roles, 'top_role', g.top,
                                            'employee_id', l.employee_id) order by g.login)
          from (select h.login, max(nullif(h.name, '')) as name, jsonb_agg(distinct jsonb_build_object('area', h.area, 'role', h.role)) as roles,
                       (array_agg(h.role order by core._role_rank(h.role) desc))[1] as top
                  from core._hub_logins() h group by h.login) g
          left join core.employee_links l on l.login = g.login
    ), '[]'::jsonb);
end;
$$;

create or replace function core.admin_link_account(p_employee_id text, p_login text)
returns jsonb
language plpgsql volatile security definer set search_path = core as $$
declare
    v_actor text := core._card_admin();
    v_login text := lower(trim(coalesce(p_login, '')));
    v_emp text := trim(coalesce(p_employee_id, ''));
    v_other text;
begin
    if not exists (select 1 from core._wi_base(v_emp)) then
        raise exception 'Worker not found';
    end if;
    if not exists (select 1 from core._hub_logins() h where h.login = v_login) then
        raise exception 'No manager / supervisor / admin login "%"', v_login;
    end if;
    select employee_id into v_other from core.employee_links where login = v_login;
    if v_other is not null and v_other <> v_emp then
        raise exception 'That login is already linked to employee %', v_other;
    end if;
    insert into core.employee_links (login, employee_id, linked_by) values (v_login, v_emp, v_actor)
    on conflict (login) do nothing;
    return core.admin_card_detail(v_emp);
end;
$$;

create or replace function core.admin_unlink_account(p_login text)
returns void
language plpgsql volatile security definer set search_path = core as $$
begin
    perform core._card_admin();
    delete from core.employee_links where login = lower(trim(coalesce(p_login, '')));
end;
$$;

create or replace function core.admin_card_scans(p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = core as $$
begin
    perform core._card_admin();
    return coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'employee_id', s.employee_id, 'name', b.name, 'purpose', s.purpose,
                                'method', s.method, 'result', s.result, 'by', s.scanned_by, 'kind', s.scanner_kind) order by s.at desc)
                       from (select * from core.card_scans order by at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) s
                       left join core._wi_all_base() b on b.employee_id = s.employee_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
    foreach f in array array['core._card_luhn(text)', 'core._card_luhn_ok(text)', 'core._card_new_number()', 'core._card_new_token()',
        'core._card_issue(text, text)', 'core._card_ensure(text)', 'core._hub_logins()', 'core._role_rank(text)', 'core._card_role(text)',
        'core._card_actor(text)', 'core._card_effective_until(core.employee_cards)', 'core._card_state(core.employee_cards)',
        'core._card_payload(uuid, text)', 'core._card_today(text)', 'core._card_checks(jsonb, jsonb, text, boolean, uuid)',
        'core._card_overall(jsonb)', 'core._card_sign(uuid, bigint)', 'core._b36(bigint)', 'core._unb36(text)', 'core._card_parse(text)',
        'core._card_log(uuid, text, text, text, text, text, text)', 'core._card_admin()'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
    foreach f in array array['core.my_card(text)', 'core.my_card_live_code(text)', 'core.card_verify(text, text, text, uuid)',
        'core.card_clock_context(text, text)'] loop
        execute format('revoke all on function %s from public', f);
        execute format('grant execute on function %s to anon, authenticated', f);
    end loop;
    foreach f in array array['core.admin_cards()', 'core.admin_card_detail(text)', 'core.admin_card_renew(text, text)',
        'core.admin_card_void(text, text)', 'core.admin_cards_for_print(text[])', 'core.admin_linkable_accounts()',
        'core.admin_link_account(text, text)', 'core.admin_unlink_account(text)', 'core.admin_card_scans(int)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;

-- Issue cards for everyone currently employed.
do $$
declare b record;
begin
    for b in select employee_id from core._wi_all_base() where in_company loop
        perform core._card_ensure(b.employee_id);
    end loop;
end $$;
