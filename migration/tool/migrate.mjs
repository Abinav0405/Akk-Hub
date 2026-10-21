#!/usr/bin/env node
/**
 * AKK Hub — move Attendance, Materials and Site Progress into the one new Supabase project.
 *
 *   node migrate.mjs check      connect to all four databases (old ones read-only), print sizes
 *   node migrate.mjs snapshot   read each old project's structure + row counts  → out/snapshot-*.json
 *   node migrate.mjs build      turn the snapshots into SQL                     → out/sql/*.sql (review)
 *   node migrate.mjs apply      create schemas attendance / materials / progress / core in the NEW project
 *   node migrate.mjs auth       copy staff/admin sign-in accounts (Supabase Auth) into the NEW project
 *   node migrate.mjs copy       copy every row of every table (old → new)
 *   node migrate.mjs finish     sequences, admin list, worker access, merged sites, password hashing…
 *   node migrate.mjs verify     row counts old vs new, sign-in links, access + sites summary
 *   node migrate.mjs all        check → snapshot → build → apply → auth → copy → finish → verify
 *   node migrate.mjs storage    copy photo / file buckets (needs the service keys; resumable)
 *   node migrate.mjs reset --confirm-reset-new-project   wipe what this tool created in the NEW project
 *
 * Old projects: connections are forced read-only by the server. Nothing there is changed or deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import { MIGRATION_DIR, OUT_DIR, SOURCES, NEW_REF, env, need } from './lib/env.mjs';
import { openSource, openTarget, q } from './lib/db.mjs';
import { readSchema, readStorage } from './lib/catalog.mjs';
import { toSqlFile } from './lib/ddl.mjs';
import {
    TARGET_SCHEMA, MANAGED_SCHEMAS, statementsFor as buildFor, applyStructure, planAuth, writeAuth, finishOn,
} from './lib/steps.mjs';

const log = (...a) => console.log(...a);
const step = (title) => console.log(`\n=== ${title} ===`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);
const fmt = (n) => Number(n).toLocaleString('en-SG');

function ensureOut() {
    fs.mkdirSync(path.join(OUT_DIR, 'sql'), { recursive: true });
}
const outFile = (name) => path.join(OUT_DIR, name);
const readJson = (name) => {
    const f = outFile(name);
    if (!fs.existsSync(f)) throw new Error(`${name} not found — run the earlier step first.`);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
};
const writeJson = (name, data) => {
    ensureOut();
    fs.writeFileSync(outFile(name), JSON.stringify(data, null, 2));
};

async function withSource(src, fn) {
    const c = await openSource(src);
    try {
        return await fn(c);
    } finally {
        await c.end();
    }
}
async function withTarget(fn) {
    const c = await openTarget();
    try {
        return await fn(c);
    } finally {
        await c.end();
    }
}

// ---------------------------------------------------------------------------------------------
async function check() {
    step('Check connections');
    env();
    const failures = [];
    for (const src of SOURCES) {
        await withSource(src, async (c) => {
            const { rows } = await c.query(
                "select current_setting('server_version') v, pg_size_pretty(pg_database_size(current_database())) s, current_setting('default_transaction_read_only') ro"
            );
            ok(`${src.label}: Postgres ${rows[0].v}, ${rows[0].s}, read-only=${rows[0].ro}`);
        }).catch((e) => {
            failures.push(e.message);
            warn(e.message);
        });
    }
    await withTarget(async (c) => {
        const { rows } = await c.query("select current_setting('server_version') v, pg_size_pretty(pg_database_size(current_database())) s");
        const existing = await c.query(
            `select table_schema, count(*)::int n from information_schema.tables where table_schema = any($1) group by 1`,
            [MANAGED_SCHEMAS]
        );
        ok(`NEW project (${NEW_REF}): Postgres ${rows[0].v}, ${rows[0].s}`);
        if (existing.rows.length) warn(`already has: ${existing.rows.map((r) => `${r.table_schema} (${r.n} tables)`).join(', ')}`);
        const sr = await c.query("select setting from pg_settings where name = 'session_replication_role'");
        ok(`session_replication_role readable (${sr.rows[0]?.setting ?? '?'})`);
    }).catch((e) => {
        failures.push(e.message);
        warn(e.message);
    });
    if (failures.length) {
        throw new Error(
            `${failures.length} connection(s) failed. "password authentication failed" = wrong database password in that line ` +
                '(Dashboard → Project Settings → Database → Reset database password, then paste the new one in place of [YOUR-PASSWORD]).'
        );
    }
}

async function snapshot() {
    step('Snapshot the old projects (read-only)');
    for (const src of SOURCES) {
        await withSource(src, async (c) => {
            const schema = await readSchema(c, 'public');
            const storage = await readStorage(c);
            writeJson(`snapshot-${src.key}.json`, { source: src.key, takenAt: new Date().toISOString(), schema, storage });
            const rows = Object.values(schema.counts).reduce((a, b) => a + b, 0);
            ok(
                `${src.label}: ${schema.tables.length} tables, ${schema.functions.length} functions, ${schema.policies.length} policies, ` +
                    `${fmt(rows)} rows, ${storage.buckets.length} buckets`
            );
            for (const s of schema.skipped) warn(`left out: ${s}`);
        });
    }
}

const loadSnaps = () => Object.fromEntries(SOURCES.map((s) => [s.key, readJson(`snapshot-${s.key}.json`)]));
const statementsFor = (srcKey) => buildFor(srcKey, readJson(`snapshot-${srcKey}.json`));

async function build() {
    step('Build SQL');
    ensureOut();
    for (const src of SOURCES) {
        const { target, schemaStatements, storageStatements } = statementsFor(src.key);
        fs.writeFileSync(outFile(`sql/${target}.sql`), toSqlFile([...schemaStatements, ...storageStatements], `${src.label} → schema ${target}`));
        ok(`${src.label}: ${schemaStatements.length} statements → out/sql/${target}.sql`);
    }
}

async function apply() {
    step('Create the new structure');
    const snaps = loadSnaps();
    await withTarget(async (c) => {
        const existing = await c.query(
            `select count(*)::int n from information_schema.tables where table_schema = any($1)`,
            [MANAGED_SCHEMAS]
        );
        if (existing.rows[0].n > 0) {
            throw new Error('The new project already has the migrated schemas. Run "reset --confirm-reset-new-project" first to rebuild.');
        }
        await applyStructure(c, snaps, { onStep: ok });
    });
}

// ---------------------------------------------------------------------------------------------
async function auth() {
    step('Copy staff / admin sign-in accounts');
    const bySource = {};
    for (const src of SOURCES) {
        bySource[src.key] = await withSource(src, async (c) => {
            const users = await c.query('select to_jsonb(u) as u from auth.users u');
            const identities = await c.query('select to_jsonb(i) as i from auth.identities i');
            return { users: users.rows.map((r) => r.u), identities: identities.rows.map((r) => r.i) };
        });
    }
    const plan = planAuth(bySource);
    for (const id of plan.noEmail) warn(`an account without an e-mail was left out (${id})`);
    const imported = await withTarget((c) => writeAuth(c, plan));
    writeJson('auth-map.json', { uidMap: plan.uidMap, attendanceAdmins: plan.attendanceAdmins, imported });
    const shared = plan.accounts.filter((a) => a.sources.length > 1).length;
    ok(`${plan.accounts.length} staff/admin accounts (${imported.length} newly created, ${shared} used in more than one area → one account)`);
}


// ---------------------------------------------------------------------------------------------
function fkOrder(schemaSnap) {
    const names = schemaSnap.tables.map((t) => t.name);
    const deps = new Map(names.map((n) => [n, new Set()]));
    for (const k of schemaSnap.constraints.filter((x) => x.type === 'f')) {
        const m = /REFERENCES public\.("?)([A-Za-z0-9_]+)\1/.exec(k.def);
        if (m && m[2] !== k.table && deps.has(m[2])) deps.get(k.table).add(m[2]);
    }
    const out = [];
    const seen = new Set();
    const visit = (n, stack = new Set()) => {
        if (seen.has(n)) return;
        if (stack.has(n)) return; // cycle: rely on disabled triggers
        stack.add(n);
        for (const d of deps.get(n) || []) visit(d, stack);
        seen.add(n);
        out.push(n);
    };
    names.forEach((n) => visit(n));
    return out;
}

async function copy() {
    step('Copy every row (old → new)');
    const force = process.argv.includes('--force');
    for (const src of SOURCES) {
        const { schema } = readJson(`snapshot-${src.key}.json`);
        const target = TARGET_SCHEMA[src.key];
        const order = fkOrder(schema);
        const byName = new Map(schema.tables.map((t) => [t.name, t]));
        const s = await openSource(src);
        const d = await openTarget();
        let replica = true;
        try {
            let total = 0;
            for (const name of order) {
                const t = byName.get(name);
                const cols = t.columns.filter((c) => c.generated !== 's').map((c) => q(c.name)).join(', ');
                const already = Number((await d.query(`select count(*) n from ${q(target)}.${q(name)}`)).rows[0].n);
                if (already > 0 && !force) {
                    log(`  · ${target}.${name}: already has ${fmt(already)} rows — skipped (use --force after a reset)`);
                    continue;
                }
                await d.query('BEGIN');
                try {
                    if (replica) {
                        try {
                            await d.query('SET LOCAL session_replication_role = replica');
                        } catch {
                            replica = false;
                            await d.query('ROLLBACK');
                            await d.query('BEGIN');
                            warn('session_replication_role not allowed — copying in key order with table triggers switched off');
                        }
                    }
                    const rel = `${q(target)}.${q(name)}`;
                    if (!replica) await d.query(`ALTER TABLE ${rel} DISABLE TRIGGER USER`);
                    // COPY is refused on tables whose row security also binds the owner; lift it for the load only.
                    if (t.forceRls) await d.query(`ALTER TABLE ${rel} NO FORCE ROW LEVEL SECURITY`);
                    const reader = s.query(copyTo(`COPY (SELECT ${cols} FROM public.${q(name)}) TO STDOUT`));
                    const writer = d.query(copyFrom(`COPY ${rel} (${cols}) FROM STDIN`));
                    await pipeline(reader, writer);
                    if (t.forceRls) await d.query(`ALTER TABLE ${rel} FORCE ROW LEVEL SECURITY`);
                    if (!replica) await d.query(`ALTER TABLE ${rel} ENABLE TRIGGER USER`);
                    await d.query('COMMIT');
                } catch (e) {
                    await d.query('ROLLBACK').catch(() => {});
                    throw new Error(`${src.label} table ${name}: ${e.message}`);
                }
                const n = Number((await d.query(`select count(*) n from ${q(target)}.${q(name)}`)).rows[0].n);
                total += n;
                if (n !== schema.counts[name]) warn(`${target}.${name}: ${fmt(n)} rows copied, snapshot had ${fmt(schema.counts[name])} (rows added since the snapshot?)`);
            }
            ok(`${src.label}: ${fmt(total)} rows → schema ${target}`);
        } finally {
            await s.end();
            await d.end();
        }
    }
}

// ---------------------------------------------------------------------------------------------
async function finish() {
    step('Finish: sequences, accounts, access, places');
    const snaps = loadSnaps();
    const authMap = readJson('auth-map.json');
    const merges = JSON.parse(fs.readFileSync(path.join(MIGRATION_DIR, 'config', 'site-merges.json'), 'utf8')).places;

    // Live sequence values (rows may have been added after the snapshot).
    const live = {};
    for (const src of SOURCES) {
        live[src.key] = await withSource(src, async (s) => {
            const out = {};
            for (const sq of snaps[src.key].schema.sequences) {
                out[sq.name] = (await s.query(`select last_value::text v, is_called from public.${q(sq.name)}`)).rows[0];
            }
            return out;
        });
    }

    const { warnings } = await withTarget((c) =>
        finishOn(c, {
            snaps,
            authMap,
            merges,
            liveSequence: (key, name) => (live[key][name]?.is_called ? live[key][name].v : null),
            onStep: ok,
        })
    );
    for (const w of warnings) warn(w);
    log('\n  Next (one manual step): Supabase dashboard → Project Settings → Data API → Exposed schemas →');
    log('  add  core, attendance, materials, progress  → Save.');
}


// ---------------------------------------------------------------------------------------------
async function verify() {
    step('Verify old vs new');
    let problems = 0;
    await withTarget(async (c) => {
        for (const src of SOURCES) {
            const { schema } = readJson(`snapshot-${src.key}.json`);
            const target = TARGET_SCHEMA[src.key];
            const live = await withSource(src, async (s) => {
                const out = {};
                for (const t of schema.tables) out[t.name] = Number((await s.query(`select count(*) n from public.${q(t.name)}`)).rows[0].n);
                return out;
            });
            let mismatch = 0;
            for (const t of schema.tables) {
                const n = Number((await c.query(`select count(*) n from ${q(target)}.${q(t.name)}`)).rows[0].n);
                if (n < live[t.name] || n > live[t.name] + 50) {
                    // A few more rows in the new project are expected only from the one-login helpers.
                    mismatch += 1;
                    warn(`${target}.${t.name}: old ${fmt(live[t.name])}, new ${fmt(n)}`);
                }
            }
            if (mismatch) problems += mismatch;
            else ok(`${src.label}: all ${schema.tables.length} tables match`);
        }

        const orphans = await c.query(`
            select 'materials.staff_profiles' t, count(*)::int n from materials.staff_profiles x where not exists (select 1 from auth.users u where u.id = x.user_id)
            union all
            select 'progress.admin_profiles', count(*)::int from progress.admin_profiles x where not exists (select 1 from auth.users u where u.id = x.user_id)`);
        for (const r of orphans.rows) {
            if (r.n) {
                problems += 1;
                warn(`${r.t}: ${r.n} rows point to a sign-in account that doesn't exist`);
            }
        }
        if (!orphans.rows.some((r) => r.n)) ok('every staff profile has its sign-in account');

        const s = (await c.query(`
            select (select count(*)::int from core.worker_access) workers,
                   (select count(*)::int from core.worker_access where materials) materials,
                   (select count(*)::int from core.worker_access where progress) progress,
                   (select count(*)::int from core.sites) places,
                   (select count(*)::int from core.attendance_admins) admins`)).rows[0];
        ok(`workers ${s.workers} · Materials ${s.materials} · Site photos ${s.progress} · places ${s.places} · Attendance admins ${s.admins}`);
    });
    if (problems) {
        log(`\n  ${problems} problem(s) — see above.`);
        process.exitCode = 1;
    } else {
        log('\n  Everything matches.');
    }
}

// ---------------------------------------------------------------------------------------------
async function storage() {
    step('Copy photos and files (resumable)');
    const newUrl = need('NEW_URL').replace(/\/$/, '');
    const newKey = need('NEW_SERVICE_KEY');
    if (!newUrl.includes(NEW_REF)) throw new Error('NEW_URL must be the new AKK Hub project.');
    const concurrency = 6;

    for (const src of SOURCES) {
        const snap = readJson(`snapshot-${src.key}.json`);
        if (!snap.storage.buckets.length) continue;
        const srcUrl = need(src.urlEnv).replace(/\/$/, '');
        const srcKey = need(src.keyEnv);
        if (!srcUrl.includes(src.ref)) throw new Error(`${src.urlEnv} must be the ${src.label} project.`);

        for (const b of snap.storage.buckets) {
            const objects = await withSource(src, async (s) =>
                (await s.query(
                    `select name, coalesce(metadata->>'mimetype', 'application/octet-stream') mime
                       from storage.objects where bucket_id = $1 and name not like '%/.emptyFolderPlaceholder' order by name`,
                    [b.id]
                )).rows
            );
            const have = await withTarget(async (d) =>
                new Set((await d.query('select name from storage.objects where bucket_id = $1', [b.id])).rows.map((r) => r.name))
            );
            const todo = objects.filter((o) => !have.has(o.name));
            log(`  · ${b.id}: ${fmt(objects.length)} files, ${fmt(have.size)} already there, ${fmt(todo.length)} to copy`);

            let done = 0;
            let failed = 0;
            const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
            const work = async (o) => {
                for (let attempt = 1; attempt <= 3; attempt += 1) {
                    try {
                        const get = await fetch(`${srcUrl}/storage/v1/object/${b.id}/${enc(o.name)}`, {
                            headers: { Authorization: `Bearer ${srcKey}`, apikey: srcKey },
                        });
                        if (!get.ok) throw new Error(`download ${get.status}`);
                        const body = Buffer.from(await get.arrayBuffer());
                        const put = await fetch(`${newUrl}/storage/v1/object/${b.id}/${enc(o.name)}`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${newKey}`, apikey: newKey, 'Content-Type': o.mime, 'x-upsert': 'false' },
                            body,
                        });
                        if (!put.ok && put.status !== 409) throw new Error(`upload ${put.status} ${await put.text()}`);
                        return;
                    } catch (e) {
                        if (attempt === 3) {
                            failed += 1;
                            warn(`${b.id}/${o.name}: ${e.message}`);
                        } else {
                            await new Promise((r) => setTimeout(r, 1000 * attempt));
                        }
                    }
                }
            };
            let next = 0;
            const workers = Array.from({ length: concurrency }, async () => {
                while (next < todo.length) {
                    const o = todo[next++];
                    await work(o);
                    done += 1;
                    if (done % 250 === 0) log(`    ${fmt(done)} / ${fmt(todo.length)}`);
                }
            });
            await Promise.all(workers);
            ok(`${b.id}: copied ${fmt(done - failed)}${failed ? `, ${failed} failed (run again to retry)` : ''}`);
        }
    }
}

// ---------------------------------------------------------------------------------------------
async function reset() {
    if (!process.argv.includes('--confirm-reset-new-project')) {
        throw new Error('reset wipes what this tool created in the NEW project. Add --confirm-reset-new-project to do it.');
    }
    step('Reset the NEW project (old projects untouched)');
    await withTarget(async (c) => {
        for (const s of ['core', 'attendance', 'materials', 'progress']) {
            await c.query(`drop schema if exists ${q(s)} cascade`);
            ok(`dropped schema ${s}`);
        }
        const pols = await c.query(
            `select polname from pg_policy where polrelid = 'storage.objects'::regclass
              and (polname like 'attendance\\_\\_%' or polname like 'materials\\_\\_%' or polname like 'progress\\_\\_%')`
        );
        for (const p of pols.rows) await c.query(`drop policy ${q(p.polname)} on storage.objects`);
        ok(`dropped ${pols.rowCount} storage policies`);
        const f = outFile('auth-map.json');
        if (fs.existsSync(f)) {
            const { imported } = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (imported?.length) {
                const r = await c.query('delete from auth.users where id = any($1::uuid[])', [imported]);
                ok(`removed ${r.rowCount} sign-in accounts this tool created`);
            }
        }
        log('  (Buckets and copied files are kept — delete them in the dashboard if you want a full wipe.)');
    });
}

// ---------------------------------------------------------------------------------------------
const commands = { check, snapshot, build, apply, auth, copy, finish, verify, storage, reset };
const cmd = process.argv[2];

(async () => {
    try {
        if (cmd === 'all') {
            for (const c of [check, snapshot, build, apply, auth, copy, finish, verify]) await c();
        } else if (commands[cmd]) {
            await commands[cmd]();
        } else {
            log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 18).join('\n').replace(/^ \* ?/gm, ''));
            process.exitCode = cmd ? 1 : 0;
        }
    } catch (e) {
        console.error(`\n✗ ${e.message}`);
        process.exitCode = 1;
    }
})();
