/**
 * Offline card check for supervisors / managers / admins (no signal on site).
 *   - refreshOfflinePack(): downloads core.card_offline_pack — every card's state, dates and SHA-256
 *     fingerprints of its printed-card QR token and number (never the raw token or number).
 *   - offlineVerify(code): checks a printed-card QR, the barcode / typed number, or a live phone code
 *     against that list. Live codes: the time is checked, the signature cannot be (that needs the server),
 *     so they come back amber at best. Printed cards and numbers match exactly as online.
 *   - Offline scans are queued and uploaded by flushOfflineScans() once back online.
 */
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';
import { extractCode } from './cardModel';

const PACK_KEY = 'akk.cards.offlinePack';
const QUEUE_KEY = 'akk.cards.offlineQueue';
const PACK_MAX_AGE_MS = 7 * 86400_000;
const PACK_REFRESH_MS = 6 * 3600_000;

const read = (key) => {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
        return null;
    }
};
const write = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage full / blocked — offline check just stays unavailable */
    }
};

/** True for "no connection" failures (not for server errors such as "not allowed"). */
export function isNetworkError(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i.test(String(e?.message || e || ''));
}

/** The saved list, or null when there is none / it is older than 7 days. */
export function getOfflinePack() {
    const pack = read(PACK_KEY);
    if (!pack?.cards || !pack.saved_at || Date.now() - pack.saved_at > PACK_MAX_AGE_MS) return null;
    return pack;
}

/** Download a fresh list when the saved one is missing or older than 6 hours (force = always). */
export async function refreshOfflinePack({ force = false } = {}) {
    if (!UNIFIED) return null;
    const have = getOfflinePack();
    if (!force && have && Date.now() - have.saved_at < PACK_REFRESH_MS) return have;
    const { data, error } = await supabaseCore.rpc('card_offline_pack', { p_token: getRoleSessionToken() || null });
    if (error) throw new Error(error.message);
    const pack = { ...data, saved_at: Date.now() };
    write(PACK_KEY, pack);
    return pack;
}

async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unb36(s) {
    let n = 0;
    for (const ch of s) n = n * 36 + parseInt(ch, 36);
    return n;
}

const dayDiff = (iso) => {
    if (!iso || String(iso).startsWith('9999')) return null;
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - new Date(new Date().toDateString())) / 86400000);
};

/** Same red / amber rules as the server's card check, from the saved list. */
function checksFor(c, { method, fresh }) {
    const out = [];
    const state = c.state;
    if (state === 'replaced') out.push({ level: 'red', text: 'This card was replaced by a newer card' });
    else if (state === 'void') out.push({ level: 'red', text: 'This card was cancelled' });
    else if (state === 'left') out.push({ level: 'red', text: 'No longer with the company' });
    else if (state === 'expired') out.push({ level: 'red', text: 'Card expired' });
    else {
        const d = dayDiff(c.valid_until);
        if (d != null && d < 0) out.push({ level: 'red', text: 'Card expired' });
        else if (d != null && d <= 30) out.push({ level: 'amber', text: `Card expires in ${d} day(s)` });
    }
    if (method === 'live') {
        out.push(fresh
            ? { level: 'amber', text: 'Offline — the live code’s time is right, but its signature can only be checked online' }
            : { level: 'red', text: 'Old code — this looks like a screenshot. Ask for the live card in the app.' });
    }
    if (c.worker_type !== 'local') {
        const d = dayDiff(c.permit_expiry_date);
        if (c.permit_expiry_date == null) out.push({ level: 'amber', text: 'No work permit expiry on file' });
        else if (d != null && d < 0) out.push({ level: 'red', text: 'Work permit expired' });
        else if (d != null && d <= 30) out.push({ level: 'amber', text: `Work permit expires in ${d} day(s)` });
    }
    const s = dayDiff(c.safety_cert_expiry_date);
    if (c.safety_cert_expiry_date == null) out.push({ level: 'amber', text: 'No safety certificate on file' });
    else if (s != null && s < 0) out.push({ level: 'red', text: 'Safety certificate expired' });
    else if (s != null && s <= 30) out.push({ level: 'amber', text: `Safety certificate expires in ${s} day(s)` });
    out.push({ level: 'info', text: 'Checked offline — deployment and shift are not available until you are back online' });
    return out;
}

/** → a result shaped like card_verify's (plus offline: true), or { found: false } */
export async function offlineVerify(rawCode) {
    const pack = getOfflinePack();
    if (!pack) return { found: false, offline: true, message: 'No signal, and no saved card list on this phone yet. Open Scan ID card once with signal to save it.' };
    const code = extractCode(rawCode) || '';
    let card = null;
    let method = null;
    let fresh = true;
    const live = code.match(/^AKK1L\.([0-9a-f]{32})\.([0-9a-z]{1,12})\.[0-9a-f]{20}$/);
    if (live) {
        method = 'live';
        card = pack.cards.find((c) => c.card_id === live[1]) || null;
        const age = Date.now() / 1000 - unb36(live[2]);
        fresh = age >= -30 && age <= 120;
    } else if (/^AKK1P\./.test(code)) {
        method = 'printed';
        const h = await sha256Hex(code.slice(6));
        card = pack.cards.find((c) => c.token_hash === h) || null;
    } else if (/^\d{16}$/.test(code)) {
        method = 'number';
        const h = await sha256Hex(code);
        card = pack.cards.find((c) => c.number_hash === h) || null;
    }
    const at = new Date().toISOString();
    if (!card) {
        queueOfflineScan({ at, method: method || 'unknown', result: 'not_found' });
        return { found: false, offline: true, message: 'Not on the saved card list. If the card is new, check it again when you have signal.' };
    }
    const checks = checksFor(card, { method, fresh });
    const overall = checks.some((c) => c.level === 'red') ? 'red' : checks.some((c) => c.level === 'amber') ? 'amber' : 'green';
    queueOfflineScan({ at, card_id: card.card_id, employee_id: card.employee_id, method, result: overall });
    return {
        found: true,
        offline: true,
        method,
        live: method === 'live' ? fresh : null,
        verified_at: at,
        overall,
        checks,
        card: { ...card, in_company: card.state !== 'left' },
        today: null,
        pack_saved_at: pack.saved_at,
    };
}

function queueOfflineScan(item) {
    const q = read(QUEUE_KEY) || [];
    q.push(item);
    write(QUEUE_KEY, q.slice(-500));
}

/** Upload scans made offline (best effort; kept for next time on failure). */
export async function flushOfflineScans() {
    const q = read(QUEUE_KEY) || [];
    if (!q.length || !UNIFIED) return 0;
    const batch = q.slice(0, 200);
    const { error } = await supabaseCore.rpc('card_log_offline', { p_token: getRoleSessionToken() || null, p_items: batch });
    if (error) return 0;
    write(QUEUE_KEY, q.slice(batch.length));
    return batch.length;
}
