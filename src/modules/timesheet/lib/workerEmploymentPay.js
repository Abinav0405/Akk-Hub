/** Label shown on timesheet rows when the worker was not employed on that date. */
export const NEY_LABEL = 'NEY';

export function parseIsoDateSafe(s) {
    if (!s || typeof s !== 'string') return null;
    // Explicit +08:00 ensures midnight is anchored to Singapore date regardless of device timezone.
    const t = Date.parse(`${s.trim()}T00:00:00+08:00`);
    return Number.isNaN(t) ? null : t;
}

export function parseRejoinDatesFromWorker(worker) {
    const r = worker?.rejoin_dates;
    if (!Array.isArray(r)) return [];
    return [
        ...new Set(
            r
                .map((d) => (typeof d === 'string' ? d.trim() : String(d ?? '').trim()))
                .filter(Boolean)
        ),
    ].sort((a, b) => a.localeCompare(b));
}

export function workerIsNotInCompany(w) {
    return w.in_company === false || w.in_company === 0 || w.in_company === null || w.in_company === 'false';
}

function subtractOneCalendarDay(dateStr) {
    const t = parseIsoDateSafe(dateStr);
    if (t == null) return dateStr;
    const d = new Date(t);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Build employed date intervals (inclusive start/end). Gaps between intervals = no pay.
 *
 * Handles multiple cessation/rejoin cycles by building ordered segments:
 *   inCompany=true  → [joined→cessation?, r0→r1-1day?, …, rN→null]
 *   inCompany=false → [joined→r0-1day, r0→r1-1day, …, rN→cessation]
 *
 * Intermediate cessation dates are inferred as the day before the next rejoin.
 * An explicit date_of_cessation anchors the initial gap (inCompany=true) or the
 * final termination (inCompany=false).
 */
export function buildEmploymentIntervals(worker) {
    const joined = worker?.date_joined?.trim();
    if (!joined) return [];

    const cessationRaw = worker?.date_of_cessation?.trim() || '';
    const rejoins = parseRejoinDatesFromWorker(worker);
    const inCompany = !workerIsNotInCompany(worker);

    // Simple cases: no rejoins
    if (rejoins.length === 0) {
        return cessationRaw
            ? [{ start: joined, end: cessationRaw }]
            : [{ start: joined, end: null }];
    }

    const segments = [];

    if (inCompany) {
        // Initial period ends at explicit cessation (if present) or day before first rejoin
        segments.push({
            start: joined,
            end: cessationRaw ? cessationRaw : subtractOneCalendarDay(rejoins[0]),
        });
        // Intermediate rejoin periods: each ends day before the next rejoin
        for (let i = 0; i < rejoins.length - 1; i++) {
            segments.push({ start: rejoins[i], end: subtractOneCalendarDay(rejoins[i + 1]) });
        }
        // Current (open) period
        segments.push({ start: rejoins[rejoins.length - 1], end: null });
    } else {
        // First period ends day before first rejoin (cessation inferred from rejoin date)
        segments.push({ start: joined, end: subtractOneCalendarDay(rejoins[0]) });
        // Intermediate rejoin periods
        for (let i = 0; i < rejoins.length - 1; i++) {
            segments.push({ start: rejoins[i], end: subtractOneCalendarDay(rejoins[i + 1]) });
        }
        // Last period ends at explicit cessation date
        segments.push({ start: rejoins[rejoins.length - 1], end: cessationRaw });
    }

    return segments;
}

/**
 * Whether the worker should receive pay on dateStr (YYYY-MM-DD).
 */
export function getWorkerPayStatus(worker, dateStr) {
    const d = parseIsoDateSafe(dateStr);
    if (d == null) return { eligible: false, label: NEY_LABEL };

    const intervals = buildEmploymentIntervals(worker);
    if (intervals.length === 0) return { eligible: false, label: NEY_LABEL };

    for (const interval of intervals) {
        const start = parseIsoDateSafe(interval.start);
        const end = interval.end ? parseIsoDateSafe(interval.end) : null;
        if (start == null) continue;
        if (d < start) continue;
        if (end != null && d > end) continue;
        return { eligible: true, label: null };
    }

    return { eligible: false, label: NEY_LABEL };
}

export function isWorkerPayEligibleOnDate(worker, dateStr) {
    return getWorkerPayStatus(worker, dateStr).eligible;
}

/** Full calendar month from YYYY-MM. */
export function monthYearToDateRange(monthYear) {
    const [yearStr, monthStr] = String(monthYear).split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const mm = String(month).padStart(2, '0');
    const startDate = `${year}-${mm}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    return { year, month, startDate, endDate };
}

/** Count calendar days in month when worker is pay-eligible. */
export function countEligibleDaysInMonth(worker, year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    let count = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (isWorkerPayEligibleOnDate(worker, dateStr)) count++;
    }
    return count;
}

/**
 * Scale configured working days for partial-month employment (join / cessation / rejoin gaps).
 */
export function getEligibleWorkingDaysInMonth(worker, year, month, configuredWorkingDays) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const eligibleDays = countEligibleDaysInMonth(worker, year, month);
    if (eligibleDays <= 0 || daysInMonth <= 0) return 0;
    const configured = Number(configuredWorkingDays) || 22;
    return configured * (eligibleDays / daysInMonth);
}
