/**
 * Pure helpers for the staff Requests screen (web + app). Everything here derives from the
 * transaction rows already loaded by AdminDashboard — no extra queries, no second source of
 * truth. Return progress on a take row comes from the fields `applyReturnToTakeMaterials`
 * writes (`returned`, `returned_quantity`, `return_date`, `return_declined*`).
 */
import { parseQty, parseReturnQty } from '@/modules/materials/lib/inventory';
import { matchesDateFilter, parseLocalDate, parseFlexibleDate, startOfTodayLocal } from '@/modules/materials/lib/dates';

export const TYPE_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'take', label: 'Take' },
    { value: 'return', label: 'Return' },
];
export const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'declined', label: 'Declined' },
];
export const RETURN_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'returned', label: 'Returned' },
    { value: 'partially_returned', label: 'Partially returned' },
    { value: 'not_returned', label: 'Not returned' },
    { value: 'outstanding', label: 'Outstanding' },
];
export const DATE_OPTIONS = [
    { value: 'all', label: 'All time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'year', label: 'This year' },
    { value: 'custom', label: 'Custom' },
];

export const DEFAULT_FILTERS = Object.freeze({
    search: '',
    type: 'all',
    status: 'all',
    returns: 'all',
    date: 'all',
    from: '',
    to: '',
    workerId: '',
    site: 'all',
});

/** Filters that narrow the list (search is reported separately). */
export function activeFilterCount(f) {
    let n = 0;
    if (f.type !== 'all') n++;
    if (f.status !== 'all') n++;
    if (f.returns !== 'all') n++;
    if (f.date !== 'all') n++;
    if (f.workerId.trim()) n++;
    if (f.site !== 'all') n++;
    return n;
}

export function hasAnyFilter(f) {
    return activeFilterCount(f) > 0 || Boolean(f.search.trim());
}

// ── Item-level return state ────────────────────────────────────────────────

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Quantities for one material line on a take request. */
export function takeItemQuantities(material) {
    const qty = parseQty(material.quantity);
    const recorded = Math.min(qty, Math.max(0, parseReturnQty(material.returned_quantity)));
    const returned = material.returned ? qty : recorded;
    return { qty, returned, outstanding: Math.max(0, qty - returned) };
}

/**
 * Status of one material line, in the context of its request.
 * tone: success | warning | danger | neutral — always paired with a label.
 */
export function itemStatus(tx, material) {
    const status = tx.approval_status || 'pending';
    if (tx.transaction_type === 'return') {
        if (status === 'approved') return { key: 'accepted', tone: 'success', label: 'Return accepted' };
        if (status === 'declined') return { key: 'declined', tone: 'danger', label: 'Return declined' };
        return { key: 'awaiting', tone: 'warning', label: 'Awaiting approval' };
    }
    if (status === 'pending') return { key: 'awaiting', tone: 'neutral', label: 'Awaiting approval' };
    if (status === 'declined') return { key: 'not_issued', tone: 'danger', label: 'Not issued' };
    if (!material.reference_number) return { key: 'not_returnable', tone: 'neutral', label: 'No item code' };
    const { returned, outstanding } = takeItemQuantities(material);
    if (outstanding === 0) return { key: 'returned', tone: 'success', label: 'Fully returned' };
    if (returned > 0) return { key: 'partial', tone: 'warning', label: 'Partially returned' };
    return { key: 'outstanding', tone: 'warning', label: 'Not returned' };
}

/** Is any returnable item on an approved take still out on site? */
export function isOutstanding(tx) {
    if (tx.transaction_type !== 'take' || tx.approval_status !== 'approved') return false;
    return (tx.materials || []).some(
        (m) => m.reference_number && takeItemQuantities(m).outstanding > 0
    );
}

// ── Request summary ────────────────────────────────────────────────────────

/**
 * Totals grouped by unit so pieces, metres and sets are never added together.
 * Returns { types, units: [{ unit, qty, returned, outstanding }], outstandingItems, returnState }.
 */
export function summarize(tx) {
    const materials = tx.materials || [];
    const isTake = tx.transaction_type === 'take';
    const approvedTake = isTake && tx.approval_status === 'approved';
    const keys = new Set();
    const byUnit = new Map();
    let outstandingItems = 0;
    let returnedItems = 0;
    let returnable = 0;

    for (const m of materials) {
        keys.add(lower(m.reference_number) || lower(m.name));
        const unitKey = lower(m.unit);
        if (!byUnit.has(unitKey)) byUnit.set(unitKey, { unit: String(m.unit || '').trim(), qty: 0, returned: 0, outstanding: 0, of: 0 });
        const row = byUnit.get(unitKey);
        if (isTake) {
            const q = takeItemQuantities(m);
            row.qty += q.qty;
            if (approvedTake && m.reference_number) {
                returnable++;
                row.returned += q.returned;
                row.outstanding += q.outstanding;
                if (q.outstanding > 0) outstandingItems++;
                else returnedItems++;
            }
        } else {
            row.qty += parseReturnQty(m.return_quantity);
            row.of += parseQty(m.quantity);
        }
    }

    let returnState = null;
    if (approvedTake && returnable > 0) {
        const anyReturned = [...byUnit.values()].some((u) => u.returned > 0);
        returnState = outstandingItems === 0 ? 'returned' : anyReturned ? 'partial' : 'outstanding';
    }

    return {
        types: keys.size,
        units: [...byUnit.values()],
        outstandingItems,
        returnedItems,
        returnState,
    };
}

/** "12 pcs · 30 m" — one figure per unit. */
export function formatUnitTotals(units, field = 'qty') {
    const parts = units
        .filter((u) => u[field] > 0)
        .map((u) => `${u[field].toLocaleString()}${u.unit ? ` ${u.unit}` : ''}`);
    return parts.join(' · ');
}

/** Quantity text for a material line. */
export function lineQuantity(tx, material) {
    const unit = material.unit ? ` ${material.unit}` : '';
    if (tx.transaction_type === 'return') {
        const back = parseReturnQty(material.return_quantity);
        const of = parseQty(material.quantity);
        return of && back !== of ? `${back} of ${of}${unit}` : `${back || of}${unit}`;
    }
    return `${parseQty(material.quantity)}${unit}`;
}

// ── Return history (recorded approved return requests) ──────────────────────

/**
 * Approved return records for one item code on a take request. Returns are allocated per
 * worker (see applyReturnToTakeMaterials), so only this worker's returns are listed.
 */
export function returnRecordsFor(tx, material, approvedReturns) {
    const ref = String(material.reference_number || '').trim();
    if (!ref || tx.transaction_type !== 'take') return [];
    const records = [];
    for (const r of approvedReturns || []) {
        if (tx.worker_id && r.worker_id && r.worker_id !== tx.worker_id) continue;
        const line = (r.materials || []).find((m) => String(m.reference_number || '').trim() === ref);
        const qty = parseReturnQty(line?.return_quantity);
        if (qty > 0) {
            records.push({
                id: r.id,
                by: r.worker_name || '',
                qty,
                unit: line.unit || material.unit || '',
                date: r.transaction_date || '',
                time: r.transaction_time || '',
                approvedBy: r.approved_by || '',
            });
        }
    }
    return records.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

/**
 * Recorded events for a request, oldest first. Only events with data in the row are listed —
 * nothing is inferred or invented.
 */
export function requestTimeline(tx) {
    const events = [];
    events.push({
        id: 'created',
        tone: 'neutral',
        title: tx.transaction_type === 'return' ? 'Return requested' : 'Take requested',
        detail: tx.worker_name ? `by ${tx.worker_name}` : '',
        date: tx.transaction_date,
        time: tx.transaction_time,
    });
    if (tx.approval_status === 'approved' || tx.approval_status === 'declined') {
        const approved = tx.approval_status === 'approved';
        events.push({
            id: 'decision',
            tone: approved ? 'success' : 'danger',
            title: approved ? 'Approved' : 'Declined',
            detail: tx.approved_by ? `by ${tx.approved_by}` : '',
            stamp: tx.approval_date || '',
        });
    } else {
        events.push({ id: 'pending', tone: 'warning', title: 'Waiting for approval', pending: true });
    }
    if (tx.transaction_type === 'take') {
        for (const m of tx.materials || []) {
            if (m.return_declined && (m.return_declined_by || m.return_declined_date)) {
                events.push({
                    id: `rd-${m.reference_number}`,
                    tone: 'danger',
                    title: `Return declined · ${m.name}`,
                    detail: m.return_declined_by ? `by ${m.return_declined_by}` : '',
                    stamp: m.return_declined_date || '',
                });
            }
            if (m.returned && m.return_date) {
                events.push({
                    id: `rf-${m.reference_number || m.name}`,
                    tone: 'success',
                    title: `Fully returned · ${m.name}`,
                    stamp: m.return_date,
                });
            }
        }
    }
    return events;
}

// ── Filtering ──────────────────────────────────────────────────────────────

/** Same rules as before the redesign; `/name` searches by approver. */
export function matchesSearch(t, rawTerm) {
    const term = String(rawTerm || '').trim();
    if (!term) return true;
    if (term.startsWith('/')) {
        const approver = term.slice(1).toLowerCase().trim();
        return lower(t.approved_by).includes(approver);
    }
    const q = term.toLowerCase();
    return (
        lower(t.worker_name).includes(q) ||
        lower(t.worker_id).includes(q) ||
        lower(t.site_name).includes(q) ||
        (t.materials || []).some(
            (m) => lower(m.name).includes(q) || lower(m.reference_number).includes(q)
        )
    );
}

/** Material return filter — existing semantics, plus "outstanding". Only take requests match. */
export function matchesReturnFilter(t, value) {
    if (value === 'all') return true;
    if (t.transaction_type !== 'take') return false;
    const materials = t.materials || [];
    if (value === 'outstanding') return isOutstanding(t);
    if (!materials.length) return false;
    if (value === 'returned') return materials.every((m) => m.returned === true);
    if (value === 'partially_returned') {
        return materials.some((m) => parseReturnQty(m.returned_quantity) > 0) &&
            materials.some((m) => parseReturnQty(m.returned_quantity) < parseQty(m.quantity));
    }
    if (value === 'not_returned') return materials.every((m) => parseReturnQty(m.returned_quantity) === 0);
    return true;
}

export function matchesDate(t, preset, from, to) {
    if (preset === 'all') return true;
    if (preset === 'week' || preset === 'month' || preset === 'year') {
        return matchesDateFilter(t.transaction_date, preset);
    }
    const d = parseLocalDate(t.transaction_date) || parseFlexibleDate(t.transaction_date);
    if (!d) return true;
    if (preset === 'today') return d.getTime() === startOfTodayLocal().getTime();
    if (preset === 'custom') {
        const start = parseLocalDate(from);
        const end = parseLocalDate(to);
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
    }
    return true;
}

/** Search, date, person and site — the scope the summary cards count within. */
export function inScope(t, f) {
    return (
        matchesSearch(t, f.search) &&
        matchesDate(t, f.date, f.from, f.to) &&
        (!f.workerId.trim() || lower(t.worker_id).includes(f.workerId.trim().toLowerCase())) &&
        (f.site === 'all' || String(t.site_name || '') === f.site)
    );
}

export function matchesFacets(t, f) {
    return (
        (f.type === 'all' || t.transaction_type === f.type) &&
        (f.status === 'all' || t.approval_status === f.status) &&
        matchesReturnFilter(t, f.returns)
    );
}

export function filterRequests(list, f) {
    return list.filter((t) => inScope(t, f) && matchesFacets(t, f));
}

/**
 * Summary figures over the in-scope rows. Each card's `facets` is what tapping it applies,
 * so the resulting list length always equals the card's number.
 */
export function computeMetrics(list, f) {
    const scoped = list.filter((t) => inScope(t, f));
    const m = { total: scoped.length, pending: 0, approved: 0, declined: 0, outstanding: 0, returned: 0 };
    for (const t of scoped) {
        if (t.approval_status === 'pending') m.pending++;
        else if (t.approval_status === 'approved') m.approved++;
        else if (t.approval_status === 'declined') m.declined++;
        if (isOutstanding(t)) m.outstanding++;
        if (matchesReturnFilter(t, 'returned')) m.returned++;
    }
    return m;
}

export const METRIC_FACETS = {
    total: { type: 'all', status: 'all', returns: 'all' },
    pending: { type: 'all', status: 'pending', returns: 'all' },
    approved: { type: 'all', status: 'approved', returns: 'all' },
    outstanding: { type: 'all', status: 'all', returns: 'outstanding' },
    returned: { type: 'all', status: 'all', returns: 'returned' },
};

export function activeMetric(f) {
    for (const [key, facets] of Object.entries(METRIC_FACETS)) {
        if (f.type === facets.type && f.status === facets.status && f.returns === facets.returns) return key;
    }
    return null;
}

/** Distinct site names present in the loaded rows (the backend has no separate site list here). */
export function siteOptions(list) {
    const set = new Set();
    for (const t of list) if (t.site_name) set.add(String(t.site_name));
    return [...set].sort((a, b) => a.localeCompare(b));
}

export function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
