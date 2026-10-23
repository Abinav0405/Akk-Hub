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

// Supabase's direct host (db.<ref>.supabase.co) is IPv6-only. On networks without IPv6, fall back to the
// IPv4 session pooler (same database, same password; user becomes postgres.<ref>). NEW_DB_POOLER_HOST can
// pin the pooler host; otherwise the usual regional hosts are tried.
const POOLER_HOSTS = ['aws-1-ap-southeast-1', 'aws-0-ap-southeast-1', 'aws-0-ap-south-1', 'aws-1-ap-south-1', 'aws-0-ap-northeast-1', 'aws-0-us-east-1', 'aws-0-eu-central-1']
    .map((h) => `${h}.pooler.supabase.com`);

function poolerUrls(direct) {
    const u = new URL(direct);
    const m = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname);
    if (!m) return [];
    const hosts = process.env.NEW_DB_POOLER_HOST ? [process.env.NEW_DB_POOLER_HOST] : POOLER_HOSTS;
    return hosts.map((host) => {
        const p = new URL(direct);
        p.hostname = host;
        p.port = '5432';
        if (!p.username.includes('.')) p.username = `${p.username}.${m[1]}`;
        return p.toString();
    });
}

/** The new project — the only database this tool writes to. */
export async function openTarget() {
    const direct = newDbUrl();
    const label = 'New AKK Hub project (NEW_DB_URL)';
    try {
        return await open(direct, 'akk-hub-migration-write', label);
    } catch (e) {
        if (!/ENOTFOUND|ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL/.test(e.message)) throw e;
        for (const url of poolerUrls(direct)) {
            try {
                return await open(url, 'akk-hub-migration-write', label + ' via pooler');
            } catch {
                /* try the next region */
            }
        }
        throw e;
    }
}

export const q = (ident) => '"' + String(ident).replace(/"/g, '""') + '"';
export const lit = (value) => "'" + String(value).replace(/'/g, "''") + "'";
