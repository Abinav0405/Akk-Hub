import pg from 'pg';
import { newDbUrl, sourceDbUrl } from './env.mjs';

async function open(url, appName, label) {
    const client = new pg.Client({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        application_name: appName,
        statement_timeout: 0,
        keepAlive: true,
    });
    try {
        await client.connect();
    } catch (e) {
        throw new Error(`${label}: ${e.message}`);
    }
    return client;
}

/**
 * Old project: every transaction is forced read-only by the server, so even a bug in this tool
 * cannot change or delete anything there.
 */
export async function openSource(src) {
    const client = await open(sourceDbUrl(src), `akk-hub-migration-read-${src.key}`, `${src.label} (${src.dbEnv})`);
    await client.query('SET default_transaction_read_only = on');
    await client.query("SET statement_timeout = '15min'");
    const { rows } = await client.query('SHOW default_transaction_read_only');
    if (rows[0].default_transaction_read_only !== 'on') throw new Error(`Could not make the ${src.label} connection read-only.`);
    return client;
}

/** The new project — the only database this tool writes to. */
export async function openTarget() {
    return open(newDbUrl(), 'akk-hub-migration-write', 'New AKK Hub project (NEW_DB_URL)');
}

export const q = (ident) => '"' + String(ident).replace(/"/g, '""') + '"';
export const lit = (value) => "'" + String(value).replace(/'/g, "''") + "'";
