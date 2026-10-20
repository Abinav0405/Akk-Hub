/** Display dates as dd/mm/yyyy throughout the app. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
/** The business's home timezone — timestamps are always shown in this zone,
 *  not the viewer's own, so the same value reads the same day for everyone. */
const APP_TIME_ZONE = 'Asia/Singapore';

function pad(n) {
  return String(n).padStart(2, '0');
}

/** True for a plain YYYY-MM-DD (no time component) — not a real instant, so it
 *  has no timezone to convert; it was built as a local calendar date on purpose. */
function isDateOnly(value) {
  if (value instanceof Date) return false;
  const s = String(value).trim();
  return ISO_DATE.test(s) && !s.includes('T') && s.length <= 10;
}

/** Parse a Date, ISO timestamp, or YYYY-MM-DD as a local calendar date. */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  const m = s.match(ISO_DATE);
  if (m && !s.includes('T') && s.length <= 10) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar/time fields to render `d` with. A date-only value has no real
 * timezone attached — parseDate already built it at local midnight, so local
 * getters read it back correctly. A real instant (a Date object, or a full ISO
 * timestamp string) is read in Asia/Singapore instead of the viewer's own
 * timezone, so it can't land on the wrong calendar day for anyone outside SGT.
 */
function partsFor(value, d) {
  if (isDateOnly(value)) {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const raw = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hour: raw.hour === '24' ? 0 : Number(raw.hour), // some engines return "24" for midnight with hour12:false
    minute: Number(raw.minute),
    second: Number(raw.second),
  };
}

/** e.g. 10/09/2026 */
export function formatDate(value) {
  const d = parseDate(value);
  if (!d) return '';
  const p = partsFor(value, d);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** e.g. 10/09/2026 14:05:09 — pass { seconds: false } to drop seconds. */
export function formatDateTime(value, { seconds = true } = {}) {
  const d = parseDate(value);
  if (!d) return '';
  const p = partsFor(value, d);
  const time = seconds
    ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    : `${pad(p.hour)}:${pad(p.minute)}`;
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${time}`;
}

/** Local calendar date as YYYY-MM-DD (for <input type="date"> and API payloads). */
export function toIsoDate(value = new Date()) {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso() {
  return toIsoDate(new Date());
}

/** Filename-safe dd-mm-yyyy. */
export function formatDateFile(value) {
  return formatDate(value).replaceAll('/', '-');
}

/** Today's calendar date in Asia/Singapore as YYYY-MM-DD. */
export function singaporeTodayIso() {
  const raw = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return `${raw.year}-${raw.month}-${raw.day}`;
}

/** Add whole calendar days to a YYYY-MM-DD value (date-only, not an instant). */
export function addCalendarDays(iso, days) {
  const d = parseDate(iso);
  if (!d) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return toIsoDate(d);
}

/** Calendar date in Asia/Singapore for a timestamp, or the YYYY-MM-DD as-is. */
export function singaporeIsoFromInstant(value) {
  if (!value) return '';
  if (isDateOnly(value)) {
    const m = String(value).trim().match(ISO_DATE);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }
  const d = parseDate(value);
  if (!d) return '';
  const p = partsFor(value, d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
