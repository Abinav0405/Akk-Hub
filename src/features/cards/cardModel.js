/**
 * Card look + helpers shared by the digital card, the scanners and the PVC print.
 *   role → theme: employee = red card, supervisor = blue, manager = green, admin = white with a red band
 */
export const ROLE_THEME = {
    employee: { key: 'employee', label: 'EMPLOYEE', short: 'EMPLOYEE', pdf: { from: [92, 7, 24], to: [155, 16, 48], text: [255, 255, 255], band: [61, 4, 16] } },
    supervisor: { key: 'supervisor', label: 'SUPERVISOR', short: 'SUPERVISOR', pdf: { from: [10, 42, 92], to: [29, 78, 216], text: [255, 255, 255], band: [7, 26, 64] } },
    manager: { key: 'manager', label: 'MANAGER', short: 'MANAGER', pdf: { from: [6, 78, 51], to: [21, 128, 61], text: [255, 255, 255], band: [3, 48, 31] } },
    admin: { key: 'admin', label: 'ADMINISTRATOR', short: 'ADMIN', pdf: { from: [255, 255, 255], to: [250, 247, 245], text: [15, 23, 42], band: [140, 13, 38] } },
};
export const themeFor = (role) => ROLE_THEME[role] || ROLE_THEME.employee;

export const STATE_LABEL = {
    valid: 'Active',
    expired: 'Card expired',
    left: 'Not in company',
    replaced: 'Replaced by a newer card',
    void: 'Cancelled',
    none: 'No card',
};

/** 1234567812345678 → 1234 5678 1234 5678 */
export const groupNumber = (n) => String(n || '').replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

export function fmtDate(value) {
    if (!value) return '—';
    const s = String(value).slice(0, 10);
    if (s.startsWith('9999')) return 'No expiry';
    const [y, m, d] = s.split('-').map(Number);
    if (!y) return '—';
    return new Date(y, m - 1, d).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysLeft(value) {
    if (!value || String(value).startsWith('9999')) return null;
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
    if (!y) return null;
    return Math.round((new Date(y, m - 1, d) - new Date(new Date().toDateString())) / 86400000);
}

/** The AKK Hub website (VITE_PUBLIC_SITE_URL, else this page's address on the web; null inside the app). */
export function siteUrl() {
    const configured = String(import.meta.env.VITE_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) && !/^(localhost|127\.)/.test(window.location.hostname) && window.location.hostname !== '') {
        // Capacitor serves the app from https://localhost — that is not a public address.
        return window.location.origin;
    }
    return null;
}

/** What goes in a QR: a link to the public check page when we know the site address, else the bare code. */
export function qrPayload(code, base = siteUrl()) {
    return base ? `${base}/id?c=${encodeURIComponent(code)}` : code;
}

/** Pull a card code out of whatever a scanner read (URL, bare code, or 16 digits). */
export function extractCode(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    try {
        if (/^https?:\/\//i.test(s)) {
            const u = new URL(s);
            const c = u.searchParams.get('c');
            if (c) return c;
        }
    } catch {
        /* not a URL */
    }
    if (/^AKK1[LP]\./.test(s)) return s;
    const digits = s.replace(/[\s-]/g, '');
    if (/^\d{16}$/.test(digits)) return digits;
    return s; // let the server decide (it answers "not a valid AKK card code")
}

/** Luhn check (same as the server) — catches typos before a lookup. */
export function luhnOk(digits) {
    const s = String(digits || '');
    if (!/^\d{16}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 16; i += 1) {
        let d = Number(s[15 - i]);
        if (i % 2 === 1) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return sum % 10 === 0;
}
