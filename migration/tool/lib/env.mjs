/**
 * Settings: migration/.env.migration.local (gitignored). Values are never printed.
 * Every source URL must belong to its own project ref, and the target must be the new project,
 * so a pasted-in-the-wrong-line URL can never make us write to an old database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATION_DIR = path.resolve(HERE, '..', '..');
export const OUT_DIR = path.resolve(HERE, '..', 'out');

export const NEW_REF = 'rvejqoxmvcemeebywpzx';
export const SOURCES = [
    { key: 'attendance', label: 'Attendance (Timesheet)', ref: 'xuqvzlbfqdkfjjhdvzac', dbEnv: 'SRC_ATTENDANCE_DB_URL', urlEnv: 'SRC_ATTENDANCE_URL', keyEnv: 'SRC_ATTENDANCE_SERVICE_KEY' },
    { key: 'materials', label: 'Materials', ref: 'tglslbsruyzkqpxczdzn', dbEnv: 'SRC_MATERIALS_DB_URL', urlEnv: 'SRC_MATERIALS_URL', keyEnv: 'SRC_MATERIALS_SERVICE_KEY' },
    { key: 'progress', label: 'Site Progress', ref: 'qpndkdbomtbnhkdyigyy', dbEnv: 'SRC_PROGRESS_DB_URL', urlEnv: 'SRC_PROGRESS_URL', keyEnv: 'SRC_PROGRESS_SERVICE_KEY' },
];

let cache = null;
export function env() {
    if (cache) return cache;
    const file = path.join(MIGRATION_DIR, '.env.migration.local');
    if (!fs.existsSync(file)) {
        throw new Error(
            'migration/.env.migration.local is missing. Copy migration/.env.migration.example to that name and fill it in.'
        );
    }
    const out = {};
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        out[line.slice(0, eq).trim()] = value;
    }
    cache = out;
    return out;
}

export function need(name) {
    const value = env()[name];
    if (!value) throw new Error(`${name} is empty in migration/.env.migration.local`);
    return value;
}

/**
 * Dashboard connection strings show the password as [YOUR-PASSWORD]; people often keep the brackets.
 * Strip them, and percent-encode the password so characters like @ # / ? : work.
 */
export function cleanDbUrl(url, name) {
    const m = /^(postgres(?:ql)?:\/\/[^:/@]+:)(.*)@([^@]+)$/.exec(url);
    if (!m) return url;
    let pw = m[2];
    if (pw.startsWith('[') && pw.endsWith(']')) pw = pw.slice(1, -1);
    if (/^YOUR-PASSWORD$/i.test(pw)) throw new Error(`${name}: replace [YOUR-PASSWORD] with that project's database password.`);
    let plain = pw;
    try {
        plain = decodeURIComponent(pw);
    } catch {
        /* already plain */
    }
    return `${m[1]}${encodeURIComponent(plain)}@${m[3]}`;
}

/** Connection URL for a source, after checking it really is that project. */
export function sourceDbUrl(src) {
    const url = cleanDbUrl(need(src.dbEnv), src.dbEnv);
    if (!url.includes(src.ref)) throw new Error(`${src.dbEnv} does not point at the ${src.label} project (${src.ref}).`);
    if (url.includes(NEW_REF)) throw new Error(`${src.dbEnv} points at the NEW project — it must be the old ${src.label} project.`);
    return url;
}

export function newDbUrl() {
    const url = cleanDbUrl(need('NEW_DB_URL'), 'NEW_DB_URL');
    if (!url.includes(NEW_REF)) throw new Error(`NEW_DB_URL must be the new AKK Hub project (${NEW_REF}).`);
    for (const s of SOURCES) if (url.includes(s.ref)) throw new Error('NEW_DB_URL points at an old project.');
    return url;
}
