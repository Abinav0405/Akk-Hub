/**
 * Turns a catalog snapshot of a source `public` schema into ordered SQL statements that recreate it
 * as schema `<target>` in the new project. Same table / column / function names, same constraints,
 * indexes, triggers, row-level security and API privileges — only the schema changes.
 *
 * Order (avoids dependency errors without a dependency graph):
 *   schema → enums → sequences → tables (no defaults) → functions (body checks off) → defaults →
 *   views → PK/unique/check → sequence ownership → indexes → foreign keys → triggers →
 *   RLS + policies → privileges.
 */
import { q } from './db.mjs';

const API_ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const CMD = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' };

/** public.x → <target>.x, and search_path 'public' → '<target>'. */
export function rehome(sql, target) {
    if (sql == null) return sql;
    return String(sql)
        .replace(/(^|[^A-Za-z0-9_$."])public\./g, `$1${target}.`)
        .replace(/^(\s*SET search_path TO .*)$/gim, (line) => line.replace(/'public'/g, `'${target}'`));
}

const roleList = (roles) => roles.map((r) => (r === 'public' || r === 'PUBLIC' ? 'public' : r)).join(', ');
const grantee = (g) => (g === 'PUBLIC' ? 'PUBLIC' : q(g));

/**
 * Row-level-security policies, adjusted for sharing one project.
 *
 * In the old Attendance project the only Supabase-Auth ("authenticated") users were its admins, and
 * everyone else — including the hub's workers/managers and any staff of the other two apps — reached
 * it as "anon". In the shared project, Materials staff and Site Progress admins are "authenticated"
 * too. `opts.adminGate` (e.g. 'attendance.is_admin_jwt') keeps every old permission exactly:
 *   · policy for authenticated only           → also requires adminGate()      (was: only admins)
 *   · policy for anon only                    → + a copy for authenticated non-admins (they used to be anon)
 *   · policy for anon+authenticated / public  → unchanged
 *   · `auth.role() = 'authenticated'` inside an expression → also requires adminGate()
 * `opts.anonAlsoAuthenticated` (Materials) copies anon-only policies to authenticated unchanged:
 * there, staff already had broader policies, and other authenticated users used to be anon.
 */
export function policyPlan(policies, opts = {}) {
    const gate = opts.adminGate;
    const out = [];
    const and = (expr, extra) => (expr ? `((${expr}) AND ${extra})` : null);
    for (const p of policies) {
        const roles = new Set(p.roles);
        const hasPublic = roles.has('public');
        const hasAnon = hasPublic || roles.has('anon');
        const hasAuth = hasPublic || roles.has('authenticated');
        let using = p.using;
        let check = p.check;
        if (gate) {
            const roleTest = /auth\.role\(\)\s*=\s*'authenticated'::text/g;
            const gated = `(auth.role() = 'authenticated'::text AND ${gate}())`;
            using = using && using.replace(roleTest, gated);
            check = check && check.replace(roleTest, gated);
        }
        if (gate && hasAuth && !hasAnon) {
            const g = `${gate}()`;
            out.push({
                ...p,
                using: and(using, g),
                check: check ? and(check, g) : p.cmd === 'a' ? g : null,
            });
            continue;
        }
        out.push({ ...p, using, check });
        if (hasAnon && !hasAuth) {
            if (gate) {
                const g = `(NOT ${gate}())`;
                out.push({
                    ...p,
                    name: `${p.name}__authed`.slice(0, 63),
                    roles: ['authenticated'],
                    using: and(using, g),
                    check: check ? and(check, g) : p.cmd === 'a' ? g : null,
                });
            } else if (opts.anonAlsoAuthenticated) {
                out.push({ ...p, name: `${p.name}__authed`.slice(0, 63), roles: ['authenticated'], using, check });
            }
        }
    }
    return out;
}

export function buildSchemaStatements(snap, target, opts = {}) {
    const S = q(target);
    const out = [];
    const add = (label, sql) => out.push({ label, sql });

    add('schema', `CREATE SCHEMA IF NOT EXISTS ${S}`);
    add('schema usage', `GRANT USAGE ON SCHEMA ${S} TO anon, authenticated, service_role`);

    for (const e of snap.enums) {
        add(`enum ${e.name}`, `CREATE TYPE ${S}.${q(e.name)} AS ENUM (${e.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')})`);
    }

    const identityCols = new Set();
    for (const t of snap.tables) for (const c of t.columns) if (c.identity) identityCols.add(`${t.name}.${c.name}`);

    for (const s of snap.sequences) {
        if (s.owned_by && identityCols.has(s.owned_by)) continue; // identity columns make their own
        add(
            `sequence ${s.name}`,
            `CREATE SEQUENCE ${S}.${q(s.name)} AS ${s.data_type} INCREMENT BY ${s.increment_by} MINVALUE ${s.min_value} ` +
                `MAXVALUE ${s.max_value} START WITH ${s.start_value} CACHE ${s.cache_size}${s.cycle ? ' CYCLE' : ' NO CYCLE'}`
        );
    }

    for (const t of snap.tables) {
        const cols = t.columns.map((c) => {
            let line = `${q(c.name)} ${rehome(c.type, target)}`;
            if (c.generated === 's') line += ` GENERATED ALWAYS AS (${rehome(c.default, target)}) STORED`;
            if (c.identity) line += ' GENERATED BY DEFAULT AS IDENTITY';
            if (c.notNull) line += ' NOT NULL';
            return line;
        });
        add(`table ${t.name}`, `CREATE TABLE ${S}.${q(t.name)} (\n  ${cols.join(',\n  ')}\n)`);
    }

    for (const f of snap.functions) {
        add(`function ${f.signature}`, rehome(f.def, target));
        const hasPath = (f.config || []).some((c) => c.startsWith('search_path='));
        if (!hasPath) {
            // Was relying on the caller's search_path ('public'); pin it to its new home.
            add(`function path ${f.signature}`, `ALTER FUNCTION ${rehome(f.signature, target)} SET search_path = ${S}, extensions`);
        }
    }

    for (const t of snap.tables) {
        for (const c of t.columns) {
            if (c.default == null || c.generated || c.identity) continue;
            add(`default ${t.name}.${c.name}`, `ALTER TABLE ${S}.${q(t.name)} ALTER COLUMN ${q(c.name)} SET DEFAULT ${rehome(c.default, target)}`);
        }
    }

    for (const v of snap.views) {
        const opts = v.options && v.options.length ? ` WITH (${v.options.join(', ')})` : '';
        const kind = v.materialized ? 'MATERIALIZED VIEW' : 'VIEW';
        add(`view ${v.name}`, `CREATE ${kind} ${S}.${q(v.name)}${opts} AS\n${rehome(v.def, target).replace(/;\s*$/, '')}`);
    }

    const kept = snap.constraints.filter((k) => ['p', 'u', 'c', 'x', 'f'].includes(k.type));
    for (const k of kept.filter((k) => k.type !== 'f')) {
        add(`constraint ${k.table}.${k.name}`, `ALTER TABLE ${S}.${q(k.table)} ADD CONSTRAINT ${q(k.name)} ${rehome(k.def, target)}`);
    }

    for (const s of snap.sequences) {
        if (!s.owned_by || identityCols.has(s.owned_by)) continue;
        const [tbl, col] = s.owned_by.split('.');
        add(`sequence owner ${s.name}`, `ALTER SEQUENCE ${S}.${q(s.name)} OWNED BY ${S}.${q(tbl)}.${q(col)}`);
    }

    for (const i of snap.indexes) add(`index ${i.name}`, rehome(i.def, target));

    for (const k of kept.filter((k) => k.type === 'f')) {
        add(`foreign key ${k.table}.${k.name}`, `ALTER TABLE ${S}.${q(k.table)} ADD CONSTRAINT ${q(k.name)} ${rehome(k.def, target)}`);
    }

    for (const tr of snap.triggers) add(`trigger ${tr.table}.${tr.name}`, rehome(tr.def, target));

    for (const t of snap.tables) {
        if (t.rls) add(`rls ${t.name}`, `ALTER TABLE ${S}.${q(t.name)} ENABLE ROW LEVEL SECURITY`);
        if (t.forceRls) add(`force rls ${t.name}`, `ALTER TABLE ${S}.${q(t.name)} FORCE ROW LEVEL SECURITY`);
    }
    for (const p of policyPlan(snap.policies, opts)) {
        let sql = `CREATE POLICY ${q(p.name)} ON ${S}.${q(p.table)} AS ${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${CMD[p.cmd]} TO ${roleList(p.roles)}`;
        if (p.using) sql += ` USING (${rehome(p.using, target)})`;
        if (p.check) sql += ` WITH CHECK (${rehome(p.check, target)})`;
        add(`policy ${p.table}.${p.name}`, sql);
    }

    // Privileges: exactly what the API roles had on each object in the source.
    const relKinds = new Map();
    for (const t of snap.tables) relKinds.set(t.name, 'TABLE');
    for (const v of snap.views) relKinds.set(v.name, 'TABLE');
    for (const s of snap.sequences) relKinds.set(s.name, 'SEQUENCE');
    for (const [name, kind] of relKinds) {
        add(`revoke ${name}`, `REVOKE ALL ON ${kind} ${S}.${q(name)} FROM ${API_ROLES.map(grantee).join(', ')}`);
    }
    const relGrants = new Map();
    for (const g of snap.acl.relations) {
        if (!relKinds.has(g.name)) continue;
        const key = `${g.name}\u0000${g.grantee}`;
        if (!relGrants.has(key)) relGrants.set(key, new Set());
        relGrants.get(key).add(g.privilege);
    }
    for (const [key, privs] of relGrants) {
        const [name, who] = key.split('\u0000');
        add(`grant ${name} ${who}`, `GRANT ${[...privs].join(', ')} ON ${relKinds.get(name)} ${S}.${q(name)} TO ${grantee(who)}`);
    }

    for (const f of snap.functions) {
        const sig = rehome(f.signature, target);
        add(`revoke fn ${f.signature}`, `REVOKE ALL ON FUNCTION ${sig} FROM ${API_ROLES.map(grantee).join(', ')}`);
        if (f.defaultAcl) add(`grant fn ${f.signature}`, `GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`);
    }
    const known = new Set(snap.functions.map((f) => f.signature));
    for (const g of snap.acl.functions) {
        if (!known.has(g.signature)) continue;
        add(`grant fn ${g.signature} ${g.grantee}`, `GRANT EXECUTE ON FUNCTION ${rehome(g.signature, target)} TO ${grantee(g.grantee)}`);
    }

    return out;
}

/**
 * storage.objects policies from a source, renamed so the three sources can't collide, and limited to
 * that source's own buckets: in the old project a policy without a bucket test covered every file
 * there, which in the shared project would otherwise reach the other areas' files too.
 * The same role adjustments as the tables (policyPlan) apply.
 */
export function buildStoragePolicyStatements(storage, sourceKey, target, opts = {}) {
    const out = [];
    const buckets = storage.buckets.map((b) => b.id);
    if (!buckets.length) return out; // nothing of this source's for its policies to match
    const own = `(bucket_id = ANY (ARRAY[${buckets.map((b) => `'${String(b).replace(/'/g, "''")}'`).join(', ')}]::text[]))`;
    for (const p of policyPlan(storage.policies, opts)) {
        const name = `${sourceKey}__${p.name}`.slice(0, 63);
        const using = p.cmd === 'a' ? null : p.using ? `((${rehome(p.using, target)}) AND ${own})` : own;
        const check = p.check ? `((${rehome(p.check, target)}) AND ${own})` : p.cmd === 'a' ? own : null;
        let sql = `CREATE POLICY ${q(name)} ON storage.objects AS ${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${CMD[p.cmd]} TO ${roleList(p.roles)}`;
        if (using) sql += ` USING (${using})`;
        if (check) sql += ` WITH CHECK (${check})`;
        out.push({ label: `storage policy ${name}`, sql });
    }
    return out;
}

/** Bucket ids used by more than one source (they would be merged into one bucket — must be decided first). */
export function bucketCollisions(storageBySource) {
    const seen = new Map();
    const clash = [];
    for (const [key, storage] of Object.entries(storageBySource)) {
        for (const b of storage.buckets) {
            if (seen.has(b.id)) clash.push(`${b.id} (${seen.get(b.id)} and ${key})`);
            else seen.set(b.id, key);
        }
    }
    return clash;
}

/** Plain-text preview of the statements (written to out/sql for review). */
export function toSqlFile(statements, title) {
    return `-- ${title}\n-- Generated by migration/tool. Review only; the tool applies these one by one.\n\n` +
        statements.map((s) => `-- ${s.label}\n${s.sql};\n`).join('\n');
}
