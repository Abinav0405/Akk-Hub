// Singapore Public Holidays for 2025
export const SINGAPORE_PUBLIC_HOLIDAYS_2025 = [
    '2025-01-01', // New Year's Day - Wednesday
    '2025-01-29', // Chinese New Year - Wednesday
    '2025-01-30', // Chinese New Year - Thursday
    '2025-03-31', // Hari Raya Puasa - Monday
    '2025-04-18', // Good Friday - Friday
    '2025-05-01', // Labour Day - Thursday
    '2025-05-03', // Polling Day - Saturday
    '2025-05-12', // Vesak Day - Monday
    '2025-06-07', // Hari Raya Haji - Saturday
    '2025-08-09', // National Day - Saturday
    '2025-10-20', // Deepavali - Monday
    '2025-12-25', // Christmas Day - Thursday
];

// Singapore Public Holidays for 2026
export const SINGAPORE_PUBLIC_HOLIDAYS_2026 = [
    '2026-01-01', // New Year's Day - Thursday
    '2026-02-17', // Chinese New Year - Tuesday
    '2026-02-18', // Chinese New Year - Wednesday
    '2026-03-21', // Hari Raya Puasa - Saturday
    '2026-04-03', // Good Friday - Friday
    '2026-05-01', // Labour Day - Friday
    '2026-05-27', // Hari Raya Haji - Wednesday
    '2026-05-31', // Vesak Day - Sunday
    '2026-06-01', // Vesak Day (compensatory) - Monday (in lieu of 31 May)
    '2026-08-09', // National Day - Sunday
    '2026-08-10', // National Day (compensatory) - Monday (if rest day falls on 9 Aug)
    '2026-11-08', // Deepavali - Sunday
    '2026-11-09', // Deepavali (compensatory) - Monday (if rest day falls on 8 Nov)
    '2026-12-25', // Christmas Day - Friday
];

/** Extra dates loaded from Supabase `public_holidays` (merged at runtime). */
const extraPublicHolidayDates = new Set();

/** Years for which a missing-holidays warning has already been emitted (once per year). */
const _warnedMissingHolidayYears = new Set();

function previousCalendarDateStr(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
}

/** True if date is explicitly listed in static arrays or Supabase cache. */
function isListedPublicHoliday(dateStr) {
    if (!dateStr) return false;
    if (extraPublicHolidayDates.has(dateStr)) return true;
    const dateYear = parseInt(dateStr.slice(0, 4), 10);
    if (dateYear === 2025) return SINGAPORE_PUBLIC_HOLIDAYS_2025.includes(dateStr);
    if (dateYear === 2026) return SINGAPORE_PUBLIC_HOLIDAYS_2026.includes(dateStr);
    return (
        SINGAPORE_PUBLIC_HOLIDAYS_2025.includes(dateStr) ||
        SINGAPORE_PUBLIC_HOLIDAYS_2026.includes(dateStr)
    );
}

/**
 * MOM rule: if a gazetted PH falls on Sunday, the following Monday is a PH.
 * Catches compensatory days even when not yet added to the static list.
 */
function isMondayInLieuOfSundayHoliday(dateStr) {
    if (getCalendarWeekday(dateStr) !== 1) return false;
    const prevStr = previousCalendarDateStr(dateStr);
    return getCalendarWeekday(prevStr) === 0 && isListedPublicHoliday(prevStr);
}

/** Load holidays from Supabase — call once on app start. */
export async function hydratePublicHolidaysFromSupabase(supabaseClient) {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('public_holidays')
            .select('holiday_date');
        if (error) {
            console.warn('Could not load public_holidays from Supabase:', error.message);
            return;
        }
        (data || []).forEach((row) => {
            const d = toSingaporeDateStr(row.holiday_date);
            if (d) extraPublicHolidayDates.add(d);
        });
    } catch (e) {
        console.warn('hydratePublicHolidaysFromSupabase failed:', e);
    }
}

/** YYYY-MM-DD in Singapore timezone — avoids UTC off-by-one on work_date strings. */
export function toSingaporeDateStr(dateInput) {
    if (!dateInput) return null;
    if (typeof dateInput === 'string') {
        const match = dateInput.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

/** Weekday from calendar date (0 = Sunday). Uses date parts, not local timezone. */
export function getCalendarWeekday(dateInput) {
    const dateStr = toSingaporeDateStr(dateInput);
    if (!dateStr) return -1;
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Check if a date is a Sunday (Singapore calendar date)
 */
export function isSunday(dateInput) {
    return getCalendarWeekday(dateInput) === 0;
}

/**
 * Check if a date is a public holiday (Singapore calendar date).
 * Emits a one-time console.warn per calendar year when year > 2026 and no
 * holidays for that year have been loaded into extraPublicHolidayDates.
 */
export function isPublicHoliday(dateInput, year = null) {
    const dateStr = toSingaporeDateStr(dateInput);
    if (!dateStr) return false;

    const dateYear = parseInt(dateStr.slice(0, 4), 10);
    if (dateYear > 2026 && !_warnedMissingHolidayYears.has(dateYear)) {
        const hasCustomForYear = [...extraPublicHolidayDates].some((d) => d.startsWith(String(dateYear)));
        if (!hasCustomForYear) {
            console.warn(
                `[timeUtils] No public holidays loaded for ${dateYear}. ` +
                `Update the static list or add rows via hydratePublicHolidaysFromSupabase.`
            );
            _warnedMissingHolidayYears.add(dateYear);
        }
    }

    if (isListedPublicHoliday(dateStr)) return true;
    if (isMondayInLieuOfSundayHoliday(dateStr)) return true;
    void year;
    return false;
}

/**
 * Unworked weekday PH is credited as 8 basic hours.
 * A PH on Sunday is a rest day — MOM pay is the Monday in lieu, not an extra Sunday basic day.
 */
export function shouldCreditUnworkedPublicHoliday(dateInput) {
    const dateStr = toSingaporeDateStr(dateInput);
    if (!dateStr) return false;
    if (!isPublicHoliday(dateStr)) return false;
    if (isSunday(dateStr)) return false;
    return true;
}

export function unworkedPublicHolidayCreditHours(dateInput) {
    return shouldCreditUnworkedPublicHoliday(dateInput) ? 8 : 0;
}

/**
 * Calculate time difference in hours
 */
export function calculateHours(startTime, endTime) {
    if (!startTime || !endTime) return 0;

    const start = new Date(startTime);
    const end = new Date(endTime);

    const diffMs = end - start;
    const diffHours = diffMs / (1000 * 60 * 60);

    return Math.max(0, diffHours);
}

/**
 * Calculate time difference in minutes
 */
export function calculateMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;

    const start = new Date(startTime);
    const end = new Date(endTime);

    const diffMs = end - start;
    const diffMinutes = diffMs / (1000 * 60);

    return Math.max(0, diffMinutes);
}

/**
 * Break hours that count against a shift. Open breaks (no break_end) run through
 * leaveTime so clock-out does not treat lunch as worked time (ATT-01).
 */
export function sumBreakHours(breaks = [], leaveTime = null) {
    let hours = 0;
    const leaveMs = leaveTime ? new Date(leaveTime).getTime() : NaN;
    for (const breakItem of breaks || []) {
        if (!breakItem?.break_start) continue;
        const startMs = new Date(breakItem.break_start).getTime();
        if (!Number.isFinite(startMs)) continue;
        let endMs = breakItem.break_end ? new Date(breakItem.break_end).getTime() : NaN;
        if (!Number.isFinite(endMs) && Number.isFinite(leaveMs)) endMs = leaveMs;
        if (!Number.isFinite(endMs)) continue;
        if (Number.isFinite(leaveMs)) endMs = Math.min(endMs, leaveMs);
        hours += Math.max(0, (endMs - startMs) / (1000 * 60 * 60));
    }
    return hours;
}

function breakWindowOverlaps(startMs, endMs, existingBreaks, leaveTime) {
    const leaveMs = leaveTime ? new Date(leaveTime).getTime() : Infinity;
    return (existingBreaks || []).some((b) => {
        if (!b?.break_start) return false;
        const bStart = new Date(b.break_start).getTime();
        if (!Number.isFinite(bStart)) return false;
        let bEnd = b.break_end ? new Date(b.break_end).getTime() : leaveMs;
        if (!Number.isFinite(bEnd)) bEnd = leaveMs;
        return startMs < bEnd && endMs > bStart;
    });
}

/**
 * Get auto-breaks to create when breaks can't be scanned (e.g. remote sites).
 * Rules:
 * - Shift <= 6 hours: no breaks required
 * - 6 < shift <= 14 hours: 1 hour of break required
 * - Shift > 14 hours: 2 hours of break required
 * - Existing break *duration* counts (ATT-02). A 5-minute scan does not skip the rest.
 * - Open breaks count through leaveTime (ATT-01).
 *
 * @param {Date|string} entryTime - Shift entry time
 * @param {Date|string} leaveTime - Shift exit time
 * @param {Array} existingBreaks - Array of break objects with break_start, break_end
 * @returns {Array} Array of { break_start, break_end } ISO strings to insert
 */
export function getAutoBreaksToCreate(entryTime, leaveTime, existingBreaks = []) {
    if (!entryTime || !leaveTime) return [];

    const totalDurationHours = calculateHours(entryTime, leaveTime);
    if (totalDurationHours <= 6) return [];

    const requiredBreakHours = totalDurationHours > 14 ? 2 : 1;
    let shortfallHours = requiredBreakHours - sumBreakHours(existingBreaks, leaveTime);
    if (shortfallHours <= 0.001) return [];

    const entry = new Date(entryTime);
    const leaveMs = new Date(leaveTime).getTime();
    const marksHours = totalDurationHours > 14 ? [4, 12] : [4];
    const breaksToCreate = [];

    const tryPushSlot = (start, durationHours) => {
        if (durationHours <= 0.001) return 0;
        const startMs = start.getTime();
        if (!Number.isFinite(startMs) || startMs >= leaveMs) return 0;
        const wantedEndMs = startMs + durationHours * 60 * 60 * 1000;
        const endMs = Math.min(wantedEndMs, leaveMs);
        if (endMs <= startMs) return 0;
        if (breakWindowOverlaps(startMs, endMs, [...(existingBreaks || []), ...breaksToCreate], leaveTime)) {
            return 0;
        }
        breaksToCreate.push({
            break_start: start.toISOString(),
            break_end: new Date(endMs).toISOString(),
        });
        return (endMs - startMs) / (1000 * 60 * 60);
    };

    for (const mark of marksHours) {
        if (shortfallHours <= 0.001) break;
        const placed = tryPushSlot(
            new Date(entry.getTime() + mark * 60 * 60 * 1000),
            Math.min(1, shortfallHours),
        );
        shortfallHours -= placed;
    }

    // If 4h/12h marks overlapped an existing short break, place remaining after last break.
    while (shortfallHours > 0.001) {
        let lastEnd = entry.getTime();
        for (const b of [...(existingBreaks || []), ...breaksToCreate]) {
            if (!b?.break_start) continue;
            const bEnd = new Date(b.break_end || leaveTime).getTime();
            if (Number.isFinite(bEnd)) lastEnd = Math.max(lastEnd, bEnd);
        }
        const placed = tryPushSlot(new Date(lastEnd), Math.min(1, shortfallHours));
        if (placed <= 0.001) break;
        shortfallHours -= placed;
    }

    return breaksToCreate;
}

/**
 * Calculate worked hours, OT hours, and sunday hours according to the new rules
 * Supports both old lunch_start/lunch_end format and new breaks array format
 * 
 * New Logic Implementation:
 * - Sunday: not worked → 0 hours
 * - Sunday: worked → Sunday hours only
 * - Weekday PH: not worked → 8 basic hours
 * - Sunday PH: not worked → 0 hours (Monday in lieu is the paid PH)
 * - Any PH: worked → Sunday/PH hours only (no extra 8h basic)
 * - Normal: not worked → 0 hours
 * - Normal: worked → Basic + OT
 */
export function calculateShiftHours(entryTime, leaveTime, breaksOrLunchStart = [], workDate, lunchEnd = null) {
    if (!entryTime || !leaveTime) {
        return {
            basicHours: 0,
            sundayHours: 0,
            otHours: 0,
            totalDuration: 0,
            netWorkedHours: 0,
            breakHours: 0,
            basicDay: 0
        };
    }

    const isSundayDay = isSunday(workDate);
    const isHoliday = isPublicHoliday(workDate);

    // Calculate total duration from entry to leave (supports overnight)
    const totalDuration = calculateHours(entryTime, leaveTime);

    // Calculate total break hours - handle both old and new formats
    let totalBreakHours = 0;

    // Check if it's the old format (lunch_start as string, lunch_end as parameter)
    if (typeof breaksOrLunchStart === 'string' && lunchEnd) {
        // Old format: lunch_start and lunch_end as separate parameters
        if (breaksOrLunchStart && lunchEnd) {
            totalBreakHours = calculateHours(breaksOrLunchStart, lunchEnd);
        }
    } else if (breaksOrLunchStart && Array.isArray(breaksOrLunchStart) && breaksOrLunchStart.length > 0) {
        // Open breaks count through leaveTime so unpaid lunch is not paid as work (ATT-01)
        totalBreakHours = sumBreakHours(breaksOrLunchStart, leaveTime);
    }

    // Calculate net worked hours (total duration minus all breaks)
    const netWorkedHours = Math.max(0, totalDuration - totalBreakHours);

    let basicHours = 0;
    let otHours = 0;
    let sundayHours = 0;
    let basicDay = 0;

    if (isHoliday) {
        if (netWorkedHours > 0) {
            // Worked PH (weekday or Sunday) → Sun/PH hours only, never extra basic
            sundayHours = netWorkedHours;
            basicHours = 0;
            otHours = 0;
            basicDay = 0;
        } else {
            // Unworked PH: weekday → 8 basic; Sunday rest day → 0 (Monday in lieu)
            basicHours = unworkedPublicHolidayCreditHours(workDate);
            sundayHours = 0;
            otHours = 0;
            basicDay = basicHours / 8;
        }
    } else if (isSundayDay) {
        // Sunday logic (ordinary Sunday, not a PH)
        if (netWorkedHours > 0) {
            // Sunday: ✅ worked → Sunday hours only
            sundayHours = netWorkedHours;
            basicHours = 0;
            otHours = 0;
            basicDay = 0;
        } else {
            // Sunday: ❌ worked → 0 hours
            basicHours = 0;
            sundayHours = 0;
            otHours = 0;
            basicDay = 0;
        }
    } else {
        // Normal day logic
        if (netWorkedHours > 0) {
            // Normal: ✅ worked → Basic + OT
            basicHours = Math.min(8, netWorkedHours);
            otHours = Math.max(0, netWorkedHours - 8);
            sundayHours = 0;
            basicDay = basicHours / 8;
        } else {
            // Normal: ❌ worked → 0 hours
            basicHours = 0;
            sundayHours = 0;
            otHours = 0;
            basicDay = 0;
        }
    }

    // Round to 2 decimal places
    const roundedBasicHours = Math.round(basicHours * 100) / 100;
    const roundedSundayHours = Math.round(sundayHours * 100) / 100;
    const roundedOtHours = Math.round(otHours * 100) / 100;
    const roundedTotalDuration = Math.round(totalDuration * 100) / 100;
    const roundedNetWorkedHours = Math.round(netWorkedHours * 100) / 100;
    const roundedBreakHours = Math.round(totalBreakHours * 100) / 100;
    const roundedBasicDay = Math.round(basicDay * 100) / 100;

    return {
        basicHours: roundedBasicHours,
        sundayHours: roundedSundayHours,
        otHours: roundedOtHours,
        totalDuration: roundedTotalDuration,
        netWorkedHours: roundedNetWorkedHours,
        breakHours: roundedBreakHours,
        basicDay: roundedBasicDay
    };
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    return distance * 1000; // Convert to meters
}

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(n) {
    return String(n).padStart(2, '0');
}

const NAIVE_DATE_RE = /^(\d{4}-\d{2}-\d{2})$/;
const NAIVE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/**
 * Parse a timestamp as an absolute instant.
 * Timezone-less date/datetime strings are Singapore wall clock, not the device TZ.
 * That stops 08:30 SGT becoming 20:30 on US-Eastern browsers / Android WebViews.
 */
export function parseSingaporeInstant(dateInput = new Date()) {
    if (dateInput == null || dateInput === '') return null;
    if (dateInput instanceof Date) {
        return Number.isNaN(dateInput.getTime()) ? null : dateInput;
    }
    if (typeof dateInput === 'number') {
        const d = new Date(dateInput);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateInput !== 'string') {
        const d = new Date(dateInput);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const s = dateInput.trim();
    const dateOnly = NAIVE_DATE_RE.exec(s);
    if (dateOnly) {
        const d = new Date(`${dateOnly[1]}T00:00:00+08:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const naive = NAIVE_DATETIME_RE.exec(s);
    if (naive) {
        const time = naive[2].length === 5 ? `${naive[2]}:00` : naive[2];
        const d = new Date(`${naive[1]}T${time}+08:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Singapore wall-clock parts from an instant. Does NOT use Intl hour formatting
 * (Android WebViews can ignore hour12:false and show 08:30 as 20:30).
 * SGT is UTC+8 with no DST, so UTC fields of (instant+8h) are the SG clock.
 */
export function getSingaporeWallClock(dateInput = new Date()) {
    const date = parseSingaporeInstant(dateInput);
    if (!date) return null;
    const sgt = new Date(date.getTime() + SGT_OFFSET_MS);
    const year = sgt.getUTCFullYear();
    const month = sgt.getUTCMonth() + 1;
    const day = sgt.getUTCDate();
    const hour = sgt.getUTCHours();
    const minute = sgt.getUTCMinutes();
    const second = sgt.getUTCSeconds();
    return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        ymd: `${year}-${pad2(month)}-${pad2(day)}`,
        hm: `${pad2(hour)}:${pad2(minute)}`,
        hms: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
        datetimeLocal: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`,
    };
}

/**
 * Format time for display (HH:mm) in 24-hour Singapore time
 */
export function formatTime(dateTime) {
    if (!dateTime) return '';
    return getSingaporeWallClock(dateTime)?.hm || '';
}

/**
 * Format date for display (DD/MM/YYYY) in Singapore calendar
 */
export function formatDate(date) {
    if (!date) return '';
    const p = getSingaporeWallClock(date);
    if (!p) return '';
    return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

/**
 * Get today's date in Singapore timezone (YYYY-MM-DD format)
 */
export function getTodaySingapore() {
    return getSingaporeWallClock(new Date())?.ymd || '';
}

/**
 * Extract work date from a datetime string in Singapore timezone (YYYY-MM-DD format)
 */
export function getWorkDateFromDateTime(dateTime) {
    if (!dateTime) return null;
    return getSingaporeWallClock(dateTime)?.ymd || null;
}

/** YYYY-MM-DD plus calendar days (Singapore date, no TZ drift). */
export function addDaysToYmd(ymd, days) {
    const [y, m, d] = String(ymd || '').split('-').map(Number);
    if (!y || !m || !d) return '';
    const utc = new Date(Date.UTC(y, m - 1, d + Number(days)));
    return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/** Last calendar day of a 1-indexed month (YYYY-MM-DD). Avoids local-TZ toISOString drift. */
export function ymdEndOfMonth(year, month1to12) {
    const y = Number(year);
    const m = Number(month1to12);
    if (!y || !m) return '';
    const utc = new Date(Date.UTC(y, m, 0));
    return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/** First day of the month after a 1-indexed month (YYYY-MM-DD). */
export function ymdStartOfNextMonth(year, month1to12) {
    const y = Number(year);
    const m = Number(month1to12);
    if (!y || !m) return '';
    const utc = new Date(Date.UTC(y, m, 1));
    return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/**
 * Check if a shift is complete (has leave time)
 */
export function isShiftComplete(shift) {
    return shift && shift.has_left && shift.leave_time;
}

const PAID_LEAVE_TYPES_FOR_DAY_COUNT = [
    'Annual Leave',
    'Maternity Leave',
    'Paternity Leave',
    'Shared Parental Leave',
    'Childcare Leave',
    'Medical Leave',
    'Hospitalization Leave',
    'National Service (NS) Leave',
    'Adoption Leave',
    'Non-Statutory Leave (Employer Provided)',
    'Compassionate / Bereavement Leave',
    'Marriage Leave',
    'Study / Exam Leave',
    'Birthday Leave',
    'Mental Health Day',
    'Volunteer Leave',
];

/** Parse YYYY-MM-DD (or ISO) as local calendar date (no UTC drift). */
export function parseDateOnly(dateInput) {
    if (!dateInput) return null;
    const s = String(dateInput).split('T')[0];
    const parts = s.split('-').map((n) => parseInt(n, 10));
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
        return new Date(dateInput);
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Leave days for UI / payslip alignment: paid leave excludes Sundays/PH; unpaid uses all calendar days.
 * Prefers stored days_requested from submission when present.
 * Half-day leave matches getChargeableLeaveDates: only the first chargeable date counts (0.5).
 */
export function countLeaveDaysForDisplay({
    from_date,
    to_date,
    leave_type,
    leave_duration,
    days_requested,
}) {
    const from = parseDateOnly(from_date);
    const to = parseDateOnly(to_date);
    if (!from || !to || to < from) {
        const storedOnly =
            days_requested != null && days_requested !== '' ? Number(days_requested) : NaN;
        return Number.isFinite(storedOnly) && storedOnly > 0 ? storedOnly : 0;
    }

    const excludeNonWorkingDays = PAID_LEAVE_TYPES_FOR_DAY_COUNT.includes(leave_type);
    const isHalfDay = leave_duration?.includes('half_day');
    let days = 0;

    for (let cur = new Date(from); cur <= to; cur.setDate(cur.getDate() + 1)) {
        if (excludeNonWorkingDays && (isSunday(cur) || isPublicHoliday(cur))) continue;
        days += 1;
        // Same rule as getChargeableLeaveDates: half-day uses only the first chargeable date
        if (isHalfDay) {
            days = 0.5;
            break;
        }
    }

    const stored =
        days_requested != null && days_requested !== '' ? Number(days_requested) : NaN;
    if (Number.isFinite(stored) && stored > 0) {
        // Selected dates win — never display more days than the range contains.
        return Math.min(stored, days || stored);
    }

    return days;
}
