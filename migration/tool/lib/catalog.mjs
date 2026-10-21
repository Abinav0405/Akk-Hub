/**
 * Reads the structure of a source project's `public` schema straight from the Postgres catalogs
 * (no pg_dump on this machine). Runs with search_path = '' so every pg_get_* function writes fully
 * qualified names (public.table, public.fn()) — that's what lets ddl.mjs re-home it safely.
 *
 * Objects that belong to an extension, and push-webhook pieces that carry hard-coded secrets
 * (see SKIP_*), are left out — they're re-created separately for the new project.
 */

// Materials' webhook function has a secret + the old project's URL written inside it.
const SKIP_FUNCTIONS = new Set(['mt_fcm_db_webhook']);
const isWebhookTrigger = (def) => /supabase_functions\.http_request|mt_fcm_db_webhook/.test(def);

export async function readSchema(client, schema = 'public') {
    await client.query("SET search_path = ''");
    const ns = `'${schema}'::regnamespace`;
    const extOwned = `exists (select 1 from pg_catalog.pg_depend d where d.objid = x.oid and d.deptype = 'e')`;

    const rel = await client.query(`
        select x.oid, x.relname, x.relkind, x.relrowsecurity, x.relforcerowsecurity, x.reloptions
          from pg_catalog.pg_class x
         where x.relnamespace = ${ns} and x.relkind in ('r','p','v','m','S') and not ${extOwned}
         order by x.relname`);

    const tables = rel.rows.filter((r) => r.relkind === 'r' || r.relkind === 'p');
    const views = rel.rows.filter((r) => r.relkind === 'v' || r.relkind === 'm');
    const sequenceRels = rel.rows.filter((r) => r.relkind === 'S');

    const cols = await client.query(`
        select a.attrelid, c.relname, a.attnum, a.attname,
               pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
               a.attnotnull as not_null, a.attidentity as identity, a.attgenerated as generated,
               pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expr
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where c.relnamespace = ${ns} and c.relkind in ('r','p') and a.attnum > 0 and not a.attisdropped
         order by c.relname, a.attnum`);

    const constraints = await client.query(`
        select k.conname, k.contype, c.relname as table_name, pg_catalog.pg_get_constraintdef(k.oid) as def
          from pg_catalog.pg_constraint k
          join pg_catalog.pg_class c on c.oid = k.conrelid
         where k.connamespace = ${ns} and c.relkind in ('r','p')
         order by c.relname, k.contype, k.conname`);

    const indexes = await client.query(`
        select ic.relname as index_name, c.relname as table_name, pg_catalog.pg_get_indexdef(i.indexrelid) as def
          from pg_catalog.pg_index i
          join pg_catalog.pg_class ic on ic.oid = i.indexrelid
          join pg_catalog.pg_class c on c.oid = i.indrelid
         where c.relnamespace = ${ns}
           and not exists (select 1 from pg_catalog.pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p','u','x'))
         order by c.relname, ic.relname`);

    const sequences = await client.query(`
        select s.sequencename as name, s.data_type::text as data_type, s.start_value::text as start_value,
               s.min_value::text as min_value, s.max_value::text as max_value, s.increment_by::text as increment_by,
               s.cycle, s.cache_size::text as cache_size, s.last_value::text as last_value,
               (select c.relname || '.' || a.attname
                  from pg_catalog.pg_depend d
                  join pg_catalog.pg_class c on c.oid = d.refobjid
                  join pg_catalog.pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
                 where d.objid = (quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename))::regclass
                   and d.deptype in ('a','i') limit 1) as owned_by
          from pg_catalog.pg_sequences s
         where s.schemaname = '${schema}'
         order by s.sequencename`);

    const enums = await client.query(`
        select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
          from pg_catalog.pg_type t join pg_catalog.pg_enum e on e.enumtypid = t.oid
         where t.typnamespace = ${ns}
         group by t.typname order by t.typname`);

    const functions = await client.query(`
        select x.oid, x.proname as name, x.prokind as kind, x.oid::regprocedure::text as signature,
               x.proconfig as config, pg_catalog.pg_get_functiondef(x.oid) as def,
               x.proacl is null as default_acl
          from pg_catalog.pg_proc x
         where x.pronamespace = ${ns} and x.prokind in ('f','p') and not ${extOwned}
         order by x.proname, x.oid`);

    const triggers = await client.query(`
        select t.tgname as name, c.relname as table_name, pg_catalog.pg_get_triggerdef(t.oid) as def
          from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
         where c.relnamespace = ${ns} and not t.tgisinternal
         order by c.relname, t.tgname`);

    const policies = await client.query(`
        select p.polname as name, c.relname as table_name, p.polcmd as cmd, p.polpermissive as permissive,
               array(select case when r = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(r)) end
                       from unnest(p.polroles) r) as roles,
               pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
               pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
          from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
         where c.relnamespace = ${ns}
         order by c.relname, p.polname`);

    const viewDefs = await client.query(`
        select x.relname as name, x.relkind, x.reloptions, pg_catalog.pg_get_viewdef(x.oid, true) as def
          from pg_catalog.pg_class x
         where x.relnamespace = ${ns} and x.relkind in ('v','m') and not ${extOwned}
         order by x.relname`);

    // Privileges for the API roles (others are platform roles we don't manage).
    const relAcl = await client.query(`
        select x.relname as name, x.relkind,
               coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type as privilege
          from pg_catalog.pg_class x
          cross join lateral aclexplode(x.relacl) a
          left join pg_catalog.pg_roles r on r.oid = a.grantee
         where x.relnamespace = ${ns} and x.relkind in ('r','p','v','m','S')
           and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role'))`);

    const fnAcl = await client.query(`
        select x.oid::regprocedure::text as signature, coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type as privilege
          from pg_catalog.pg_proc x
          cross join lateral aclexplode(x.proacl) a
          left join pg_catalog.pg_roles r on r.oid = a.grantee
         where x.pronamespace = ${ns} and x.prokind in ('f','p')
           and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role'))`);

    const realtime = await client.query(`
        select tablename from pg_catalog.pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = '${schema}' order by tablename`);

    const counts = {};
    for (const t of tables) {
        const { rows } = await client.query(`select count(*)::bigint as n from public.${quoteIdent(t.relname)}`);
        counts[t.relname] = Number(rows[0].n);
    }

    const skipped = [];
    const fnRows = functions.rows.filter((f) => {
        if (SKIP_FUNCTIONS.has(f.name)) {
            skipped.push(`function ${f.name} (hard-coded webhook secret; re-created for the new project)`);
            return false;
        }
        return true;
    });
    const trgRows = triggers.rows.filter((t) => {
        if (isWebhookTrigger(t.def)) {
            skipped.push(`trigger ${t.table_name}.${t.name} (push webhook to the old project; re-created for the new project)`);
            return false;
        }
        return true;
    });

    await client.query('RESET search_path');

    const columnsByTable = {};
    for (const c of cols.rows) (columnsByTable[c.relname] ||= []).push(c);

    return {
        schema,
        tables: tables.map((t) => ({
            name: t.relname,
            rls: t.relrowsecurity,
            forceRls: t.relforcerowsecurity,
            columns: (columnsByTable[t.relname] || []).map((c) => ({
                name: c.attname,
                type: c.type,
                notNull: c.not_null,
                identity: c.identity || '',
                generated: c.generated || '',
                default: c.default_expr,
            })),
        })),
        views: viewDefs.rows.map((v) => ({ name: v.name, materialized: v.relkind === 'm', options: v.reloptions, def: v.def })),
        sequences: sequences.rows,
        enums: enums.rows,
        constraints: constraints.rows.map((k) => ({ name: k.conname, type: k.contype, table: k.table_name, def: k.def })),
        indexes: indexes.rows.map((i) => ({ name: i.index_name, table: i.table_name, def: i.def })),
        functions: fnRows.map((f) => ({ name: f.name, signature: f.signature, config: f.config, def: f.def, defaultAcl: f.default_acl })),
        triggers: trgRows.map((t) => ({ name: t.name, table: t.table_name, def: t.def })),
        policies: policies.rows.map((p) => ({
            name: p.name,
            table: p.table_name,
            cmd: p.cmd,
            permissive: p.permissive,
            roles: p.roles,
            using: p.using_expr,
            check: p.check_expr,
        })),
        acl: { relations: relAcl.rows, functions: fnAcl.rows },
        realtime: realtime.rows.map((r) => r.tablename),
        counts,
        sequenceRelations: sequenceRels.map((s) => s.relname),
        skipped,
    };
}

/** Storage buckets + the policies on storage.objects that name them. */
export async function readStorage(client) {
    await client.query("SET search_path = ''");
    const buckets = await client.query(`
        select b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types,
               (select count(*) from storage.objects o where o.bucket_id = b.id)::bigint as objects,
               (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o where o.bucket_id = b.id)::bigint as bytes
          from storage.buckets b order by b.id`);
    const policies = await client.query(`
        select p.polname as name, p.polcmd as cmd, p.polpermissive as permissive,
               array(select case when r = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(r)) end
                       from unnest(p.polroles) r) as roles,
               pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
               pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
          from pg_catalog.pg_policy p
         where p.polrelid = 'storage.objects'::regclass
         order by p.polname`);
    await client.query('RESET search_path');
    return {
        buckets: buckets.rows.map((b) => ({ ...b, objects: Number(b.objects), bytes: Number(b.bytes) })),
        policies: policies.rows.map((p) => ({ name: p.name, cmd: p.cmd, permissive: p.permissive, roles: p.roles, using: p.using_expr, check: p.check_expr })),
    };
}

function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
}
