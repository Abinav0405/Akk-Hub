import { formatDateTime } from '@/modules/progress/lib/dates';
import { normalizeSectionLabel } from '@/modules/progress/lib/sectionLabel';

export const OVERLAY_LINE_KEYS = ['datetime', 'site', 'section', 'status', 'address', 'gps'];

export const OVERLAY_LINE_LABELS = {
  datetime: 'Date & time',
  site: 'Site',
  section: 'Section / LCB',
  status: 'Status',
  address: 'Address',
  gps: 'GPS (±accuracy)',
};

export const OVERLAY_POSITIONS = [
  ['tl', 'tc', 'tr'],
  ['ml', 'mc', 'mr'],
  ['bl', 'bc', 'br'],
];

export function isOverlayPosition(value) {
  return OVERLAY_POSITIONS.flat().includes(String(value || ''));
}

export function hasOwnGpsPosition(branding) {
  return Number.isFinite(Number(branding?.gps_x_pct)) && Number.isFinite(Number(branding?.gps_y_pct));
}

export function normalizeOverlayLines(value) {
  const allowed = new Set(OVERLAY_LINE_KEYS);
  const seen = new Set();
  const out = [];
  const raw = Array.isArray(value) ? value : [];
  for (const item of raw) {
    const key = String(item || '').trim().toLowerCase();
    if (allowed.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export function overlayEditorLines(saved) {
  const visible = saved == null ? [...OVERLAY_LINE_KEYS] : normalizeOverlayLines(saved);
  const hidden = OVERLAY_LINE_KEYS.filter((key) => !visible.includes(key));
  return [
    ...visible.map((id) => ({ id, on: true })),
    ...hidden.map((id) => ({ id, on: false })),
  ];
}

export function formatGpsLine(lat, lng, { locating = false, accuracy } = {}) {
  if (lat == null || lng == null) {
    return locating ? 'Locating GPS…' : 'GPS unavailable';
  }
  const coords = `${Math.abs(lat).toFixed(6)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(6)}°${lng >= 0 ? 'E' : 'W'}`;
  if (Number.isFinite(Number(accuracy)) && Number(accuracy) >= 0) {
    return `${coords} (±${Math.round(Number(accuracy))}m)`;
  }
  return coords;
}

export function overlayFieldValues({
  date,
  lat,
  lng,
  accuracy,
  address,
  lcbId,
  sectionLabel,
  siteName,
  stage,
  locating = false,
}) {
  const hasSection = String(lcbId || '').trim().length > 0;
  return {
    datetime: formatDateTime(date),
    site: `Site- ${siteName || 'Unknown site'}`,
    section: hasSection ? `${normalizeSectionLabel(sectionLabel)}- ${lcbId}` : '',
    status: `Status- ${(stage || '').toUpperCase()}`,
    address: address || (locating ? 'Locating address…' : 'Address unavailable'),
    gps: formatGpsLine(lat, lng, { locating, accuracy }),
  };
}

/**
 * Visible overlay lines after admin show/hide + order, split if GPS has its own position.
 * Stack/GPS x/y are % of frame (top-left of each block). GPS accuracy changing
 * lengthens a line but does not move the stored origin.
 */
export function buildOverlayLayout(opts = {}) {
  const branding = opts.branding || {};
  const values = overlayFieldValues(opts);
  const visible = branding.overlay_lines == null
    ? [...OVERLAY_LINE_KEYS]
    : normalizeOverlayLines(branding.overlay_lines);
  const stackPosition = isOverlayPosition(branding.overlay_position) ? branding.overlay_position : 'bl';
  const gpsOwn = hasOwnGpsPosition(branding);

  const stack = [];
  let gps = null;
  for (const key of visible) {
    const text = values[key];
    if (!text) continue;
    if (key === 'gps' && gpsOwn) {
      gps = {
        key,
        text,
        position: branding.gps_position || 'br',
        xPct: Number(branding.gps_x_pct),
        yPct: Number(branding.gps_y_pct),
      };
    } else {
      stack.push({ key, text });
    }
  }
  return {
    stack,
    stackPosition,
    stackXPct: Number.isFinite(Number(branding.overlay_x_pct)) ? Number(branding.overlay_x_pct) : null,
    stackYPct: Number.isFinite(Number(branding.overlay_y_pct)) ? Number(branding.overlay_y_pct) : null,
    stackScalePct: Number.isFinite(Number(branding.overlay_scale_pct)) ? Number(branding.overlay_scale_pct) : 100,
    gps,
  };
}

/**
 * The overlay lines burned into every captured photo (and shown live in the
 * viewfinder before capture) — date/time, then Site/LCB/Status each on their
 * own row, then address, then GPS (±accuracy when the fix reports it).
 */
export function formatOverlayLines(opts) {
  const layout = buildOverlayLayout(opts);
  const lines = layout.stack.map((row) => row.text);
  if (layout.gps) lines.push(layout.gps.text);
  return lines;
}
