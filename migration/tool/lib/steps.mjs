/**
 * The database work of each migration step, written against a plain `query(sql, params)` client so the
 * same code runs on the real new project (pg) and in the offline self-test (PGlite).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATION_DIR } from './env.mjs';
import { q } from './db.mjs';
import { buildSchemaStatements, buildStoragePolicyStatements, bucketCollisions } from './ddl.mjs';

export const SOURCE_KEYS = ['attendance', 'materials', 'progress'];
export const TARGET_SCHEMA = { attendance: 'attendance', materials: 'materials', progress: 'progress' };
export const SCHEMA_OPTS = {
    attendance: { adminGate: 'attendance.is_admin_jwt' },
    materials: { anonAlsoAuthenticated: true },
    progress: {},
};
export const MANAGED_SCHEMAS = ['core', 'attendance', 'materials', 'progress'];

export const readSqlFile = (name) => fs.readFileSync(path.join(MIGRATION_DIR, 'sql', name), 'utf8');

export function statementsFor(srcKey, snap) {
    const target = TARGET_SCHEMA[srcKey];
    return {
        target,
        schemaStatements: buildSchemaStatements(snap.schema, target, SCHEMA_OPTS[srcKey]),
        storageStatements: buildStoragePolicyStatements(snap.storage, srcKey, target, SCHEMA_OPTS[srcKey]),
    };
}

async function runStatements(c, statements, title) {
    let i = 0;
    for (const s of statements) {
        i += 1;
        try {
            await c.query(s.sql);
        } catch (e) {
            const head = s.sql.split('\n').slice(0, 3).join(' ').slice(0, 300);
            throw new Error(`${title}: statement ${i}/${statements.length} (${s.label}) failed: ${e.message}\n    ${head}`);
        }
    }
}

async function inTransaction(c, fn) {
    await c.query('BEGIN');
    try {
        const out = await fn();
        await c.query('COMMIT');
        return out;
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
    }
}

/** Create schemas attendance / materials / progress / core. `snaps` = { key: snapshot }. */
export async function applyStructure(c, snaps, { prereqSql = readSqlFile('00_prereq.sql'), onStep = () => {}, live = false } = {}) {
    const clash = bucketCollisions(Object.fromEntries(SOURCE_KEYS.map((k) => [k, snaps[k].storage])));
    if (clash.length) throw new Error(`The same storage bucket name exists in more than one project: ${clash.join(', ')}. Decide how to merge them first.`);
    await c.query(prereqSql);
    onStep('prerequisites (extensions, core schema)');

    for (const key of SOURCE_KEYS) {
        const snap = snaps[key];
        const { target, schemaStatements, storageStatements } = statementsFor(key, snap);
        await inTransaction(c, async () => {
            await c.query('SET LOCAL check_function_bodies = off');
            await runStatements(c, schemaStatements, key);
            for (const b of snap.storage.buckets) {
                await c.query(
                    `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
                     values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
                    [b.id, b.name, b.public, b.file_size_limit == null ? null : String(b.file_size_limit), b.allowed_mime_types]
                );
            }
            await runStatements(c, storageStatements, `${key} storage policies`);
        });
        onStep(`${key} → schema ${target} (${schemaStatements.length} statements, ${snap.storage.buckets.length} buckets)`);
    }

    // `live` = the real project: also the later, idempotent migrations added after the first copy
    // (Camera registry, supervisor push tokens, photo overlay, local-worker table lock-down).
    const files = [
        '20_core.sql', '30_unify.sql', '50_sites.sql', '60_people.sql',
        ...(live ? ['60_overlay_opacity.sql', '61_akk_camera.sql', '62_device_push_supervisor.sql', '63_local_worker_details_rls.sql'] : []),
        '64_local_access.sql', '70_deployment.sql', '80_worker_info.sql', '82_worker_info_more.sql', '83_worker_info_trim.sql', '84_worker_info_master.sql', '85_worker_info_dob.sql', '85_worker_info_edit_master.sql', '87_worker_info_age.sql', '88_worker_info_check_all.sql', '90_worker_info_safety_cert_labels.sql',
        ...(live ? ['81_worker_info_import.sql', '86_worker_info_dob_import.sql', '89_progress_manager_no_jsr_audit.sql', '91_cards.sql', '92_card_multi_links.sql', '93_cards_issue.sql', '94_cards_drop_wallet.sql', '95_card_report_lost.sql', '96_card_physical_issued.sql', '97_deployment_night_shifts.sql'] : []),
    ];
    for (const file of files) {
        await inTransaction(c, () => c.query(readSqlFile(file))).catch((e) => {
            throw new Error(`${file}: ${e.message}`);
        });
        onStep(file);
    }
}

// ---------------------------------------------------------------------------------------------
// Supabase Auth accounts (staff / admins). Same e-mail in several projects → one account.
// Kept id: Site Progress, then Materials, then Attendance (fewest references to rewrite).
// Password + confirmation: Attendance first (it's the master), then Materials, then Site Progress.
const ID_PRIORITY = ['progress', 'materials', 'attendance'];
const PASSWORD_PRIORITY = ['attendance', 'materials', 'progress'];
const BLANK_TOKEN_COLUMNS = [
    'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
    'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token',
];

/** bySource = { key: { users: [auth.users row as json], identities: [...] } } */
export function planAuth(bySource) {
    const people = new Map();
    const noEmail = [];
    for (const key of SOURCE_KEYS) {
        for (const u of bySource[key]?.users || []) {
            const email = String(u.email || '').trim().toLowerCase();
            if (!email) {
                noEmail.push(`${key}:${u.id}`);
                continue;
            }
            if (!people.has(email)) people.set(email, {});
            people.get(email)[key] = u;
        }
    }
    const uidMap = { attendance: {}, materials: {}, progress: {} };
    const attendanceAdmins = new Set();
    const accounts = [];
    for (const [email, perSource] of people) {
        const winner = ID_PRIORITY.find((k) => perSource[k]);
        const keep = perSource[winner];
        const pw = perSource[PASSWORD_PRIORITY.find((k) => perSource[k]?.encrypted_password)] || keep;
        for (const [k, u] of Object.entries(perSource)) uidMap[k][u.id] = keep.id;
        if (perSource.attendance) attendanceAdmins.add(keep.id);
        accounts.push({
            email,
            winner,
            sources: Object.keys(perSource),
            user: {
                ...keep,
                encrypted_password: pw.encrypted_password ?? keep.encrypted_password,
                email_confirmed_at: pw.email_confirmed_at || keep.email_confirmed_at,
            },
            identities: (bySource[winner].identities || []).filter((i) => i.user_id === keep.id),
        });
    }
    return { accounts, uidMap, attendanceAdmins: [...attendanceAdmins], noEmail };
}

/** Insert the planned accounts into auth.users / auth.identities. Returns ids newly created. */
export async function writeAuth(c, plan) {
    const columns = async (table) =>
        (await c.query(
            `select column_name from information_schema.columns
              where table_schema = 'auth' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position`,
            [table]
        )).rows.map((r) => r.column_name);
    const userCols = await columns('users');
    const identityCols = await columns('identities');
    const existing = new Map((await c.query('select id::text id, lower(email) email from auth.users')).rows.map((r) => [r.email, r.id]));

    const imported = [];
    for (const a of plan.accounts) {
        const have = existing.get(a.email);
        if (have && have !== a.user.id) {
            throw new Error(
                `The new project already has a different sign-in account for one of the staff e-mails (id ${have}). ` +
                    'Delete that account in the new project (Authentication → Users) and run again.'
            );
        }
        if (have) continue; // copied on an earlier run

        const row = { ...a.user };
        for (const k of BLANK_TOKEN_COLUMNS) if (userCols.includes(k) && row[k] == null) row[k] = '';
        const cols = userCols.filter((k) => k in row);
        const list = cols.map(q).join(', ');
        await c.query(`insert into auth.users (${list}) select ${list} from jsonb_populate_record(null::auth.users, $1::jsonb)`, [
            JSON.stringify(row),
        ]);

        const identities = a.identities.length ? a.identities : [{}];
        for (const base of identities) {
            const ident = {
                ...base,
                user_id: a.user.id,
                provider: base.provider || 'email',
                provider_id: base.provider_id || base.identity_data?.sub || a.user.id,
                identity_data: base.identity_data || { sub: a.user.id, email: a.user.email, email_verified: true, phone_verified: false },
                created_at: base.created_at || a.user.created_at,
                updated_at: base.updated_at || a.user.updated_at,
            };
            if (!/^[0-9a-f-]{36}$/i.test(String(ident.id || ''))) delete ident.id;
            const cols2 = identityCols.filter((k) => k in ident);
            const list2 = cols2.map(q).join(', ');
            await c.query(
                `insert into auth.identities (${list2}) select ${list2} from jsonb_populate_record(null::auth.identities, $1::jsonb)`,
                [JSON.stringify(ident)]
            );
        }
        imported.push(a.user.id);
    }
    return imported;
}

// ---------------------------------------------------------------------------------------------
/** Columns that hold a sign-in account id: FKs to auth.users, FKs to those, and `default auth.uid()`. */
export function authIdColumns(schemaSnap) {
    const fks = schemaSnap.constraints.filter((k) => k.type === 'f');
    const parse = (def) => {
        const m = /^FOREIGN KEY \(([^)]+)\) REFERENCES ([A-Za-z0-9_."]+)\(([^)]+)\)/.exec(def);
        if (!m) return null;
        const cols = m[1].split(',').map((s) => s.trim().replace(/"/g, ''));
        const refCols = m[3].split(',').map((s) => s.trim().replace(/"/g, ''));
        return { cols, ref: m[2].replace(/"/g, ''), refCols };
    };
    const found = new Set();
    for (const k of fks) {
        const p = parse(k.def);
        if (p && p.ref === 'auth.users' && p.cols.length === 1) found.add(`${k.table}.${p.cols[0]}`);
    }
    for (let changed = true; changed; ) {
        changed = false;
        for (const k of fks) {
            const p = parse(k.def);
            if (!p || p.cols.length !== 1 || !p.ref.startsWith('public.')) continue;
            const refKey = `${p.ref.slice('public.'.length)}.${p.refCols[0]}`;
            const key = `${k.table}.${p.cols[0]}`;
            if (found.has(refKey) && !found.has(key)) {
                found.add(key);
                changed = true;
            }
        }
    }
    for (const t of schemaSnap.tables) {
        for (const col of t.columns) if (/auth\.uid\(\)/.test(col.default || '') && /uuid/.test(col.type)) found.add(`${t.name}.${col.name}`);
    }
    return [...found].map((s) => s.split('.'));
}

/**
 * Finish: sequences, account links, admins, password hashing, worker access, places, push pause,
 * realtime. ctx = { snaps, authMap, merges, liveSequence(srcKey, seqName) → last_value text, onStep }
 */
export async function finishOn(c, ctx) {
    const { snaps, authMap, merges } = ctx;
    const onStep = ctx.onStep || (() => {});
    const warnings = [];
    let summary;

    await inTransaction(c, async () => {
        // 1. Sequences continue where the old projects stopped (numbers like PKG-0703 keep going).
        for (const key of SOURCE_KEYS) {
            for (const sq of snaps[key].schema.sequences) {
                const live = (await ctx.liveSequence(key, sq.name)) ?? sq.last_value;
                if (live == null) continue;
                // Identity columns get their sequence re-created under the target table — find it by column.
                let seq = `${TARGET_SCHEMA[key]}.${q(sq.name)}`;
                if (sq.owned_by) {
                    const [tbl, col] = sq.owned_by.split('.');
                    const r = await c.query('select pg_get_serial_sequence($1, $2) s', [`${TARGET_SCHEMA[key]}.${q(tbl)}`, col]);
                    if (r.rows[0]?.s) seq = r.rows[0].s;
                }
                await c.query('select setval($1::regclass, $2::bigint, true)', [seq, String(live)]);
            }
        }
        onStep('sequences');

        // 2. Account ids that changed because one person had accounts in several projects.
        //    FK checks are deferred to the end of the transaction where possible; parents first.
        let changed = 0;
        for (const key of SOURCE_KEYS) {
            const pairs = Object.entries(authMap.uidMap[key] || {}).filter(([a, b]) => a !== b);
            if (!pairs.length) continue;
            const cols = authIdColumns(snaps[key].schema);
            const ids = JSON.stringify(Object.fromEntries(pairs));
            // Parent and child keys change together (e.g. staff_profiles.user_id + staff_activity.actor_id),
            // so key checks are paused for these updates only.
            await c.query('SET LOCAL session_replication_role = replica');
            for (const [table, col] of cols) {
                const r = await c.query(
                    `update ${TARGET_SCHEMA[key]}.${q(table)} set ${q(col)} = ($1::jsonb ->> ${q(col)}::text)::uuid
                      where $1::jsonb ? ${q(col)}::text`,
                    [ids]
                );
                changed += r.affectedRows ?? r.rowCount ?? 0;
            }
            await c.query('SET LOCAL session_replication_role = origin');
        }
        onStep(`account links (${changed} rows re-pointed)`);

        // 3. Attendance admins = the people who signed in to Attendance with Supabase Auth.
        for (const id of authMap.attendanceAdmins) {
            await c.query('insert into core.attendance_admins (user_id) values ($1) on conflict do nothing', [id]);
        }
        onStep(`Attendance admins: ${authMap.attendanceAdmins.length}`);

        // 4. Materials passwords were plain text → bcrypt (the same passwords keep working).
        const hashed = await c.query(
            `update materials.requesters set password_hash = extensions.crypt(password_hash, extensions.gen_salt('bf'))
              where password_hash is not null and password_hash <> '' and password_hash not like '$2%'`
        );
        onStep(`Materials passwords hashed: ${hashed.affectedRows ?? hashed.rowCount}`);

        // 5. Worker access: everyone from Attendance; Materials / Site photos on for those who already used them.
        await c.query(`
            insert into core.worker_access (employee_id, worker_type, materials, progress, updated_by)
            select w.eid, w.wtype,
                   exists (select 1 from materials.requesters r where r.requester_id = w.eid),
                   exists (select 1 from progress.app_users u where u.employee_code = w.eid and u.is_active),
                   'migration'
              from (select distinct on (eid) eid, wtype from (
                        select trim(employee_id::text) eid, 'foreign'::text wtype, 1 pri from attendance.worker_details
                        union all
                        select trim(employee_id::text), 'local'::text, 2 from attendance.local_worker_details) x
                     order by eid, pri) w
            on conflict (employee_id) do nothing`);
        const counts = (await c.query(
            'select count(*)::int n, (count(*) filter (where materials))::int m, (count(*) filter (where progress))::int p from core.worker_access'
        )).rows[0];
        const orphanRequesters = (await c.query(
            `select r.requester_id from materials.requesters r
              where not exists (select 1 from core.worker_access a where a.employee_id = r.requester_id)
             union
             select u.employee_code from progress.app_users u
              where not exists (select 1 from core.worker_access a where a.employee_id = u.employee_code)`
        )).rows.map((r) => r.requester_id);
        if (orphanRequesters.length) {
            warnings.push(
                `${orphanRequesters.length} Materials/Site photos login(s) have no Attendance worker (${orphanRequesters.join(', ')}) — ` +
                    'their own login still works; add them in Attendance to use the one login.'
            );
        }
        onStep(`worker access: ${counts.n} workers (${counts.m} Materials, ${counts.p} Site photos)`);

        // 6. Places: one per real site; merged ones link that place's rows in every area.
        const att = (await c.query('select id::text id, site_name name from attendance.sites')).rows;
        const mat = (await c.query('select id::text id, name from materials.sites')).rows;
        const pro = (await c.query('select id::text id, name from progress.sites')).rows;
        const used = { attendance: new Set(), materials: new Set(), progress: new Set() };
        const norm = (s) => String(s || '').trim().toLowerCase();
        const find = (list, name) => list.find((r) => norm(r.name) === norm(name));
        const places = [];
        for (const m of merges) {
            const a = m.attendance && find(att, m.attendance);
            const ma = m.materials && find(mat, m.materials);
            const p = m.progress && find(pro, m.progress);
            for (const [area, want, got] of [['attendance', m.attendance, a], ['materials', m.materials, ma], ['progress', m.progress, p]]) {
                if (want && !got) warnings.push(`place "${m.name}": no ${area} site named "${want}" — that link was skipped`);
            }
            if (a) used.attendance.add(a.id);
            if (ma) used.materials.add(ma.id);
            if (p) used.progress.add(p.id);
            if (a || ma || p) places.push({ name: m.name, attendance: a?.id ?? null, materials: ma?.id ?? null, progress: p?.id ?? null });
        }
        for (const r of att) if (!used.attendance.has(r.id)) places.push({ name: r.name, attendance: r.id, materials: null, progress: null });
        for (const r of mat) if (!used.materials.has(r.id)) places.push({ name: r.name, attendance: null, materials: r.id, progress: null });
        for (const r of pro) if (!used.progress.has(r.id)) places.push({ name: r.name, attendance: null, materials: null, progress: r.id });
        for (const pl of places) {
            await c.query(
                `insert into core.sites (name, attendance_site_id, materials_site_id, progress_site_id)
                 values ($1, $2, $3::uuid, $4::uuid) on conflict do nothing`,
                [pl.name, pl.attendance, pl.materials, pl.progress]
            );
        }
        const merged = places.filter((p) => [p.attendance, p.materials, p.progress].filter(Boolean).length > 1).length;
        onStep(`places: ${places.length} (${merged} linked across areas)`);

        // 6b. One employee record: the Attendance name is the name everywhere (old names logged).
        await c.query(`insert into core.migration_log (step, detail)
            select 'names-before-unify', coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'materials_name', x.mn, 'site_work_name', x.pn)), '[]')
              from (select r.requester_id id, r.name mn, u.display_name pn
                      from materials.requesters r left join progress.app_users u on u.employee_code = r.requester_id
                    union
                    select u.employee_code, r.name, u.display_name
                      from progress.app_users u left join materials.requesters r on r.requester_id = u.employee_code) x`);
        const workerNames = `(select employee_id::text id, employee_name::text n from attendance.worker_details
                              union all select employee_id::text, employee_name::text from attendance.local_worker_details)`;
        const rn1 = await c.query(`update materials.requesters r set name = trim(w.n) from ${workerNames} w
             where w.id = r.requester_id and nullif(trim(w.n), '') is not null and r.name is distinct from trim(w.n)`);
        const rn2 = await c.query(`update progress.app_users u set display_name = trim(w.n) from ${workerNames} w
             where w.id = u.employee_code and nullif(trim(w.n), '') is not null and u.display_name is distinct from trim(w.n)`);
        onStep(`employee names unified (${rn1.affectedRows ?? rn1.rowCount} Materials, ${rn2.affectedRows ?? rn2.rowCount} Site work)`);

        // 7. No real push notifications from the new project before the switch-over.
        const push = await c.query('update progress.push_delivery_config set webhook_url = null where webhook_url is not null');
        onStep(`Site Progress push paused until switch-over (${push.affectedRows ?? push.rowCount})`);

        // 8. Live updates (Realtime) for the same tables as before.
        const pub = await c.query("select 1 from pg_publication where pubname = 'supabase_realtime'");
        if (pub.rows.length) {
            for (const key of SOURCE_KEYS) {
                for (const t of snaps[key].schema.realtime) {
                    const exists = await c.query(
                        "select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = $1 and tablename = $2",
                        [TARGET_SCHEMA[key], t]
                    );
                    if (!exists.rows.length) await c.query(`alter publication supabase_realtime add table ${TARGET_SCHEMA[key]}.${q(t)}`);
                }
            }
            onStep('realtime tables');
        } else {
            warnings.push('no supabase_realtime publication in the new project — turn Realtime on for the same tables later');
        }

        summary = { places: places.length, merged, workers: counts.n, materials: counts.m, progress: counts.p };
        await c.query(`insert into core.migration_log (step, detail) values ('finish', $1::jsonb)`, [JSON.stringify(summary)]);
    });
    return { summary, warnings };
}
