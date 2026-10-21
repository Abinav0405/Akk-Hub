-- =====================================================================================
-- AKK Hub — database audit (READ-ONLY). Run once in EACH of the three Supabase projects:
--   Attendance (Timesheet) · Materials · Site Progress
-- Supabase → SQL Editor → paste → Run. Each query returns ONE cell of JSON: click it, copy, paste
-- back to me (or save as <project>-1.json / <project>-2.json in the migration/ folder).
--
-- Safe: only SELECTs on catalogs. It reads NO row contents: only table/column NAMES, row COUNTS,
-- security rules, function signatures, storage bucket sizes and auth-user COUNTS (no emails,
-- no passwords, no tokens).
-- =====================================================================================


-- ===== QUERY 1 of 2 — structure, rules, storage, accounts (run this first) ============
select jsonb_build_object(

  'meta', jsonb_build_object(
    'database', current_database(),
    'version',  version(),
    'size',     pg_size_pretty(pg_database_size(current_database())),
    'extensions', (select jsonb_agg(extname order by extname) from pg_extension)
  ),

  -- every table / view in public: columns, exact row count, size, RLS on/off
  'tables', (
    select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'name', c.relname,
        'kind', case c.relkind when 'r' then 'table' when 'p' then 'partitioned' when 'v' then 'view' else 'matview' end,
        'rows', case when c.relkind in ('r','p') then
                  (xpath('/row/c/text()',
                     query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
                end,
        'size', pg_size_pretty(pg_total_relation_size(c.oid)),
        'rls',  c.relrowsecurity,
        'columns', (
          select jsonb_agg(jsonb_build_object(
                   'n', a.attname,
                   't', format_type(a.atttypid, a.atttypmod),
                   'null', not a.attnotnull,
                   'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
          from pg_attribute a
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        )
      ) as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m')
    ) x
  ),

  -- primary / foreign keys, uniques, checks
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'table', conrelid::regclass::text, 'name', conname, 'type', contype,
             'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname), '[]'::jsonb)
    from pg_constraint where connamespace = 'public'::regnamespace
  ),

  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'def', indexdef) order by tablename, indexname), '[]'::jsonb)
    from pg_indexes where schemaname = 'public'
  ),

  -- row-level-security policies (public tables AND storage buckets)
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'schema', schemaname, 'table', tablename, 'name', policyname, 'cmd', cmd,
             'roles', roles, 'using', qual, 'check', with_check) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_policies where schemaname in ('public', 'storage')
  ),

  -- functions / RPCs the apps call (signature + security mode only; definitions are in Query 2)
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', p.proname,
             'args', pg_get_function_identity_arguments(p.oid),
             'returns', pg_get_function_result(p.oid),
             'security_definer', p.prosecdef,
             'language', l.lanname,
             'volatility', p.provolatile) order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  ),

  -- triggers on public tables and on auth.users (includes webhook triggers that call edge functions)
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'table', tgrelid::regclass::text, 'name', tgname, 'def', pg_get_triggerdef(oid))
             order by tgrelid::regclass::text, tgname), '[]'::jsonb)
    from pg_trigger
    where not tgisinternal
      and (tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
           or tgrelid = 'auth.users'::regclass)
  ),

  -- photo / file storage
  'storage_buckets', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.id, 'public', b.public,
             'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types,
             'objects', coalesce(o.n, 0),
             'size', pg_size_pretty(coalesce(o.bytes, 0))) order by b.id), '[]'::jsonb)
    from storage.buckets b
    left join lateral (
      select count(*) as n, sum((metadata->>'size')::bigint) as bytes
      from storage.objects where bucket_id = b.id
    ) o on true
  ),

  -- accounts: COUNTS only (no emails / ids)
  'auth_users', jsonb_build_object(
    'total', (select count(*) from auth.users),
    'by_provider', (
      select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (
        select coalesce(raw_app_meta_data->>'provider', 'none') as provider, count(*) as n
        from auth.users group by 1) s),
    'with_confirmed_email', (select count(*) from auth.users where email_confirmed_at is not null)
  ),

  -- tables streamed over realtime
  'realtime_tables', (
    select coalesce(jsonb_agg(schemaname || '.' || tablename order by tablename), '[]'::jsonb)
    from pg_publication_tables where pubname = 'supabase_realtime'
  )

) as audit_part_1;


-- ===== QUERY 2 of 2 — function source code (run second) ===============================
-- Shows how each login / approval RPC works, which decides how accounts get merged.
-- Skim before pasting: if you ever hard-coded a secret or key inside a function, delete that line.
select coalesce(jsonb_agg(jsonb_build_object(
         'name', p.proname,
         'args', pg_get_function_identity_arguments(p.oid),
         'source', left(pg_get_functiondef(p.oid), 6000)) order by p.proname), '[]'::jsonb) as audit_part_2
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f';
