import { supabaseProgress } from '@/core/supabase'
import { portalManagerToken } from '@/core/auth/progress/portalAuth';

import { OVERLAY_LINE_KEYS, isOverlayPosition, normalizeOverlayLines } from '@/modules/progress/lib/overlayText';
import { DEFAULT_DOCUMENT_CHROME, normalizeDocumentChrome } from '@/modules/progress/lib/documentChrome';

/**
 * Default branding. Positions are % of the photo frame; the anchor for every
 * unit is the TOP-LEFT of that unit’s bounding box. These values are stored
 * and reused as-is — never recomputed from GPS accuracy or a 3×3 grid.
 */
export const DEFAULT_BRANDING = {
  company_name: 'AKK ENGINEERING PTE. LTD.',
  company_address: '15 Kaki Bukit Rd 4, #01-50, Singapore 417808',
  logo_path: null,
  logo_size_pct: 8,
  logo_opacity_pct: 92,
  logo_position: 'br',
  overlay_position: 'bl',
  overlay_lines: [...OVERLAY_LINE_KEYS],
  gps_position: null,
  logo_x_pct: 72,
  logo_y_pct: 72,
  overlay_x_pct: 3,
  overlay_y_pct: 72,
  overlay_scale_pct: 100,
  gps_x_pct: null,
  gps_y_pct: null,
  verify_x_pct: 78,
  verify_y_pct: 0,
  verify_scale_pct: 100,
  document_chrome: { ...DEFAULT_DOCUMENT_CHROME },
  updated_at: null,
};

/** Dummy code for admin / viewfinder barcode placement (not burned into photos). */
export const PREVIEW_VERIFY_CODE = '7K9M-2XQ4';

export const LOGO_SIZE_MIN = 2;
export const LOGO_SIZE_MAX = 30;
export const OVERLAY_SCALE_MIN = 50;
export const OVERLAY_SCALE_MAX = 220;
export const VERIFY_SCALE_MIN = 50;
export const VERIFY_SCALE_MAX = 220;

export const LOGO_POSITIONS = [
  ['tl', 'tc', 'tr'],
  ['ml', 'mc', 'mr'],
  ['bl', 'bc', 'br'],
];

export const LOGO_POSITION_LABELS = {
  t: 'top',
  m: 'middle',
  b: 'bottom',
  l: 'left',
  c: 'center',
  r: 'right',
};

const CELL_PCT = {
  tl: [4, 4],
  tc: [38, 4],
  tr: [72, 4],
  ml: [4, 42],
  mc: [38, 42],
  mr: [72, 42],
  bl: [3, 72],
  bc: [38, 72],
  br: [72, 72],
};

/** URL-safe Progress fallback — do not use `/akk-logo.png` (collides with Timesheet `Akk-logo.png` on Windows). */
const FALLBACK_LOGO = '/akk-logo-progress.png';
const CACHE_MS = 60_000;

let cachedBranding = null;
let cachedAt = 0;

export function invalidateBrandingCache() {
  cachedBranding = null;
  cachedAt = 0;
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function clampPct(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export function hasFinitePct(value) {
  return Number.isFinite(Number(value));
}

export { hasOwnGpsPosition } from '@/modules/progress/lib/overlayText';

export function isLogoPosition(value) {
  return ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(String(value || ''));
}

export function cellToPct(cell, fallback = [4, 72]) {
  return CELL_PCT[cell] || fallback;
}

/** Coarse 3×3 backup from a free-drag percent. Not used to place units. */
export function pctToCell(xPct, yPct) {
  const x = clampPct(xPct, 50);
  const y = clampPct(yPct, 50);
  const v = y < 33 ? 't' : y < 66 ? 'm' : 'b';
  const h = x < 33 ? 'l' : x < 66 ? 'c' : 'r';
  return `${v}${h}`;
}

function pctFromRow(row, xKey, yKey, cell, fallbackCell) {
  if (hasFinitePct(row?.[xKey]) && hasFinitePct(row?.[yKey])) {
    return [clampPct(row[xKey], 0), clampPct(row[yKey], 0)];
  }
  const key = (isOverlayPosition(cell) || isLogoPosition(cell)) ? cell : fallbackCell;
  return cellToPct(key, cellToPct(fallbackCell));
}

function normalizeBranding(row) {
  if (!row) return { ...DEFAULT_BRANDING, overlay_lines: [...OVERLAY_LINE_KEYS] };
  const overlayLines = row.overlay_lines == null
    ? [...OVERLAY_LINE_KEYS]
    : normalizeOverlayLines(row.overlay_lines);
  const logoCell = isLogoPosition(row.logo_position) ? row.logo_position : DEFAULT_BRANDING.logo_position;
  const overlayCell = isOverlayPosition(row.overlay_position) ? row.overlay_position : DEFAULT_BRANDING.overlay_position;
  const [logoX, logoY] = pctFromRow(row, 'logo_x_pct', 'logo_y_pct', logoCell, 'br');
  const [overlayX, overlayY] = pctFromRow(row, 'overlay_x_pct', 'overlay_y_pct', overlayCell, 'bl');
  const gpsOwn = hasFinitePct(row.gps_x_pct) && hasFinitePct(row.gps_y_pct);
  const gpsCell = isOverlayPosition(row.gps_position) ? row.gps_position : null;
  let gpsX = null;
  let gpsY = null;
  if (gpsOwn) {
    gpsX = clampPct(row.gps_x_pct, 62);
    gpsY = clampPct(row.gps_y_pct, 86);
  } else if (gpsCell) {
    const mapped = cellToPct(gpsCell, [62, 86]);
    gpsX = mapped[0];
    gpsY = mapped[1];
  }
  const [verifyX, verifyY] = hasFinitePct(row.verify_x_pct) && hasFinitePct(row.verify_y_pct)
    ? [clampPct(row.verify_x_pct, 78), clampPct(row.verify_y_pct, 0)]
    : [DEFAULT_BRANDING.verify_x_pct, DEFAULT_BRANDING.verify_y_pct];

  return {
    company_name: String(row.company_name || '').trim() || DEFAULT_BRANDING.company_name,
    company_address: String(row.company_address || '').trim() || DEFAULT_BRANDING.company_address,
    logo_path: row.logo_path || null,
    logo_size_pct: clampInt(row.logo_size_pct, LOGO_SIZE_MIN, LOGO_SIZE_MAX, DEFAULT_BRANDING.logo_size_pct),
    logo_opacity_pct: clampInt(row.logo_opacity_pct, 40, 100, DEFAULT_BRANDING.logo_opacity_pct),
    logo_position: logoCell,
    overlay_position: overlayCell,
    overlay_lines: overlayLines,
    gps_position: gpsX != null ? (gpsCell || pctToCell(gpsX, gpsY)) : null,
    logo_x_pct: logoX,
    logo_y_pct: logoY,
    overlay_x_pct: overlayX,
    overlay_y_pct: overlayY,
    overlay_scale_pct: clampInt(row.overlay_scale_pct, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX, 100),
    gps_x_pct: gpsX,
    gps_y_pct: gpsY,
    verify_x_pct: verifyX,
    verify_y_pct: verifyY,
    verify_scale_pct: clampInt(row.verify_scale_pct, VERIFY_SCALE_MIN, VERIFY_SCALE_MAX, 100),
    document_chrome: normalizeDocumentChrome(row.document_chrome),
    updated_at: row.updated_at || null,
  };
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export async function getCompanyBranding({ force = false } = {}) {
  if (!force && cachedBranding && Date.now() - cachedAt < CACHE_MS) {
    return cachedBranding;
  }
  try {
    const { data, error } = await supabaseProgress.rpc('get_company_branding');
    if (error) throw error;
    cachedBranding = normalizeBranding(firstRow(data));
    cachedAt = Date.now();
    return cachedBranding;
  } catch (e) {
    console.warn('[branding] could not load company branding:', e);
    if (cachedBranding) return cachedBranding;
    return { ...DEFAULT_BRANDING };
  }
}

export async function staffGetCompanyBranding() {
  const { data, error } = await supabaseProgress.rpc('staff_get_company_branding', {
    p_manager_token: portalManagerToken(),
  });
  if (error) throw error;
  const branding = normalizeBranding(firstRow(data));
  cachedBranding = branding;
  cachedAt = Date.now();
  return branding;
}

export async function staffUpdateCompanyBranding({
  companyName,
  companyAddress,
  logoPath,
  logoSizePct,
  logoOpacityPct,
  logoPosition,
  overlayPosition,
  overlayLines,
  gpsPosition,
  logoXPct,
  logoYPct,
  overlayXPct,
  overlayYPct,
  overlayScalePct,
  gpsXPct,
  gpsYPct,
  verifyXPct,
  verifyYPct,
  verifyScalePct,
  documentChrome,
}) {
  const logoX = clampPct(logoXPct, DEFAULT_BRANDING.logo_x_pct);
  const logoY = clampPct(logoYPct, DEFAULT_BRANDING.logo_y_pct);
  const overlayX = clampPct(overlayXPct, DEFAULT_BRANDING.overlay_x_pct);
  const overlayY = clampPct(overlayYPct, DEFAULT_BRANDING.overlay_y_pct);
  const gpsOwn = hasFinitePct(gpsXPct) && hasFinitePct(gpsYPct);
  const gpsX = gpsOwn ? clampPct(gpsXPct, 62) : null;
  const gpsY = gpsOwn ? clampPct(gpsYPct, 86) : null;
  const verifyX = clampPct(verifyXPct, DEFAULT_BRANDING.verify_x_pct);
  const verifyY = clampPct(verifyYPct, DEFAULT_BRANDING.verify_y_pct);
  const { error } = await supabaseProgress.rpc('staff_update_company_branding', {
    p_company_name: companyName,
    p_company_address: companyAddress,
    p_logo_path: logoPath ?? null,
    p_logo_size_pct: clampInt(logoSizePct, LOGO_SIZE_MIN, LOGO_SIZE_MAX, 8),
    p_logo_opacity_pct: clampInt(logoOpacityPct, 40, 100, 92),
    p_logo_position: isLogoPosition(logoPosition) ? logoPosition : pctToCell(logoX, logoY),
    p_manager_token: portalManagerToken(),
    p_overlay_position: isOverlayPosition(overlayPosition) ? overlayPosition : pctToCell(overlayX, overlayY),
    p_overlay_lines: overlayLines ?? [...OVERLAY_LINE_KEYS],
    p_gps_position: gpsOwn ? (gpsPosition || pctToCell(gpsX, gpsY)) : null,
    p_logo_x_pct: logoX,
    p_logo_y_pct: logoY,
    p_overlay_x_pct: overlayX,
    p_overlay_y_pct: overlayY,
    p_overlay_scale_pct: clampInt(overlayScalePct, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX, 100),
    p_gps_x_pct: gpsX,
    p_gps_y_pct: gpsY,
    p_verify_x_pct: verifyX,
    p_verify_y_pct: verifyY,
    p_verify_scale_pct: clampInt(verifyScalePct, VERIFY_SCALE_MIN, VERIFY_SCALE_MAX, 100),
    p_document_chrome: normalizeDocumentChrome(documentChrome),
  });
  if (error) throw error;
  invalidateBrandingCache();
}

export function brandingLogoUrl(branding) {
  const path = branding?.logo_path;
  if (!path) return FALLBACK_LOGO;
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return FALLBACK_LOGO;
  const bust = branding?.updated_at ? `?v=${encodeURIComponent(String(branding.updated_at))}` : '';
  return `${base}/storage/v1/object/public/company-branding/${path}${bust}`;
}

export async function uploadCompanyLogo(file) {
  const png = await fileToPngBlob(file);
  const path = 'logo.png';
  const { error } = await supabaseProgress.storage
    .from('company-branding')
    .upload(path, png, { contentType: 'image/png', upsert: true });
  if (error) throw error;
  return path;
}

export async function removeCompanyLogoFile(path = 'logo.png') {
  if (!path) return;
  const { error } = await supabaseProgress.storage.from('company-branding').remove([path]);
  if (error) console.warn('[branding] could not remove logo file:', error);
}

async function fileToPngBlob(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read that image'));
      el.src = url;
    });
    const max = 1024;
    const scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode logo'))), 'image/png');
    });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function brandingLogoDataUrl(branding) {
  const src = brandingLogoUrl(branding);
  try {
    const img = await loadHtmlImage(src);
    const sourceW = img.naturalWidth || img.width || 128;
    const sourceH = img.naturalHeight || img.height || 128;
    const size = Math.max(sourceW, sourceH, 192);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const scale = Math.min(size / sourceW, size / sourceH);
    const dw = sourceW * scale;
    const dh = sourceH * scale;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('[branding] could not rasterize logo:', e);
    return '';
  }
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load logo'));
    img.src = src;
  });
}

export const OVERLAY_FRAME_STYLE = {
  containerType: 'size',
  containerName: 'spt-overlay',
};

/** Flex unit (logo + company name) — top-left of the unit, % of frame. */
export function brandMarkLiveStyle(branding) {
  const x = clampPct(branding?.logo_x_pct, DEFAULT_BRANDING.logo_x_pct);
  const y = clampPct(branding?.logo_y_pct, DEFAULT_BRANDING.logo_y_pct);
  const sizePct = clampInt(branding?.logo_size_pct, LOGO_SIZE_MIN, LOGO_SIZE_MAX, 8);
  const nameCqi = Math.max(0.7, 1.8 * (sizePct / 8));
  return {
    position: 'absolute',
    zIndex: 2,
    left: `${x}%`,
    top: `${y}%`,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: `${Math.max(0.25, 0.4 * (sizePct / 8))}cqi`,
    width: 'max-content',
    maxWidth: '92%',
    pointerEvents: 'none',
    color: '#fff',
    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
    textAlign: 'left',
    fontSize: `${nameCqi}cqi`,
    lineHeight: 1.15,
    fontWeight: 700,
    opacity: clampInt(branding?.logo_opacity_pct, 40, 100, 92) / 100,
  };
}

export function brandMarkLogoLiveStyle(branding) {
  const sizePct = clampInt(branding?.logo_size_pct, LOGO_SIZE_MIN, LOGO_SIZE_MAX, 8);
  return {
    width: `${sizePct}cqi`,
    height: 'auto',
    flexShrink: 0,
    objectFit: 'contain',
    filter: 'brightness(1.2) contrast(1.08)',
  };
}

export function overlayBlockLiveStyle(branding, { xPct, yPct } = {}) {
  const x = clampPct(xPct ?? branding?.overlay_x_pct, DEFAULT_BRANDING.overlay_x_pct);
  const y = clampPct(yPct ?? branding?.overlay_y_pct, DEFAULT_BRANDING.overlay_y_pct);
  const scale = clampInt(branding?.overlay_scale_pct, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX, 100) / 100;
  return {
    position: 'absolute',
    zIndex: 3,
    left: `${x}%`,
    top: `${y}%`,
    pointerEvents: 'none',
    maxWidth: '78%',
    width: 'max-content',
    padding: `${2.5 * scale}cqi ${2.8 * scale}cqi`,
    borderRadius: `${0.8 * scale}cqi`,
    background: 'rgba(0,0,0,0.45)',
    color: '#fff',
    textShadow: '0 1px 2px rgba(0,0,0,0.75)',
    textAlign: 'left',
    fontSize: `${1.6 * scale}cqi`,
    lineHeight: 1.2,
  };
}

export function verifyMarkLiveStyle(branding, plate) {
  const x = clampPct(branding?.verify_x_pct, DEFAULT_BRANDING.verify_x_pct);
  const y = clampPct(branding?.verify_y_pct, DEFAULT_BRANDING.verify_y_pct);
  const style = {
    position: 'absolute',
    zIndex: 4,
    left: `${x}%`,
    top: `${y}%`,
    pointerEvents: 'none',
    lineHeight: 0,
  };
  if (plate?.width && plate?.height) {
    style.width = `${plate.width}px`;
    style.height = `${plate.height}px`;
  }
  return style;
}

/** @deprecated 3×3 helper — kept so older imports do not crash. */
export function logoLiveStyle(branding) {
  return brandMarkLogoLiveStyle(branding);
}
