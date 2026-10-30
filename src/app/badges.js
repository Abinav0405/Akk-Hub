/**
 * Unread badges for icons (tab bar, home tiles, bell) — per device, per account.
 *
 * A badge shows an area's count while it holds something this device has not opened yet:
 *   - opening the area's screen marks its current count as seen (badge hides)
 *   - when the count goes up again (new data), the badge comes back
 *   - when it goes down (items handled elsewhere), the lower count becomes the baseline
 *
 *   const show = useBadge('leave', pendingLeaveCount)   // 0 → no badge
 *
 * Seen counts live in localStorage `akk.hub.seen.<account>` (a device preference, not swapped
 * with accounts — each account has its own key).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { accountKey, useIdentity } from '@/core/auth/identity';
import { paths } from '@/app/paths';
import { useApprovalsInbox } from '@/pages/hubs/useApprovalsInbox';

const listeners = new Set();
const cache = new Map();

function storeKey(identity) {
    const key = accountKey(identity);
    return key ? `akk.hub.seen.${key}` : null;
}

function readSeen(skey) {
    if (!skey) return {};
    if (cache.has(skey)) return cache.get(skey);
    let value = {};
    try {
        value = JSON.parse(localStorage.getItem(skey) || '{}') || {};
    } catch {
        value = {};
    }
    cache.set(skey, value);
    return value;
}

function writeSeen(skey, value) {
    cache.set(skey, value);
    try {
        localStorage.setItem(skey, JSON.stringify(value));
    } catch {
        /* ignore */
    }
    listeners.forEach((fn) => fn());
}

function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Record `count` as seen for `area` (identity = whose device badges). */
export function markSeen(identity, area, count) {
    const skey = storeKey(identity);
    if (!skey || !Number.isFinite(count)) return;
    const seen = readSeen(skey);
    if (seen[area] === count) return;
    writeSeen(skey, { ...seen, [area]: count });
}

/** Number to show on an icon for `area` holding `count` items (0 = hide). */
export function useBadge(area, count) {
    const identity = useIdentity();
    const skey = storeKey(identity);
    const seen = useSyncExternalStore(subscribe, () => readSeen(skey), () => readSeen(skey));
    const n = Number(count) || 0;
    const base = seen[area];
    // Items handled elsewhere: lower the baseline so the next new one shows again.
    useEffect(() => {
        if (base != null && n < base) markSeen(identity, area, n);
    }, [identity, area, n, base]);
    if (n <= 0) return 0;
    if (base == null) return n;
    return n > base ? n : 0;
}

/** Badge counts for one value map, e.g. { leave: 3, shifts: 1 } → { leave: 3, shifts: 0 }. */
export function useBadges(counts) {
    const identity = useIdentity();
    const skey = storeKey(identity);
    const seen = useSyncExternalStore(subscribe, () => readSeen(skey), () => readSeen(skey));
    const out = {};
    for (const [area, raw] of Object.entries(counts || {})) {
        const n = Number(raw) || 0;
        const base = seen[area];
        out[area] = n <= 0 ? 0 : base == null || n > base ? n : 0;
    }
    return out;
}

/**
 * For running totals (e.g. decisions made on my requests): the badge is how many arrived since
 * this device last opened the area. The first sighting only sets the baseline.
 */
export function useNewSinceBadge(area, total) {
    const identity = useIdentity();
    const skey = storeKey(identity);
    const seen = useSyncExternalStore(subscribe, () => readSeen(skey), () => readSeen(skey));
    const n = total == null ? null : Number(total) || 0;
    const base = seen[area];
    useEffect(() => {
        if (n != null && (base == null || n < base)) markSeen(identity, area, n);
    }, [identity, area, n, base]);
    return n != null && base != null && n > base ? n - base : 0;
}

/** Employee areas: opening any of their screens marks them seen. */
export const WORKER_AREAS = {
    'w-materials': { match: (p) => p.startsWith('/materials') },
    'w-site': { match: (p) => p.startsWith('/progress') },
};

/** Shell hook (employees): opening Materials / Site marks the running totals seen. */
export function useMarkWorkerAreasSeen(totals) {
    const identity = useIdentity();
    const { pathname } = useLocation();
    useEffect(() => {
        if (identity?.role !== 'worker') return;
        for (const [area, def] of Object.entries(WORKER_AREAS)) {
            const n = totals?.[area];
            if (n != null && def.match(pathname)) markSeen(identity, area, n);
        }
    }, [identity, pathname, totals?.['w-materials'], totals?.['w-site']]); // eslint-disable-line react-hooks/exhaustive-deps
}

const count = (q) => (q?.isLoading || q?.isError || q?.data == null ? null : Number(q.data) || 0);

/**
 * Staff areas and the screens that "open" them (visiting one marks the area seen).
 * `match(pathname, section)` → true when the current screen is that area.
 */
export const STAFF_AREAS = {
    shifts: {
        match: (p, s, role) =>
            role === 'supervisor'
                ? p === paths.timesheet.siteShifts
                : (p === paths.timesheet.admin || p === paths.timesheet.manage) && (!s || s === 'time-tracker'),
    },
    leave: { match: (p, s) => (p === paths.timesheet.admin || p === paths.timesheet.manage) && s === 'leaves' },
    materials: { match: (p, s) => (p === paths.materials.admin && (!s || s === 'transactions')) || p === paths.materials.manage },
    packages: { match: (p, s) => (p === paths.progress.admin || p === paths.progress.review) && (!s || s === 'packages') },
};

/** Live staff counts (shared react-query cache with the home's "Needs your attention"). */
export function useStaffCounts() {
    const inbox = useApprovalsInbox();
    return {
        shifts: count(inbox.shifts),
        leave: count(inbox.leave),
        materials: count(inbox.requests),
        packages: count(inbox.packages),
    };
}

/** Shell hook: when a screen for an area is open, its current count is marked seen. */
export function useMarkAreasSeen(counts) {
    const identity = useIdentity();
    const { pathname, search } = useLocation();
    const section = new URLSearchParams(search).get('section');
    useEffect(() => {
        if (!identity) return;
        for (const [area, def] of Object.entries(STAFF_AREAS)) {
            const n = counts?.[area];
            if (n != null && def.match(pathname, section, identity.role)) markSeen(identity, area, n);
        }
    }, [identity, pathname, section, counts?.shifts, counts?.leave, counts?.materials, counts?.packages]); // eslint-disable-line react-hooks/exhaustive-deps
}
