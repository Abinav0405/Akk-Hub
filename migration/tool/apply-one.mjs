/**
 * Apply one migration/sql/*.sql file to NEW_DB_URL (from .env.migration.local).
 * Usage: node apply-one.mjs 98_expiry_alerts.sql
 * Never prints connection strings or secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { MIGRATION_DIR, newDbUrl } from './lib/env.mjs';

const name = process.argv[2];
if (!name || name.includes('..') || !name.endsWith('.sql')) {
    console.error('Usage: node apply-one.mjs <file.sql>');
    process.exit(1);
}
const file = path.join(MIGRATION_DIR, 'sql', name);
if (!fs.existsSync(file)) {
    console.error(`Missing ${name}`);
    process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');
const client = new pg.Client({ connectionString: newDbUrl(), ssl: { rejectUnauthorized: false } });
try {
    await client.connect();
    await client.query(sql);
    console.log(`Applied ${name} OK`);
} catch (e) {
    console.error(`Failed ${name}: ${e.message}`);
    process.exit(1);
} finally {
    await client.end().catch(() => {});
}
