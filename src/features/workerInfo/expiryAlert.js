/**
 * Safety certificate / work permit / ID card expiry — admin list highlight + tooltip text.
 * Dates: core.worker_info.permit_expiry_date, safety_cert_expiry_date;
 *         core.employee_cards.valid_until (active card).
 * 9999-… = "no expiry" (same as fields.js / cardModel).
 */
import { daysUntil, formatValue } from './fields';

export const EXPIRY_ALERT_DAYS = 30;

/** Yellow pill behind the name — readable amber on dark amber text. */
export const EXPIRY_NAME_CLASS = 'rounded-md bg-amber-200 px-1.5 py-0.5 text-amber-950';

const LABELS = {
    permit_expiry_date: 'Work permit',
    safety_cert_expiry_date: 'Safety certificate',
    card_valid_until: 'ID card',
};

/** True when any watched date is already past or within EXPIRY_ALERT_DAYS. */
export function hasExpiryAlert(row) {
    if (!row) return false;
    if (row.expiry_alert === true) return true;
    for (const key of Object.keys(LABELS)) {
        const d = daysUntil(row[key]);
        if (d != null && d <= EXPIRY_ALERT_DAYS) return true;
    }
    return false;
}

/** Tooltip listing which documents are due / past. */
export function expiryAlertTitle(row) {
    if (!row) return 'Document expires within 30 days (or already expired)';
    const bits = [];
    for (const [key, label] of Object.entries(LABELS)) {
        const d = daysUntil(row[key]);
        if (d == null || d > EXPIRY_ALERT_DAYS) continue;
        const when = formatValue(key === 'card_valid_until' ? 'permit_expiry_date' : key, row[key]) || String(row[key]).slice(0, 10);
        bits.push(d < 0 ? `${label} expired ${when}` : `${label} expires ${when} (${d}d)`);
    }
    return bits.length ? bits.join(' · ') : 'Document expires within 30 days (or already expired)';
}

/** Props to spread onto a name `<span>` / button child when highlighting. */
export function expiryNameProps(rowOrAlert) {
    const alert = typeof rowOrAlert === 'boolean' ? rowOrAlert : hasExpiryAlert(rowOrAlert);
    if (!alert) return {};
    return {
        className: EXPIRY_NAME_CLASS,
        title: typeof rowOrAlert === 'object' && rowOrAlert ? expiryAlertTitle(rowOrAlert) : expiryAlertTitle(null),
    };
}
