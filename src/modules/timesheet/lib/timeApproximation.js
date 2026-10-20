import { formatTime, parseSingaporeInstant } from '@/modules/timesheet/lib/timeUtils';

/**
 * Time Approximation Utility
 * 
 * Rounds scan times according to the following rules:
 * - If minutes < 15: round down to :00
 * - If minutes >= 15 and <= 30: round to :30
 * - If minutes > 30 and < 45: round to :30
 * - If minutes >= 45: round up to next hour :00
 * 
 * Examples:
 * - 8:10 -> 8:00
 * - 8:14 -> 8:00
 * - 8:16 -> 8:30
 * - 8:31 -> 8:30
 * - 8:44 -> 8:30
 * - 8:45 -> 9:00
 * - 8:46 -> 9:00
 */

/**
 * Approximate a time according to the rounding rules, using Asia/Singapore wall clock.
 * SGT is always UTC+8 (no DST), so the offset is a fixed 480 minutes.
 * @param {Date|string} dateTime - The date/time to approximate
 * @returns {Date} - The approximated date/time
 */
export function approximateTime(dateTime) {
    if (!dateTime) return null;

    const date = parseSingaporeInstant(dateTime);
    if (!date) {
        console.error('Invalid date provided to approximateTime:', dateTime);
        return null;
    }
    
    // SGT = UTC+8 (fixed, no DST). Compute SGT minutes within the hour.
    // Since the offset is a whole number of hours, sgtMs % 60000 === utcMs % 60000.
    const utcMs = date.getTime();
    const sgtMs = utcMs + 8 * 60 * 60 * 1000;
    const sgtMinutes = Math.floor(sgtMs / 60000) % 60;
    // Sub-minute portion (seconds + ms) to strip for clean rounding
    const subMinuteMs = sgtMs % 60000; // equals utcMs % 60000 since offset is whole hours

    let deltaMinutes;
    if (sgtMinutes < 15) {
        deltaMinutes = -sgtMinutes;       // round down to :00
    } else if (sgtMinutes < 45) {
        deltaMinutes = 30 - sgtMinutes;   // round to :30
    } else {
        deltaMinutes = 60 - sgtMinutes;   // round up to next :00
    }

    const approximatedMs = utcMs - subMinuteMs + deltaMinutes * 60000;
    return new Date(approximatedMs);
}

/**
 * Approximate a time and return as ISO string
 * @param {Date|string} dateTime - The date/time to approximate
 * @returns {string|null} - The approximated time as ISO string, or null if invalid
 */
export function approximateTimeISO(dateTime) {
    const approximated = approximateTime(dateTime);
    return approximated ? approximated.toISOString() : null;
}

/**
 * Format time for display showing both original and approximated times
 * @param {Date|string} originalTime - The original time
 * @returns {string} - Formatted string showing original -> approximated
 */
export function formatApproximatedTime(originalTime) {
    if (!originalTime) return '';
    
    const original = new Date(originalTime);
    const approximated = approximateTime(originalTime);
    
    if (!approximated) return formatTime(original);
    
    const originalStr = formatTime(original);
    const approxStr = formatTime(approximated);
    
    if (originalStr === approxStr) {
        return originalStr;
    }
    
    return `${originalStr} → ${approxStr}`;
}
