import { format, isValid, parse, parseISO } from 'date-fns';

/** User-facing date / datetime formats (Singapore-style). */
export const DATE_DISPLAY = 'dd/MM/yy';
export const DATETIME_DISPLAY = 'dd/MM/yy HH:mm';
/** Safe for filenames (no slashes). */
export const DATE_FILE = 'dd-MM-yy';

/** Parse a DATE string `yyyy-MM-dd` as a local calendar date (not UTC midnight). */
export function parseLocalDate(value) {
    if (!value) return null;
    const datePart = String(value).slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

export function startOfTodayLocal() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** ISO date for DB / `<input type="date">` values. */
export function todayIsoDate() {
    return format(new Date(), 'yyyy-MM-dd');
}

export function formatIsoDate(date = new Date()) {
    return format(date instanceof Date ? date : new Date(date), 'yyyy-MM-dd');
}

/**
 * Parse anything we store or show into a Date (local when possible).
 * Supports: Date, ISO, yyyy-MM-dd, dd/MM/yy, dd/MM/yyyy, optional HH:mm.
 */
export function parseFlexibleDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return isValid(value) ? value : null;

    const raw = String(value).trim();
    if (!raw) return null;

    const local = parseLocalDate(raw);
    if (local) {
        const timeMatch = raw.match(/[ T](\d{1,2}):(\d{2})/);
        if (timeMatch) {
            local.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
        }
        return local;
    }

    const patterns = [
        'dd/MM/yy HH:mm',
        'dd/MM/yyyy HH:mm',
        'yyyy-MM-dd HH:mm',
        'dd/MM/yy',
        'dd/MM/yyyy',
        'dd-MM-yy',
        'dd-MM-yyyy',
    ];
    for (const p of patterns) {
        const d = parse(raw, p, new Date());
        if (isValid(d)) return d;
    }

    try {
        const iso = parseISO(raw);
        if (isValid(iso)) return iso;
    } catch {
        /* ignore */
    }

    const fallback = new Date(raw);
    return isValid(fallback) ? fallback : null;
}

/** Display date as dd/MM/yy. Returns '' for empty/invalid. */
export function formatDisplayDate(value) {
    const d = parseFlexibleDate(value);
    if (!d) return value ? String(value) : '';
    return format(d, DATE_DISPLAY);
}

/** Display datetime as dd/MM/yy HH:mm. */
export function formatDisplayDateTime(value) {
    const d = parseFlexibleDate(value);
    if (!d) return value ? String(value) : '';
    return format(d, DATETIME_DISPLAY);
}

/** Now as display datetime (for writing approval_date / return_date TEXT fields). */
export function nowDisplayDateTime() {
    return format(new Date(), DATETIME_DISPLAY);
}

/** Filename-safe date segment: dd-MM-yy */
export function formatFileDate(value) {
    const d = parseFlexibleDate(value) || new Date();
    return format(d, DATE_FILE);
}

/** Week / month / year filters using local calendar dates. Does not mutate Date. */
export function matchesDateFilter(transactionDate, dateFilter) {
    if (dateFilter === 'all' || !transactionDate) return true;
    const transDate = parseLocalDate(transactionDate) || parseFlexibleDate(transactionDate);
    if (!transDate) return true;

    const now = new Date();
    const today = startOfTodayLocal();

    if (dateFilter === 'week') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return transDate >= weekAgo;
    }
    if (dateFilter === 'month') {
        return transDate.getMonth() === now.getMonth() && transDate.getFullYear() === now.getFullYear();
    }
    if (dateFilter === 'year') {
        return transDate.getFullYear() === now.getFullYear();
    }
    return true;
}

export const TRANSACTION_QUERY_LIMIT = 5000;
