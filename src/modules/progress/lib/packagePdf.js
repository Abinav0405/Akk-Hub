import { PHOTO_ASPECT_RATIO } from '@/modules/progress/lib/config';
import { formatDate, toIsoDate } from '@/modules/progress/lib/dates';
import { escapeHtml } from '@/modules/progress/lib/utils';
import {
  buildPackageAutoTitle,
  exportSectionId,
  isShortSectionCode,
  packageHeading,
  sectionIdFieldLabel,
  titleParts,
} from '@/modules/progress/lib/sectionLabel';
import { packageCompletionPct, packagePhotoCounts, submittedByLabel } from '@/modules/progress/lib/packageProgress';
import {
  DOC_HEADER_BUDGET,
  DOC_INK,
  DOC_LABEL,
  DOC_LINE,
  DOC_PAD,
  DOC_PAGE_H,
  DOC_PAGE_W,
  DOCUMENT_KIND,
  documentPageShell,
} from '@/modules/progress/lib/documentChrome';

const PAGE_W = DOC_PAGE_W;
const PAGE_H = DOC_PAGE_H;
export const PDF_PAGE_W = PAGE_W;
export const PDF_PAGE_H = PAGE_H;
const INK = DOC_INK;
const LABEL = DOC_LABEL;
const LINE = DOC_LINE;

const PAGE_PAD_TOP = DOC_PAD.top;
const PAGE_PAD_RIGHT = DOC_PAD.right;
const PAGE_PAD_BOTTOM = DOC_PAD.bottom;
/** Clear zone for a ring binder / punch holes, then left spacing (no printed bar). */
const PAGE_PAD_LEFT = DOC_PAD.left;

const COLS = 2;
const ROWS = 3;
const MAX_PER_PAGE = COLS * ROWS;
const GAP_X = 14;
const GAP_Y = 12;
/** Room under each photo for a caption. Not a fixed box that clips the next row. */
const CAPTION_BLOCK = 22;
const CONTENT_W = PAGE_W - PAGE_PAD_LEFT - PAGE_PAD_RIGHT;
const CONTENT_H = PAGE_H - PAGE_PAD_TOP - PAGE_PAD_BOTTOM;

/** Page-1 chrome other than the photo grid. Description beyond this shrinks the photos. */
const TITLE_BUDGET = 32;
const DETAILS_BUDGET = 110;
const HEADING_BUDGET = 36;
const GRID_SAFETY = 24;
const DESIGN_GRID_H = CONTENT_H - DOC_HEADER_BUDGET - TITLE_BUDGET - DETAILS_BUDGET - HEADING_BUDGET - GRID_SAFETY;

function gridMetrics(gridHeight) {
  const chrome = CAPTION_BLOCK + GAP_Y;
  const maxW = Math.floor((CONTENT_W - GAP_X) / COLS);
  let photoH = Math.floor((gridHeight - chrome * ROWS) / ROWS);
  if (!Number.isFinite(photoH) || photoH < 96) photoH = 96;
  let cellW = Math.min(maxW, Math.round(photoH * PHOTO_ASPECT_RATIO));
  photoH = Math.round(cellW / PHOTO_ASPECT_RATIO);
  const used = () => ROWS * (photoH + CAPTION_BLOCK + GAP_Y);
  while (used() > gridHeight && cellW > 140) {
    cellW -= 4;
    photoH = Math.round(cellW / PHOTO_ASPECT_RATIO);
  }
  return { cellW, photoH, gapX: GAP_X, gapY: GAP_Y };
}

const DEFAULT_METRICS = gridMetrics(DESIGN_GRID_H);

/**
 * Photo grid for a page whose text above the photos is `headerPx` tall (JSR photo
 * pages: site, package, description). Same size as usual while it fits the room a
 * package page keeps for its title + details; smaller only when the text runs longer.
 */
export function photoGridMetricsForHeader(headerPx) {
  const room = TITLE_BUDGET + DETAILS_BUDGET;
  return gridMetrics(Math.min(DESIGN_GRID_H, DESIGN_GRID_H + room - Math.max(0, Number(headerPx) || 0)));
}
const CELL_W = DEFAULT_METRICS.cellW;
const PHOTO_H = DEFAULT_METRICS.photoH;
/** Bake photos at 2× so html2canvas scale 2 stays sharp without stretching. */
const PHOTO_BAKE_SCALE = 2;
/** Default bake quality for PDF embeds — sharp enough on paper, much smaller than 0.95. */
const PHOTO_BAKE_QUALITY = 0.82;
/**
 * Claim / photo-heavy JSR PDFs: slightly smaller bake + lower JPEG quality.
 * Same 2×3 grid; export-only — does not change stored originals or hashes.
 */
export const CLAIM_PDF_PHOTO_FIT = { scale: 1.75, quality: 0.72 };
/** Same compact bake as claims — use for standalone JSR PDF download/print. */
export const JSR_PDF_PHOTO_FIT = CLAIM_PDF_PHOTO_FIT;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fileSafe(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.\-]+|[_.\-]+$/g, '');
}

export { buildPackageAutoTitle };

/** Makes a typed file name safe to save: no path characters, no extension. */
export function cleanExportFileName(value) {
  return String(value || '')
    .replace(/\.(pdf|xlsx)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[_.\s]+|[_.\s]+$/g, '')
    .slice(0, 150);
}

/**
 * Export file name: {description}_{section}_{street} from whatever is filled in.
 * A package with only a short code (LCB-69) keeps {sectionId}_{YYYY-MM-DD}_{location}
 * so files from different days don't share a name.
 */
export function buildReportDocumentName({ packageDate, siteName, location, lcbId, sectionLabel, description, streetName } = {}) {
  const id = String(lcbId || '').trim();
  const onlyCode = !String(description || '').trim() && !String(streetName || '').trim() && (!id || isShortSectionCode(id));
  if (!onlyCode) {
    const name = titleParts({ description, sectionLabel, lcbId, streetName }, 60).map(fileSafe).filter(Boolean).join('_');
    if (name) return name;
  }
  const section = fileSafe(exportSectionId({ sectionLabel, lcbId })) || 'section';
  const iso = String(packageDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = (iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : toIsoDate(packageDate)) || 'date';
  const site = fileSafe(location || siteName) || 'site';
  return `${section}_${date}_${site}`;
}

export function buildReportFileName(meta) {
  return `${buildReportDocumentName(meta)}.pdf`;
}

function wrappedLines(text, charsPerLine) {
  const width = Math.max(8, charsPerLine);
  return String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil((line.length || 1) / width)), 0);
}

function detailItems({ displayId, packageDate, siteName, lcbId, sectionLabel }) {
  return [
    displayId ? ['Package', displayId] : null,
    ['Date', formatDate(packageDate) || packageDate],
    ['Site', siteName],
    [sectionIdFieldLabel(sectionLabel), lcbId],
  ].filter(Boolean).filter(([, v]) => v);
}

function columnWidths(items) {
  if (!items.length) return [];
  const floors = items.map(([label, value]) => {
    const short = /^(package|date)$/i.test(String(label || ''));
    const chars = Math.max(String(label || '').length, Math.min(String(value || '').length, 16));
    return Math.max(short ? 124 : 96, chars * 7.2 + 28);
  });
  let sum = floors.reduce((total, width) => total + width, 0);
  if (sum > CONTENT_W) {
    const scale = CONTENT_W / sum;
    return floors.map((width) => ((width * scale) / CONTENT_W) * 100);
  }
  const flex = items.map(([label]) => (/^(package|date)$/i.test(String(label || '')) ? 0 : 1));
  const flexCount = flex.reduce((total, flag) => total + flag, 0);
  const extra = CONTENT_W - sum;
  return floors.map((width, index) => {
    const share = flexCount ? (flex[index] ? extra / flexCount : 0) : extra / items.length;
    return ((width + share) / CONTENT_W) * 100;
  });
}

/** How tall the facts table is, so a long site line or description can shrink the photos instead of being sliced. */
function detailsBlockHeight(items, description) {
  const widths = columnWidths(items);
  let row = 0;
  items.forEach(([label, value], index) => {
    const inner = Math.max(48, CONTENT_W * (widths[index] / 100) - 24);
    const labelLines = wrappedLines(label, Math.floor(inner / 6.4));
    const valueLines = wrappedLines(value, Math.floor(inner / 7.4));
    const height = 20 + labelLines * 14 + 4 + valueLines * 18;
    if (height > row) row = height;
  });
  const desc = String(description || '').trim();
  if (!desc) return row;
  const lines = wrappedLines(desc, Math.floor((CONTENT_W - 24) / 7.4));
  return row + 24 + 16 + lines * 18;
}

/** Page-1 package facts only. The repeating header/footer is applied by the page shell. */
function detailsBlock({ title, displayId, packageDate, siteName, lcbId, sectionLabel, description }) {
  const items = detailItems({ displayId, packageDate, siteName, lcbId, sectionLabel });
  const desc = String(description || '').trim();
  const widths = columnWidths(items.length ? items : [['', '']]);

  const cols = items
    .map(
      ([label, value], i) => `
      <td style="width:${widths[i]}%;padding:10px 12px;vertical-align:top;border-right:${i < items.length - 1 ? `1px solid ${LINE}` : '0'};">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;line-height:1.35;color:${LABEL};overflow-wrap:break-word;">${escapeHtml(label)}</div>
        <div style="margin-top:4px;font-size:13px;font-weight:600;color:${INK};line-height:1.4;overflow-wrap:break-word;${String(value).length <= 16 ? 'white-space:nowrap;' : ''}">${escapeHtml(value)}</div>
      </td>`
    )
    .join('');

  const table = items.length || desc
    ? `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:10px;background:#fafafa;border:1px solid ${LINE};">
        ${items.length ? `<tr>${cols}</tr>` : ''}
        ${desc ? `<tr>
          <td colspan="${Math.max(items.length, 1)}" style="padding:10px 12px;border-top:1px solid ${LINE};vertical-align:top;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;line-height:1.35;color:${LABEL};">Description</div>
            <div style="margin-top:4px;font-size:13px;font-weight:600;line-height:1.45;color:${INK};white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;">${escapeHtml(desc)}</div>
          </td>
        </tr>` : ''}
      </table>`
    : '';

  return `
    <div style="flex:0 0 auto;">
      <div style="font-size:16px;font-weight:700;line-height:1.35;color:${INK};overflow-wrap:break-word;">${escapeHtml(title)}</div>
      ${table}
    </div>
  `;
}

function sectionHeading(label, start, count, total) {
  return `
    <div style="flex:0 0 auto;display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:12px 0 8px 0;">
      <div style="font-size:13px;font-weight:700;line-height:1.3;color:${INK};overflow-wrap:break-word;">${escapeHtml(label)} Servicing</div>
      <div style="flex:0 0 auto;font-size:11px;font-weight:600;color:${INK};">Photos ${start + 1}–${start + count} of ${total}</div>
    </div>
  `;
}

function shellPages(inners, { logoSrc, companyName, companyAddress, documentChrome, docNo, subtitle }) {
  const kind = DOCUMENT_KIND.package;
  return inners.map((inner, i) => documentPageShell(inner, {
    page: i + 1,
    total: inners.length,
    logoSrc,
    companyName,
    kind,
    docNo: docNo || '',
    subtitle: subtitle || '',
    docRef: [docNo, kind].filter(Boolean).join(' · '),
    chrome: documentChrome,
    address: companyAddress,
  }));
}

function isRenderableImage(src) {
  return typeof src === 'string' && /^(data:|blob:|https?:|\/)/i.test(src);
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load photo'));
    img.src = src;
  });
}

/**
 * Letterbox the whole photo into the shared PDF slot. Nothing is cropped.
 * `options.scale` multiplies the on-page cell size (default 2). `options.quality`
 * is JPEG quality 0–1. Export-only — does not change stored originals or hashes.
 */
export async function fitPdfPhoto(src, options = {}) {
  const img = await loadHtmlImage(src);
  const sourceW = img.naturalWidth || img.width;
  const sourceH = img.naturalHeight || img.height;
  if (!sourceW || !sourceH) return src;

  const mul = Number(options.scale);
  const scaleMul = Number.isFinite(mul) && mul > 0 ? mul : PHOTO_BAKE_SCALE;
  const q = Number(options.quality);
  const quality = Number.isFinite(q) && q > 0 && q <= 1 ? q : PHOTO_BAKE_QUALITY;
  const outW = Math.max(1, Math.round(CELL_W * scaleMul));
  const outH = Math.max(1, Math.round(PHOTO_H * scaleMul));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, outW, outH);
  const scale = Math.min(outW / sourceW, outH / sourceH);
  const dw = Math.max(1, Math.round(sourceW * scale));
  const dh = Math.max(1, Math.round(sourceH * scale));
  const dx = Math.round((outW - dw) / 2);
  const dy = Math.round((outH - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

function photoEntry(item) {
  if (!item) return { src: '', caption: '' };
  if (typeof item === 'string') return { src: item, caption: '' };
  return { src: item.dataUrl || item.src || '', caption: String(item.caption || '').trim() };
}

function photoSlot(src, caption, metrics, isLastCol) {
  const { cellW, photoH, gapX, gapY } = metrics;
  const photo = isRenderableImage(src)
    ? `<img src="${escapeHtml(src)}" alt="" style="width:100%;height:100%;object-fit:contain;object-position:center;display:block;border:0;" />`
    : '';
  const padRight = isLastCol ? 0 : gapX;
  return `
    <td style="width:${cellW + padRight}px;padding:0 ${padRight}px ${gapY}px 0;vertical-align:top;">
      <div style="width:${cellW}px;height:${photoH}px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid ${LINE};background:#f8fafc;">
        ${photo}
      </div>
      <div style="margin-top:6px;font-size:11px;font-weight:600;line-height:1.35;color:${INK};overflow-wrap:break-word;word-break:break-word;">${escapeHtml(caption)}</div>
    </td>`;
}

function emptySlot(metrics, isLastCol) {
  const { cellW, gapX, gapY } = metrics;
  const padRight = isLastCol ? 0 : gapX;
  return `<td style="width:${cellW + padRight}px;padding:0 ${padRight}px ${gapY}px 0;vertical-align:top;"></td>`;
}

export function imageGridHtml(images, startIndex, metrics = DEFAULT_METRICS) {
  const list = images || [];
  const rowCount = Math.min(ROWS, Math.max(1, Math.ceil(Math.min(list.length, MAX_PER_PAGE) / COLS)));
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    const cells = [];
    let any = false;
    for (let c = 0; c < COLS; c += 1) {
      const i = r * COLS + c;
      const entry = photoEntry(list[i]);
      const fallback = `Photo ${startIndex + i + 1}`;
      const last = c === COLS - 1;
      if (entry.src) {
        any = true;
        cells.push(photoSlot(entry.src, entry.caption || fallback, metrics, last));
      } else {
        cells.push(emptySlot(metrics, last));
      }
    }
    if (any) rows.push(`<tr>${cells.join('')}</tr>`);
  }
  if (!rows.length) return '';
  const tableW = metrics.cellW * COLS + metrics.gapX * (COLS - 1);
  // Centred: the 2-column grid is narrower than the page body, so the spare width is
  // split left and right instead of all sitting on the right.
  return `<div style="flex:0 0 auto;"><table style="border-collapse:collapse;table-layout:fixed;width:${tableW}px;margin:0 auto;">${rows.join('')}</table></div>`;
}

const STAGE_GRID_ORDER = [
  ['before', 'Before'],
  ['during', 'During'],
  ['after', 'After'],
  ['completion', 'Completion'],
];

/** One inner HTML fragment per 2×3 page (stage heading + grid). Used by package print and JSR PDFs. */
export function buildStagePhotoGridInners(stagePhotos, metrics = DEFAULT_METRICS) {
  const inners = [];
  for (const [key, label] of STAGE_GRID_ORDER) {
    const photos = stagePhotos?.[key] || [];
    if (photos.length === 0) continue;
    chunk(photos, MAX_PER_PAGE).forEach((imgs, idx) => {
      const start = idx * MAX_PER_PAGE;
      inners.push(`${sectionHeading(label, start, imgs.length, photos.length)}${imageGridHtml(imgs, start, metrics)}`);
    });
  }
  return inners;
}

/**
 * Page 1: shared header + title + details + description + 2×3 photos.
 * Later pages: the same header and footer only, then photos. Details stay on page 1.
 */
export function buildPackagePdfPages({
  title,
  displayId,
  packageDate,
  siteName,
  lcbId,
  sectionLabel,
  logoSrc,
  companyName,
  companyAddress,
  stagePhotos,
  description,
  documentChrome,
}) {
  const docTitle = title || buildReportDocumentName({ displayId, packageDate, siteName, lcbId, sectionLabel });
  const facts = detailItems({ displayId, packageDate, siteName, lcbId, sectionLabel });
  const extraDetails = Math.max(0, detailsBlockHeight(facts, description) - DETAILS_BUDGET);
  const metrics = gridMetrics(DESIGN_GRID_H - extraDetails);
  const page1Body = detailsBlock({
    title: docTitle,
    displayId,
    packageDate,
    siteName,
    lcbId,
    sectionLabel,
    description,
  });
  const grids = buildStagePhotoGridInners(stagePhotos, metrics);
  const inners = grids.length === 0
    ? [page1Body]
    : grids.map((gridInner, idx) => `${idx === 0 ? page1Body : ''}${gridInner}`);

  return shellPages(inners, {
    logoSrc,
    companyName,
    companyAddress,
    documentChrome,
    docNo: displayId || '',
    subtitle: siteName || '',
  });
}

const SUMMARY_ROWS_PAGE1 = 14;
const SUMMARY_ROWS_LATER = 18;

function summaryStatus(pkg) {
  if (pkg?.sent_to_export) return 'Sent to export';
  return String(pkg?.approval_status || 'pending');
}

function summaryTableHeader() {
  const th = (label, w) =>
    `<th style="width:${w};padding:8px 8px;text-align:left;font-size:11px;font-weight:700;line-height:1.3;color:#ffffff;background:#1a1a1a;border:1px solid #1a1a1a;vertical-align:bottom;overflow-wrap:break-word;">${label}</th>`;
  return `<tr>
    ${th('ID', '12%')}
    ${th('Site', '20%')}
    ${th('Date', '12%')}
    ${th('Status', '12%')}
    ${th('%', '8%')}
    ${th('Photos', '14%')}
    ${th('Submitted by', '22%')}
  </tr>`;
}

function summaryTableRow(pkg) {
  const counts = packagePhotoCounts(pkg);
  const photos = `${counts.total} (B${counts.before}/D${counts.during}/A${counts.after}/C${counts.completion})`;
  const td = (value) =>
    `<td style="padding:8px 8px;font-size:12px;font-weight:600;line-height:1.35;color:${INK};border-bottom:1px solid ${LINE};vertical-align:top;overflow-wrap:break-word;word-break:break-word;">${escapeHtml(value)}</td>`;
  return `<tr>
    ${td(pkg.display_id || '—')}
    ${td(packageHeading({ ...pkg, display_id: '' }))}
    ${td(formatDate(pkg.package_date) || pkg.package_date || '—')}
    ${td(summaryStatus(pkg))}
    ${td(`${packageCompletionPct(pkg)}%`)}
    ${td(photos)}
    ${td(submittedByLabel(pkg))}
  </tr>`;
}

/** One-row-per-package summary of the filtered set — not a photo dump. */
export function buildPackageSummaryPdfPages({
  title = 'Package summary',
  packages = [],
  logoSrc,
  companyName,
  companyAddress,
  documentChrome,
}) {
  const rows = packages || [];
  const chunks = [];
  if (rows.length === 0) {
    chunks.push([]);
  } else {
    chunks.push(rows.slice(0, SUMMARY_ROWS_PAGE1));
    for (let i = SUMMARY_ROWS_PAGE1; i < rows.length; i += SUMMARY_ROWS_LATER) {
      chunks.push(rows.slice(i, i + SUMMARY_ROWS_LATER));
    }
  }

  const inners = chunks.map((part, idx) => {
    const table = `
      <table style="width:100%;border-collapse:collapse;margin-top:${idx === 0 ? '12px' : '0'};">
        ${summaryTableHeader()}
        ${part.length ? part.map(summaryTableRow).join('') : `<tr><td colspan="7" style="padding:16px 8px;font-size:12px;font-weight:600;color:${INK};">No packages in this list.</td></tr>`}
      </table>
    `;
    if (idx === 0) {
      return `
        ${detailsBlock({
          title,
          packageDate: '',
          siteName: `${rows.length} package${rows.length === 1 ? '' : 's'}`,
          lcbId: '',
          sectionLabel: '',
        })}
        ${table}
      `;
    }
    return table;
  });

  return shellPages(inners, { logoSrc, companyName, companyAddress, documentChrome, docNo: title, subtitle: '' });
}
