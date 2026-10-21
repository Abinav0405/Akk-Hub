#!/usr/bin/env node
/**
 * Apply remaining finish-all SQL to the NEW Hub project. Never prints secrets.
 *   node apply-finish.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_DIR, newDbUrl } from './lib/env.mjs';
import { openTarget } from './lib/db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(MIGRATION_DIR, 'sql');

const FILES = [
    '00_prereq.sql', // pg_net + extensions (idempotent)
    '60_overlay_opacity.sql',
    '61_akk_camera.sql',
    '62_device_push_supervisor.sql',
    '63_local_worker_details_rls.sql',
];

async function main() {
    // Touch env so NEW_DB_URL is validated without printing it.
    newDbUrl();
    const c = await openTarget();
    try {
        // Skip 70_deployment if tables already exist
        const dep = await c.query(`select to_regclass('core.deployment_notifications') is not null as ok`);
        console.log(`70_deployment: ${dep.rows[0].ok ? 'SKIP (tables exist)' : 'would apply (not in this batch)'}`);

        for (const name of FILES) {
            const full = path.join(SQL_DIR, name);
            if (!fs.existsSync(full)) {
                console.log(`  ! missing ${name}`);
                continue;
            }
            const sql = fs.readFileSync(full, 'utf8');
            process.stdout.write(`Applying ${name}... `);
            try {
                await c.query(sql);
                console.log('OK');
            } catch (e) {
                console.log('FAIL');
                console.error(`  ${e.message}`);
                throw e;
            }
        }

        // Evidence checks (no secrets)
        const checks = await c.query(`
          select
            exists(select 1 from pg_extension where extname = 'pg_net') as pg_net,
            exists(select 1 from information_schema.columns
                    where table_schema='progress' and table_name='company_branding'
                      and column_name='overlay_opacity_pct') as overlay_opacity,
            exists(select 1 from information_schema.tables
                    where table_schema='progress' and table_name='akk_camera_photos') as akk_camera,
            exists(select 1 from information_schema.columns
                    where table_schema='attendance' and table_name='device_push_tokens'
                      and column_name='supervisor_id') as supervisor_id,
            (select count(*)::int from pg_policies
              where schemaname='attendance' and tablename='local_worker_details') as lwd_policies
        `);
        console.log('Evidence:', JSON.stringify(checks.rows[0]));
    } finally {
        await c.end();
    }
}

main().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
});
