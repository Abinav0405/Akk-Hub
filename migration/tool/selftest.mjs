#!/usr/bin/env node
/**
 * Offline self-test: runs the real migration code (catalog → DDL → apply → copy → auth → finish →
 * core / one-login SQL) on in-memory Postgres 17 databases (PGlite) that imitate the three old
 * projects, then checks data, logins, permissions and places. Touches no real database.
 *
 *   npm run selftest
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readSchema, readStorage } from './lib/catalog.mjs';
import { q } from './lib/db.mjs';
import { applyStructure, planAuth, writeAuth, finishOn, readSqlFile, SOURCE_KEYS, TARGET_SCHEMA } from './lib/steps.mjs';

// ------------------------------------------------------------------------------------------------
// pg-style wrapper: multi-statement SQL without parameters goes through exec().
function wrap(db) {
    return {
        db,
        async query(sql, params) {
            if (params && params.length) {
                const r = await db.query(sql, params);
                return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
            }
            const rs = await db.exec(sql);
            const last = rs[rs.length - 1] || { rows: [] };
            return { rows: last.rows, rowCount: last.affectedRows ?? last.rows.length };
        },
    };
}
const newDb = async () => wrap(await PGlite.create({ extensions: { pgcrypto, uuid_ossp } }));

// Just enough of a Supabase project: API roles, auth.*, storage.*, extensions.
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, confirmation_token text, recovery_token text, email_change_token_new text,
  email_change text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  last_sign_in_at timestamptz, is_sso_user boolean not null default false,
  confirmed_at timestamptz generated always as (email_confirmed_at) stored
);
create table auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade, identity_data jsonb not null,
  provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid primary key default gen_random_uuid()
);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;
const GRANTS = `
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
`;

const UID = {
    attAdmin: '00000000-0000-4000-8000-0000000000a1',
    attStaff1: '00000000-0000-4000-8000-0000000000a2',
    matStaff1: '00000000-0000-4000-8000-0000000000b1',
    matStaff2: '00000000-0000-4000-8000-0000000000b2',
    proStaff1: '00000000-0000-4000-8000-0000000000c1',
};
const TOKEN = {
    w1: '11111111-1111-4111-8111-111111111111',
    w3: '33333333-3333-4333-8333-333333333333',
    l1: '44444444-4444-4444-8444-444444444444',
    expired: '55555555-5555-4555-8555-555555555555',
};
const authUser = (id, email, pw) =>
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role, raw_user_meta_data, created_at, updated_at)
     values ('${id}', '${email}', extensions.crypt('${pw}', extensions.gen_salt('bf')), now(), 'authenticated', 'authenticated',
             '{"name":"${email.split('@')[0]}"}', now(), now());
     insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
     values ('${id}', '${id}', '{"sub":"${id}","email":"${email}"}', 'email', now(), now());`;

// ------------------------------------------------------------------------------------------------
const ATTENDANCE = `
create type public.leave_kind as enum ('annual', 'medical');
create table public.sites (id text primary key, site_name text not null, created_at timestamptz default now());
create table public.worker_details (employee_id text primary key, employee_name text not null, designation text not null,
  nric_fin text, password_hash text not null, in_company boolean default true, face_id_set boolean default false,
  face_embedding jsonb, created_at timestamptz default now());
create table public.local_worker_details (employee_id varchar primary key, employee_name varchar not null, designation varchar,
  password_hash varchar, in_company boolean default true, face_id_set boolean default false, face_embedding jsonb);
create table public.managers (id uuid primary key default gen_random_uuid(), email varchar(255) not null, password_hash varchar(255) not null,
  name varchar(255) not null, updated_at timestamptz default now());
create table public.supervisors (id uuid primary key default gen_random_uuid(), supervisor_id text not null, name text not null,
  password_hash text not null, site_id text not null, is_active boolean default true);
create table public.shifts (id uuid primary key default gen_random_uuid(), worker_id text not null, site_id text references public.sites(id),
  work_date date not null);
create table public.leave_requests (id uuid primary key default gen_random_uuid(), employee_id text not null,
  kind public.leave_kind not null default 'annual', status text not null default 'pending');
create table public.role_sessions (session_token uuid primary key default gen_random_uuid(), role text not null, subject_id text not null,
  expires_at timestamptz not null, session_kind text not null default 'full');
create sequence public.login_events_id_seq;
create table public.login_events (id bigint primary key default nextval('login_events_id_seq'::regclass), who text);
alter sequence public.login_events_id_seq owned by public.login_events.id;
create table public.security_alerts (id bigint generated by default as identity primary key, note text);

create function public.is_admin_jwt() returns boolean language sql stable as $$ select auth.role() = 'authenticated' $$;
create function public.count_shifts(p text) returns bigint language sql stable as $$ select count(*) from shifts where worker_id = p $$;
create function public.touch() returns trigger language plpgsql as $$ begin new.updated_at = now() - interval '1 second'; return new; end $$;
create trigger managers_touch before update on public.managers for each row execute function public.touch();
create view public.active_workers as select employee_id, employee_name from public.worker_details where in_company;

alter table public.worker_details enable row level security;
alter table public.shifts enable row level security;
alter table public.managers enable row level security;
alter table public.leave_requests enable row level security;
create policy "anon all" on public.worker_details for all to anon using (true) with check (true);
create policy "admin all" on public.worker_details for all to authenticated using (true) with check (true);
create policy "admins" on public.shifts for all to authenticated using (true) with check (true);
create policy "anon read" on public.shifts for select to anon using (true);
create policy "mgr policy" on public.managers for all using (auth.role() = 'authenticated'::text);
create policy "open" on public.leave_requests for select using (true);
${GRANTS}
revoke all on public.role_sessions from anon, authenticated;

insert into public.sites values ('S1', 'Kaki Bukit Office'), ('S2', 'Tampines Site');
insert into public.worker_details (employee_id, employee_name, designation, nric_fin, password_hash, face_embedding) values
  ('W1', 'Ali', 'Fitter', 'S1234567A', 'pw1', '[0.1,0.2]'),
  ('1018', 'Kumar', 'Supervisor', 'S7654321B', extensions.crypt('pw18', extensions.gen_salt('bf')), null),
  ('W3', 'Bala', 'Helper', 'S0000003C', 'pw3', null);
insert into public.local_worker_details (employee_id, employee_name, designation, password_hash) values
  ('L1', 'Tan', 'Driver', 'lpw'), ('1018r', 'Raj', 'Driver', 'rpw');
insert into public.managers (email, password_hash, name) values ('boss@akk.test', 'x', 'Boss');
insert into public.supervisors (supervisor_id, name, password_hash, site_id) values ('1018', 'Kumar (sup)', 'x', 'S1');
insert into public.shifts (worker_id, site_id, work_date) values ('W1', 'S1', '2026-01-01'), ('W1', 'S1', '2026-01-02'), ('W3', 'S2', '2026-01-02');
insert into public.leave_requests (employee_id) values ('W1');
insert into public.role_sessions (session_token, role, subject_id, expires_at) values
  ('${TOKEN.w1}', 'worker', 'W1', now() + interval '1 day'),
  ('${TOKEN.w3}', 'worker', 'W3', now() + interval '1 day'),
  ('${TOKEN.l1}', 'worker', 'L1', now() + interval '1 day'),
  ('${TOKEN.expired}', 'worker', '1018', now() - interval '1 day');
insert into public.login_events (who) values ('a'), ('b'), ('c');
select setval('public.login_events_id_seq', 10);
insert into public.security_alerts (note) values ('x'), ('y');
${authUser(UID.attAdmin, 'admin@akk.test', 'adminpw')}
${authUser(UID.attStaff1, 'Staff1@akk.test', 'attpw')}
insert into storage.buckets (id, name) values ('leave-attachments', 'leave-attachments');
create policy "auth read leave" on storage.objects for select to authenticated using (true);
`;

const MATERIALS = `
create table public.sites (id uuid primary key default gen_random_uuid(), name text not null);
create table public.requesters (id uuid primary key default gen_random_uuid(), requester_id text not null unique, name text not null,
  password_hash text, created_at timestamptz default now());
create table public.worker_sessions (token text primary key, requester_id text not null references public.requesters(requester_id) on delete cascade,
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'));
create table public.transactions (id uuid primary key default gen_random_uuid(), worker_id text, worker_name text,
  site_id uuid references public.sites(id), approval_status text not null default 'pending', created_at timestamptz default now());
create table public.staff_profiles (user_id uuid primary key references auth.users(id) on delete cascade, display_name text not null,
  email text not null, role text not null, roles text[] not null default '{}', is_active boolean not null default true);
create table public.staff_activity (id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.staff_profiles(user_id) on delete restrict, action text not null);

create function public.verify_requester_login(p_requester_id text, p_password text)
returns table(token text, requester_id text, name text) language plpgsql security definer set search_path = public as $$
declare r public.requesters%rowtype; v_token text;
begin
  select * into r from public.requesters req where req.requester_id = p_requester_id;
  if not found or r.password_hash is distinct from p_password then raise exception 'Invalid requester ID or password'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.worker_sessions (token, requester_id) values (v_token, r.requester_id);
  return query select v_token, r.requester_id, r.name;
end $$;
create function public.verify_worker_session(p_token text)
returns table(requester_id text, name text) language plpgsql security definer set search_path = public as $$
begin
  return query select r.requester_id, r.name from public.worker_sessions s join public.requesters r on r.requester_id = s.requester_id
   where s.token = p_token and s.expires_at > now();
end $$;
create function public.worker_change_password(p_token text, p_current_password text, p_new_password text)
returns boolean language plpgsql security definer set search_path = public as $$ begin return false; end $$;
create function public.worker_delete_pending_transaction(p_transaction_id uuid, p_worker_id text, p_password text)
returns boolean language plpgsql security definer set search_path = public as $$ begin return false; end $$;
create function public.get_worker_transactions(p_token text) returns setof public.transactions
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  select requester_id into v from public.verify_worker_session(p_token);
  if v is null then raise exception 'Session expired'; end if;
  return query select * from public.transactions t where t.worker_id = v;
end $$;
create function public.mt_fcm_db_webhook() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger tx_push after insert on public.transactions for each row execute function public.mt_fcm_db_webhook();

alter table public.transactions enable row level security;
alter table public.worker_sessions enable row level security;
create policy "anon insert" on public.transactions for insert to anon with check (approval_status = 'pending');
create policy "staff all" on public.transactions for all to authenticated
  using (exists (select 1 from public.staff_profiles sp where sp.user_id = auth.uid() and sp.is_active));
${GRANTS}
revoke all on public.worker_sessions from anon, authenticated;
revoke all on function public.verify_requester_login(text, text) from public;
grant execute on function public.verify_requester_login(text, text) to anon;
revoke all on function public.verify_worker_session(text) from public;
grant execute on function public.verify_worker_session(text) to anon;
revoke all on function public.worker_change_password(text, text, text) from public;
grant execute on function public.worker_change_password(text, text, text) to anon;
revoke all on function public.worker_delete_pending_transaction(uuid, text, text) from public;
grant execute on function public.worker_delete_pending_transaction(uuid, text, text) to anon;

insert into public.sites (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Kaki Bukit Office'),
                                          ('aaaaaaaa-0000-4000-8000-000000000002', 'Woodlands');
insert into public.requesters (requester_id, name, password_hash) values ('W1', 'Ali', 'mpw1'), ('1018', 'Kumar', 'mpw18'), ('X9', 'Ghost', 'x');
insert into public.worker_sessions (token, requester_id) values ('native-mat-w1', 'W1');
insert into public.transactions (worker_id, worker_name, site_id, approval_status) values
  ('W1', 'Ali', 'aaaaaaaa-0000-4000-8000-000000000001', 'pending'),
  ('W1', 'Ali', 'aaaaaaaa-0000-4000-8000-000000000001', 'approved');
${authUser(UID.matStaff1, 'staff1@akk.test', 'matpw')}
${authUser(UID.matStaff2, 'staff2@akk.test', 'mat2pw')}
insert into public.staff_profiles (user_id, display_name, email, role, roles) values
  ('${UID.matStaff1}', 'Staff One', 'staff1@akk.test', 'admin', '{admin}'),
  ('${UID.matStaff2}', 'Staff Two', 'staff2@akk.test', 'manager', '{manager}');
insert into public.staff_activity (actor_id, action) values ('${UID.matStaff1}', 'approve'), ('${UID.matStaff2}', 'view');
insert into storage.buckets (id, name, public) values ('material-photos', 'material-photos', true);
create policy "anon upload" on storage.objects for insert to anon with check (bucket_id = 'material-photos');
`;

const PROGRESS = `
create table public.app_users (id uuid primary key default gen_random_uuid(), role text not null default 'worker' check (role = 'worker'),
  employee_code text not null unique, display_name text not null, password_hash text not null, is_active boolean not null default true,
  created_at timestamptz not null default now());
create table public.sites (id uuid primary key default gen_random_uuid(), name text not null unique, is_active boolean not null default true);
create sequence public.package_no_seq;
create table public.packages (id uuid primary key default gen_random_uuid(), package_no text not null default ('PKG-' || lpad(nextval('public.package_no_seq')::text, 4, '0')),
  worker_id uuid not null references public.app_users(id), site_id uuid not null references public.sites(id),
  approved_by uuid references auth.users(id), created_at timestamptz not null default now());
create table public.jsrs (id uuid primary key default gen_random_uuid(), jsr_no text not null unique, site_id uuid not null references public.sites(id));
create table public.role_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.app_users(id),
  role text not null default 'worker', session_token text not null unique, expires_at timestamptz not null);
create table public.admin_profiles (user_id uuid primary key references auth.users(id) on delete cascade, display_name text not null,
  email text not null, is_active boolean not null default true);
create table public.manager_users (id uuid primary key default gen_random_uuid(), login_id text not null unique, display_name text not null,
  password_hash text not null, is_active boolean not null default true);
create table public.push_delivery_config (id int primary key default 1 check (id = 1), webhook_url text, webhook_secret text);

create function public.verify_role_session(p_session_token text)
returns table (user_id uuid, role text, display_name text, employee_code text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query select u.id, s.role, u.display_name, u.employee_code from role_sessions s join app_users u on u.id = s.user_id
   where s.session_token = p_session_token and s.expires_at > now() and u.is_active = true;
end $$;
create function public._require_worker(p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_worker_id uuid;
begin
  select user_id into v_worker_id from verify_role_session(p_session_token);
  if v_worker_id is null then raise exception 'Not authenticated'; end if;
  return v_worker_id;
end $$;
create function public.worker_list_packages(p_session_token text) returns setof public.packages
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query select * from packages p where p.worker_id = _require_worker(p_session_token) order by p.package_no;
end $$;
create function public.worker_create_package(p_session_token text, p_site_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  insert into packages (worker_id, site_id) values (_require_worker(p_session_token), p_site_id) returning package_no into v;
  return v;
end $$;

alter table public.app_users enable row level security;
alter table public.packages enable row level security;
alter table public.admin_profiles enable row level security;
create policy admin_can_read_own_profile on public.admin_profiles for select using (auth.uid() = user_id);
${GRANTS}
revoke all on public.role_sessions, public.manager_users, public.push_delivery_config from anon, authenticated;

insert into public.sites (id, name) values ('bbbbbbbb-0000-4000-8000-000000000001', 'AKK KAKI BUKIT OFFICE AND STORE'),
                                          ('bbbbbbbb-0000-4000-8000-000000000002', 'Jurong');
insert into public.app_users (id, employee_code, display_name, password_hash) values
  ('cccccccc-0000-4000-8000-000000000001', 'W1', 'Ali', extensions.crypt('ppw1', extensions.gen_salt('bf'))),
  ('cccccccc-0000-4000-8000-000000000018', '1018', 'Kumar', extensions.crypt('ppw18', extensions.gen_salt('bf')));
insert into public.role_sessions (user_id, session_token, expires_at) values ('cccccccc-0000-4000-8000-000000000001', 'native-pro-w1', now() + interval '1 day');
${authUser(UID.proStaff1, 'staff1@akk.test', 'propw')}
insert into public.packages (worker_id, site_id, approved_by) values
  ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', '${UID.proStaff1}'),
  ('cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', null);
select setval('public.package_no_seq', 702);
insert into public.jsrs (jsr_no, site_id) values ('JSR-1', 'bbbbbbbb-0000-4000-8000-000000000001');
insert into public.admin_profiles (user_id, display_name, email) values ('${UID.proStaff1}', 'Staff One', 'staff1@akk.test');
insert into public.manager_users (login_id, display_name, password_hash) values ('mgr1', 'Manager', 'x');
insert into public.push_delivery_config (id, webhook_url, webhook_secret) values (1, 'https://old.example/webhook', 'not-a-real-secret');
insert into storage.buckets (id, name) values ('package-images', 'package-images');
create policy "staff read images" on storage.objects for select to authenticated using (bucket_id = 'package-images');
`;

const MERGES = [
    { name: 'Kaki Bukit Office', attendance: 'Kaki Bukit Office', materials: 'Kaki Bukit Office', progress: 'AKK KAKI BUKIT OFFICE AND STORE' },
    { name: 'Missing place', materials: 'No such site' },
];

// ------------------------------------------------------------------------------------------------
let passed = 0;
let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed += 1;
        console.log(`  ✗ ${name}\n      ${e.message}`);
    }
}
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const eq = (got, want, what = '') => {
    if (canon(got) !== canon(want)) throw new Error(`${what} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const truthy = (v, what) => {
    if (!v) throw new Error(`${what} was ${JSON.stringify(v)}`);
};
async function throws(p, re) {
    try {
        await p;
    } catch (e) {
        if (re && !re.test(e.message)) throw new Error(`wrong error: ${e.message}`);
        return;
    }
    throw new Error('expected an error, none raised');
}
const n = (v) => Number(v);

/** Run one statement as an API role with the given JWT claims. */
async function as(c, role, claims, sql, params = []) {
    await c.db.exec(`select set_config('request.jwt.claims', ${"'" + JSON.stringify({ role, ...claims }).replace(/'/g, "''") + "'"}, false); set role ${role};`);
    try {
        return await c.db.query(sql, params);
    } finally {
        await c.db.exec("reset role; select set_config('request.jwt.claims', '', false);");
    }
}
const anon = (c, sql, p) => as(c, 'anon', {}, sql, p);
const authed = (c, sub, sql, p) => as(c, 'authenticated', { sub }, sql, p);

// ------------------------------------------------------------------------------------------------
async function main() {
    console.log('\n=== Build the three old projects (in memory) ===');
    const src = {};
    for (const [key, sql] of [['attendance', ATTENDANCE], ['materials', MATERIALS], ['progress', PROGRESS]]) {
        src[key] = await newDb();
        await src[key].query(SUPABASE_STUB);
        await src[key].query(sql);
        console.log(`  ✓ ${key}`);
    }

    console.log('\n=== Snapshot → apply → copy → auth → finish ===');
    const snaps = {};
    for (const key of SOURCE_KEYS) {
        const schema = await readSchema(src[key], 'public');
        const storage = await readStorage(src[key]);
        snaps[key] = JSON.parse(JSON.stringify({ schema, storage }, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
    }
    const dst = await newDb();
    await dst.query(SUPABASE_STUB);
    let realtime = true;
    try {
        await dst.query('create publication supabase_realtime');
    } catch {
        realtime = false;
    }
    const prereq = readSqlFile('00_prereq.sql')
        .split('\n')
        .filter((l) => !/pg_net/.test(l))
        .join('\n');
    await applyStructure(dst, snaps, { prereqSql: prereq, onStep: (m) => console.log(`  ✓ ${m}`) });

    for (const key of SOURCE_KEYS) {
        const target = TARGET_SCHEMA[key];
        await dst.query('BEGIN');
        await dst.query('SET LOCAL session_replication_role = replica');
        for (const t of snaps[key].schema.tables) {
            const cols = t.columns.filter((c) => c.generated !== 's').map((c) => q(c.name)).join(', ');
            const rows = (await src[key].query(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') j from public.${q(t.name)} x`)).rows[0].j;
            await dst.query(
                `insert into ${target}.${q(t.name)} (${cols}) select ${cols} from jsonb_populate_recordset(null::${target}.${q(t.name)}, $1::jsonb)`,
                [JSON.stringify(rows)]
            );
        }
        await dst.query('COMMIT');
    }
    console.log('  ✓ rows copied');

    const bySource = {};
    for (const key of SOURCE_KEYS) {
        bySource[key] = {
            users: (await src[key].query('select to_jsonb(u) u from auth.users u')).rows.map((r) => r.u),
            identities: (await src[key].query('select to_jsonb(i) i from auth.identities i')).rows.map((r) => r.i),
        };
    }
    const plan = planAuth(bySource);
    const imported = await writeAuth(dst, plan);
    console.log(`  ✓ auth: ${imported.length} accounts`);

    const { summary, warnings } = await finishOn(dst, {
        snaps,
        authMap: { uidMap: plan.uidMap, attendanceAdmins: plan.attendanceAdmins },
        merges: MERGES,
        liveSequence: async (key, name) => {
            const r = (await src[key].query(`select last_value::text v, is_called from public.${q(name)}`)).rows[0];
            return r.is_called ? r.v : null;
        },
        onStep: (m) => console.log(`  ✓ ${m}`),
    });
    for (const w of warnings) console.log(`  ! ${w}`);

    // --------------------------------------------------------------------------------------------
    console.log('\n=== Data ===');
    await check('every table has the same rows as its old project', async () => {
        for (const key of SOURCE_KEYS) {
            for (const t of snaps[key].schema.tables) {
                const a = n((await src[key].query(`select count(*) c from public.${q(t.name)}`)).rows[0].c);
                const b = n((await dst.query(`select count(*) c from ${TARGET_SCHEMA[key]}.${q(t.name)}`)).rows[0].c);
                eq(b, a, `${key}.${t.name}`);
            }
        }
    });
    await check('old projects untouched (no rows added there)', async () => {
        eq(n((await src.materials.query('select count(*) c from public.requesters')).rows[0].c), 3);
        eq((await src.materials.query("select password_hash from public.requesters where requester_id = 'W1'")).rows[0].password_hash, 'mpw1');
    });
    await check('nothing in the new schemas still points at "public"', async () => {
        const fns = await dst.query(`select p.oid::regprocedure::text s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = any(array['attendance','materials','progress','core']) and p.prokind in ('f', 'p')
              and (pg_get_functiondef(p.oid) ~ '[^a-z_]public\\.' or array_to_string(p.proconfig, ',') ~ 'public')`);
        eq(fns.rows.map((r) => r.s), [], 'functions');
        const pols = await dst.query(`select schemaname || '.' || tablename || ' ' || policyname s from pg_policies
            where coalesce(qual, '') || coalesce(with_check, '') ~ 'public\\.'`);
        eq(pols.rows.map((r) => r.s), [], 'policies');
    });
    await check('functions that relied on the old search path still work', async () => {
        eq(n((await dst.query("select attendance.count_shifts('W1') c")).rows[0].c), 2);
    });
    await check('views, enums, triggers', async () => {
        eq(n((await dst.query('select count(*) c from attendance.active_workers')).rows[0].c), 3);
        eq((await dst.query("select enum_range(null::attendance.leave_kind)::text r")).rows[0].r, '{annual,medical}');
        await dst.query("update attendance.managers set name = 'Boss2'");
        truthy((await dst.query('select updated_at < now() ok from attendance.managers')).rows[0].ok, 'trigger fired');
    });
    await check('numbering continues (sequences and identity columns)', async () => {
        eq(n((await dst.query("insert into attendance.login_events (who) values ('d') returning id")).rows[0].id), 11);
        eq(n((await dst.query("insert into attendance.security_alerts (note) values ('z') returning id")).rows[0].id), 3);
        eq((await dst.query(`select progress.worker_create_package('native-pro-w1', 'bbbbbbbb-0000-4000-8000-000000000002') v`)).rows[0].v, 'PKG-0703');
    });
    await check('webhook function + trigger with secrets were left out', async () => {
        eq(n((await dst.query("select count(*) c from pg_proc where proname = 'mt_fcm_db_webhook'")).rows[0].c), 0);
        eq(n((await dst.query("select count(*) c from pg_trigger where tgname = 'tx_push'")).rows[0].c), 0);
    });
    await check('Site Progress push paused in the new project', async () => {
        eq((await dst.query('select webhook_url from progress.push_delivery_config')).rows[0].webhook_url, null);
    });
    if (realtime) {
        await check('realtime publication', async () => {
            // (no tables were published in the mock sources)
            truthy((await dst.query("select 1 from pg_publication where pubname = 'supabase_realtime'")).rows.length, 'publication');
        });
    }

    console.log('\n=== Staff / admin accounts ===');
    await check('same e-mail in several projects became one account (Site Progress id kept)', async () => {
        const r = await dst.query("select id::text from auth.users where lower(email) = 'staff1@akk.test'");
        eq(r.rows.map((x) => x.id), [UID.proStaff1]);
        eq(n((await dst.query('select count(*) c from auth.users')).rows[0].c), 3);
    });
    await check('password of a merged account comes from Attendance', async () => {
        const r = await dst.query(`select encrypted_password = extensions.crypt('attpw', encrypted_password) ok from auth.users where id = $1`, [UID.proStaff1]);
        truthy(r.rows[0].ok, 'attendance password works');
    });
    await check('each account keeps its sign-in identity', async () => {
        eq(n((await dst.query('select count(*) c from auth.identities')).rows[0].c), 3);
    });
    await check('Materials staff rows re-pointed to the merged account', async () => {
        eq((await dst.query(`select user_id::text u from materials.staff_profiles where email = 'staff1@akk.test'`)).rows[0].u, UID.proStaff1);
        eq(n((await dst.query(`select count(*) c from materials.staff_activity where actor_id = $1`, [UID.proStaff1])).rows[0].c), 1);
        eq(n((await dst.query(`select count(*) c from materials.staff_profiles p where not exists (select 1 from auth.users u where u.id = p.user_id)`)).rows[0].c), 0);
    });
    await check('running the account copy again changes nothing', async () => {
        eq((await writeAuth(dst, plan)).length, 0);
    });
    await check('Attendance admins = Attendance sign-in accounts only', async () => {
        const r = await dst.query('select user_id::text u from core.attendance_admins order by 1');
        eq(r.rows.map((x) => x.u), [UID.attAdmin, UID.proStaff1].sort());
    });

    console.log('\n=== Attendance permissions (unchanged for each kind of user) ===');
    await check('anon (hub worker / manager) still reads worker details', async () => {
        eq((await anon(dst, 'select count(*) c from attendance.worker_details')).rows[0].c * 1, 3);
    });
    await check('Materials-only staff (signed in) are treated like before (anon), not as admins', async () => {
        eq((await authed(dst, UID.matStaff2, 'select count(*) c from attendance.worker_details')).rows[0].c * 1, 3);
        eq((await authed(dst, UID.matStaff2, 'select count(*) c from attendance.shifts')).rows[0].c * 1, 3);
        eq((await authed(dst, UID.matStaff2, 'select count(*) c from attendance.managers')).rows[0].c * 1, 0);
        eq((await authed(dst, UID.matStaff2, 'delete from attendance.shifts')).affectedRows, 0);
        eq((await authed(dst, UID.matStaff2, 'select attendance.is_admin_jwt() a')).rows[0].a, false);
    });
    await check('Attendance admin keeps full access', async () => {
        eq((await authed(dst, UID.attAdmin, 'select count(*) c from attendance.managers')).rows[0].c * 1, 1);
        eq((await authed(dst, UID.attAdmin, 'select count(*) c from attendance.worker_details')).rows[0].c * 1, 3);
        eq((await authed(dst, UID.attAdmin, 'select attendance.is_admin_jwt() a')).rows[0].a, true);
    });
    await check('anon cannot see managers (auth.role() check now means Attendance admin)', async () => {
        eq((await anon(dst, 'select count(*) c from attendance.managers')).rows[0].c * 1, 0);
    });
    await check('role_sessions stays closed to the API', async () => {
        await throws(anon(dst, 'select * from attendance.role_sessions'), /permission denied/);
    });

    console.log('\n=== Materials ===');
    await check('passwords are now encrypted and the same passwords still work', async () => {
        truthy((await dst.query("select password_hash like '$2%' ok from materials.requesters where requester_id = 'W1'")).rows[0].ok, 'hashed');
        const r = await anon(dst, "select requester_id from materials.verify_requester_login('W1', 'mpw1')");
        eq(r.rows[0].requester_id, 'W1');
        await throws(anon(dst, "select * from materials.verify_requester_login('W1', 'wrong')"), /Invalid requester/);
    });
    await check('replaced functions did not leave duplicates behind', async () => {
        const r = await dst.query(`select proname, count(*)::int c from pg_proc where pronamespace = 'materials'::regnamespace
            and proname in ('verify_worker_session','verify_requester_login','worker_change_password','worker_delete_pending_transaction')
            group by 1 order by 1`);
        eq(r.rows.map((x) => x.c), [1, 1, 1, 1]);
        const p = await dst.query(`select count(*)::int c from pg_proc where pronamespace = 'progress'::regnamespace and proname = 'verify_role_session'`);
        eq(p.rows[0].c, 1);
    });
    await check('old Materials login sessions keep working', async () => {
        eq((await anon(dst, "select count(*) c from materials.get_worker_transactions('native-mat-w1')")).rows[0].c * 1, 2);
    });
    await check('change password stores it encrypted', async () => {
        const tok = (await anon(dst, "select token from materials.verify_requester_login('1018', 'mpw18')")).rows[0].token;
        eq((await anon(dst, 'select materials.worker_change_password($1, $2, $3) ok', [tok, 'mpw18', 'new18'])).rows[0].ok, true);
        eq((await anon(dst, "select requester_id from materials.verify_requester_login('1018', 'new18')")).rows[0].requester_id, '1018');
    });
    await check('delete a pending request with the Attendance password (one login)', async () => {
        const id = (await dst.query("select id from materials.transactions where worker_id = 'W1' and approval_status = 'pending'")).rows[0].id;
        eq((await anon(dst, 'select materials.worker_delete_pending_transaction($1, $2, $3) ok', [id, 'W1', 'pw1'])).rows[0].ok, true);
        await throws(anon(dst, 'select materials.worker_delete_pending_transaction($1, $2, $3)', [id, 'W1', 'nope']), /Invalid worker/);
    });
    await check('signed-in non-staff can still create requests like anon could', async () => {
        await authed(dst, UID.attAdmin, "insert into materials.transactions (worker_id, approval_status) values ('W1', 'pending')");
    });

    console.log('\n=== One worker login (Attendance session opens every allowed area) ===');
    await check('starting access: existing Materials / Site photos users get both, others Attendance only', async () => {
        const r = await dst.query('select employee_id, worker_type, materials, progress from core.worker_access order by 1');
        eq(r.rows, [
            { employee_id: '1018', worker_type: 'foreign', materials: true, progress: true },
            { employee_id: '1018r', worker_type: 'local', materials: false, progress: false },
            { employee_id: 'L1', worker_type: 'local', materials: false, progress: false },
            { employee_id: 'W1', worker_type: 'foreign', materials: true, progress: true },
            { employee_id: 'W3', worker_type: 'foreign', materials: false, progress: false },
        ]);
    });
    await check('my_access for a hub session', async () => {
        eq((await anon(dst, 'select core.my_access($1) a', [TOKEN.w1])).rows[0].a, {
            employee_id: 'W1', worker_type: 'foreign', attendance: true, materials: true, progress: true,
        });
        eq((await anon(dst, 'select core.my_access($1) a', [TOKEN.expired])).rows[0].a, null);
        eq((await anon(dst, "select core.my_access('not-a-token') a")).rows[0].a, null);
    });
    await check('Site photos with the hub session (existing worker row reused)', async () => {
        const r = await anon(dst, 'select count(*) c from progress.worker_list_packages($1)', [TOKEN.w1]);
        eq(n(r.rows[0].c), 3);
        eq(n((await dst.query("select count(*) c from progress.app_users where employee_code = 'W1'")).rows[0].c), 1);
    });
    await check('Materials with the hub session', async () => {
        eq(n((await anon(dst, 'select count(*) c from materials.get_worker_transactions($1)', [TOKEN.w1])).rows[0].c), 2);
    });
    await check('no access → Materials / Site photos refuse the hub session', async () => {
        await throws(anon(dst, 'select * from progress.worker_list_packages($1)', [TOKEN.w3]), /Not authenticated/);
        await throws(anon(dst, 'select * from materials.get_worker_transactions($1)', [TOKEN.w3]), /Session expired/);
    });
    await check('old Site photos sessions keep working', async () => {
        eq(n((await anon(dst, "select count(*) c from progress.worker_list_packages('native-pro-w1')")).rows[0].c), 3);
    });

    console.log('\n=== Admin (hub) ===');
    await check('workers / anon cannot use the admin functions or core tables', async () => {
        await throws(anon(dst, 'select * from core.admin_list_workers()'), /permission denied/);
        await throws(anon(dst, 'select * from core.worker_access'), /permission denied/);
        await throws(authed(dst, UID.matStaff2, 'select * from core.admin_list_workers()'), /Admin access required/);
    });
    await check('is_hub_admin: Attendance admin, Site Progress admin, Materials admin', async () => {
        eq((await authed(dst, UID.attAdmin, 'select core.is_hub_admin() a')).rows[0].a, true);
        eq((await authed(dst, UID.proStaff1, 'select core.is_hub_admin() a')).rows[0].a, true);
        eq((await authed(dst, UID.matStaff2, 'select core.is_hub_admin() a')).rows[0].a, false);
    });
    await check('worker list and details (no password / face data), roles, access, activity', async () => {
        eq(n((await authed(dst, UID.attAdmin, 'select count(*) c from core.admin_list_workers()')).rows[0].c), 5);
        const w = (await authed(dst, UID.attAdmin, "select core.admin_get_worker('W1') w")).rows[0].w;
        eq([w.profile.password_hash, w.profile.face_embedding, w.profile.employee_name], [undefined, undefined, 'Ali']);
        eq(w.access.materials && w.access.progress, true);
        eq([w.activity.shifts, w.activity.material_requests, w.activity.photo_packages], [2, 2, 3]);
    });
    await check('turning on access opens Materials and Site photos for that worker', async () => {
        await authed(dst, UID.attAdmin, "select core.admin_set_worker_access('W3', true, true)");
        eq(n((await anon(dst, 'select count(*) c from progress.worker_list_packages($1)', [TOKEN.w3])).rows[0].c), 0);
        eq(n((await anon(dst, 'select count(*) c from materials.get_worker_transactions($1)', [TOKEN.w3])).rows[0].c), 0);
        const by = (await dst.query("select updated_by from core.worker_access where employee_id = 'W3'")).rows[0].updated_by;
        truthy(by, 'updated_by recorded');
    });
    await check('turning access off closes Site photos again', async () => {
        await authed(dst, UID.attAdmin, "select core.admin_set_worker_access('W3', true, false)");
        await throws(anon(dst, 'select * from progress.worker_list_packages($1)', [TOKEN.w3]), /Not authenticated/);
        eq((await anon(dst, 'select core.my_access($1) a', [TOKEN.w3])).rows[0].a.progress, false);
    });
    await check('local worker can be given access too (1018 and 1018r stay separate)', async () => {
        await authed(dst, UID.attAdmin, "select core.admin_set_worker_access('L1', true, false)");
        eq((await anon(dst, 'select core.my_access($1) a', [TOKEN.l1])).rows[0].a.materials, true);
        eq(n((await dst.query("select count(*) c from core.worker_access where employee_id in ('1018', '1018r')")).rows[0].c), 2);
    });
    await check('places: near-identical sites are one place with every area\'s data', async () => {
        const r = (await authed(dst, UID.attAdmin, 'select * from core.admin_list_sites()')).rows;
        const kb = r.find((x) => x.name === 'Kaki Bukit Office');
        eq([n(kb.shifts), n(kb.material_requests), n(kb.photo_packages), n(kb.jsrs)], [2, 1, 2, 1]);
        eq(r.length, 4 /* Kaki Bukit, Tampines, Woodlands, Jurong */ + 0, 'places');
        truthy(warnings.some((w) => /No such site/.test(w)), 'missing merge target reported');
        truthy(warnings.some((w) => /X9/.test(w)), 'login without Attendance worker reported');
        eq(summary.merged, 1, 'linked places');
    });
    await check('staff list (separate from workers: supervisor 1018 ≠ worker 1018)', async () => {
        const s = (await authed(dst, UID.attAdmin, 'select core.admin_list_staff() s')).rows[0].s;
        truthy(s.find((x) => x.login === '1018' && x.roles.some((r) => r.role === 'supervisor')), 'supervisor 1018 listed');
        truthy(s.find((x) => x.login === 'staff1@akk.test' && x.roles.length >= 2), 'staff1 roles across areas');
    });

    console.log('\n=== Files (storage) ===');
    await check('buckets created, each area\'s rules limited to its own buckets', async () => {
        eq((await dst.query('select id from storage.buckets order by 1')).rows.map((r) => r.id), ['leave-attachments', 'material-photos', 'package-images']);
        await dst.query(`insert into storage.objects (bucket_id, name) values ('leave-attachments', 'a.pdf'), ('package-images', 'p.jpg'), ('material-photos', 'm.jpg')`);
        // Attendance's "authenticated may read" rule: only Attendance admins, only Attendance files.
        eq((await authed(dst, UID.attAdmin, 'select bucket_id from storage.objects order by 1')).rows.map((r) => r.bucket_id), ['leave-attachments', 'package-images']);
        eq((await authed(dst, UID.matStaff2, 'select bucket_id from storage.objects order by 1')).rows.map((r) => r.bucket_id), ['package-images']);
        await anon(dst, "insert into storage.objects (bucket_id, name) values ('material-photos', 'x.jpg')");
        await throws(anon(dst, "insert into storage.objects (bucket_id, name) values ('leave-attachments', 'x.pdf')"), /row-level security/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
    console.error(`\n✗ ${e.stack || e.message}`);
    process.exitCode = 1;
});
