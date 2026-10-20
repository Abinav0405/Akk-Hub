/**
 * Shared Excel look for the commercial documents (JSR, progress claim, invoice) so the
 * .xlsx reads like the PDF: letterhead with logo, company name and address, the document
 * title and number on the right, a red rule, red-barred section titles, boxed details,
 * a dark header row on tables, a totals block, the amount in words and the sign-off.
 */
import { blobUrlToDataUrl } from '@/modules/progress/lib/imageDataUrl';
import { DOC_ACCENT, DOC_COMPANY_ADDRESS, DOC_HEADER_BG, DOC_INK } from '@/modules/progress/lib/documentChrome';

const argb = (hex) => `FF${String(hex).replace('#', '').toUpperCase()}`;

export const XL = {
  ink: argb(DOC_INK),
  accent: argb(DOC_ACCENT),
  headerBg: argb(DOC_HEADER_BG),
  label: 'FF4B5563',
  grid: 'FFE6E6E6',
  soft: 'FFF8FAFC',
  font: 'Arial',
};

export const MONEY_FMT = '#,##0.00';
/** + for an addition, − for a deduction. */
export const SIGNED_MONEY_FMT = '+#,##0.00;-#,##0.00;0.00';
const LIGHT = { style: 'thin', color: { argb: XL.grid } };
const INK_LINE = { style: 'thin', color: { argb: XL.ink } };

function font(size, extra = {}) {
  return { name: XL.font, size, color: { argb: XL.ink }, ...extra };
}

/** Logo as a data: URL ExcelJS can embed; null when it cannot be loaded. */
export async function logoDataUrl(src) {
  if (!src) return null;
  if (/^data:image\//i.test(src)) return src;
  try {
    return await blobUrlToDataUrl(src);
  } catch {
    return null;
  }
}

function dataUrlParts(dataUrl) {
  const match = /^data:image\/(\w+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  const ext = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  if (!['png', 'jpeg', 'gif'].includes(ext)) return null;
  return { extension: ext, base64: match[2] };
}

export function addImage(workbook, ws, dataUrl, anchor) {
  const parts = dataUrlParts(dataUrl);
  if (!parts) return false;
  const id = workbook.addImage({ base64: parts.base64, extension: parts.extension });
  ws.addImage(id, anchor);
  return true;
}

function merge(ws, r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return;
  ws.mergeCells(r1, c1, r2, c2);
}

/** New A4 portrait sheet that prints one page wide with "doc ref … Page n of m" in the footer. */
export function documentSheet(workbook, name, widths, { docRef = '', landscape = false } = {}) {
  const ws = workbook.addWorksheet(name, {
    pageSetup: {
      paperSize: 9,
      orientation: landscape ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.5, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    },
    views: [{ showGridLines: false }],
  });
  ws.columns = widths.map((width) => ({ width }));
  const ref = String(docRef || '').replace(/&/g, '&&');
  ws.headerFooter.oddFooter = `&L&"Arial"&8${ref}&R&"Arial,Bold"&8Page &P of &N`;
  return ws;
}

/**
 * Letterhead across columns 1..lastCol. Returns the first free row.
 * Left: logo, company name, address. Right: document kind, subtitle, number.
 */
export function addLetterhead(workbook, ws, { lastCol, logo, companyName, address, kind, subtitle, docNo }) {
  const split = Math.max(2, Math.ceil(lastCol / 2));
  [1, 2, 3].forEach((r) => { ws.getRow(r).height = 19; });
  const hasLogo = addImage(workbook, ws, logo, { tl: { col: 0.05, row: 0.1 }, ext: { width: 50, height: 50 }, editAs: 'oneCell' });
  const indent = hasLogo ? 8 : 0;

  merge(ws, 1, 1, 1, split);
  const name = ws.getCell(1, 1);
  name.value = companyName || '';
  name.font = font(13, { bold: true });
  name.alignment = { vertical: 'middle', indent };

  merge(ws, 2, 1, 2, split);
  const addr = ws.getCell(2, 1);
  addr.value = String(address || '').trim() || DOC_COMPANY_ADDRESS;
  addr.font = font(9, { bold: true, color: { argb: 'FF333333' } });
  addr.alignment = { vertical: 'top', indent, wrapText: true };

  merge(ws, 1, split + 1, 1, lastCol);
  const title = ws.getCell(1, split + 1);
  title.value = kind || '';
  title.font = font(16, { bold: true });
  title.alignment = { horizontal: 'right', vertical: 'middle' };

  merge(ws, 2, split + 1, 2, lastCol);
  const sub = ws.getCell(2, split + 1);
  sub.value = subtitle || '';
  sub.font = font(9, { bold: true, color: { argb: 'FF333333' } });
  sub.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };

  merge(ws, 3, split + 1, 3, lastCol);
  const no = ws.getCell(3, split + 1);
  no.value = docNo || '';
  no.font = font(10, { bold: true });
  no.alignment = { horizontal: 'right', vertical: 'middle' };

  // Red rule under the letterhead (row 4 is a thin spacer carrying the line).
  ws.getRow(4).height = 6;
  for (let c = 1; c <= lastCol; c += 1) {
    ws.getCell(4, c).border = { bottom: { style: 'medium', color: { argb: XL.accent } } };
  }
  return 6;
}

/** "▌ Title" — the red bar is a thick left border, as on the PDF. */
export function addSectionTitle(ws, row, text, lastCol) {
  ws.getRow(row).height = 20;
  merge(ws, row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = font(11, { bold: true });
  cell.alignment = { vertical: 'middle', indent: 1 };
  cell.border = { left: { style: 'thick', color: { argb: XL.accent } } };
  return row + 2;
}

function boxBorder(ws, r1, c1, r2, c2) {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const cell = ws.getCell(r, c);
      cell.border = {
        ...(r === r1 ? { top: LIGHT } : {}),
        ...(r === r2 ? { bottom: LIGHT } : {}),
        ...(c === c1 ? { left: LIGHT } : {}),
        ...(c === c2 ? { right: LIGHT } : {}),
      };
    }
  }
}

function detailBox(ws, row, c1, c2, label, value) {
  merge(ws, row, c1, row, c2);
  merge(ws, row + 1, c1, row + 1, c2);
  const l = ws.getCell(row, c1);
  l.value = label;
  l.font = font(8, { bold: true, color: { argb: XL.label } });
  l.alignment = { vertical: 'bottom', indent: 1 };
  const v = ws.getCell(row + 1, c1);
  v.value = value == null || value === '' ? '—' : value;
  v.font = font(10, { bold: true });
  v.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  boxBorder(ws, row, c1, row + 1, c2);
}

/**
 * Boxed label / value pairs, like the PDF's details table. Each entry is
 * [label, value] (half width) or [label, value, 'full'] (whole width).
 */
export function addDetails(ws, row, entries, lastCol) {
  const split = Math.max(1, Math.ceil(lastCol / 2));
  const list = entries.filter(Boolean);
  let i = 0;
  while (i < list.length) {
    const [label, value, span] = list[i];
    const next = list[i + 1];
    ws.getRow(row).height = 14;
    const valueLen = Math.max(String(value ?? '').length, span === 'full' ? 0 : String(next?.[1] ?? '').length);
    ws.getRow(row + 1).height = valueLen > (span === 'full' ? 90 : 45) ? 30 : 18;
    if (span === 'full' || !next || next[2] === 'full') {
      detailBox(ws, row, 1, span === 'full' ? lastCol : split, label, value);
      i += 1;
    } else {
      detailBox(ws, row, 1, split, label, value);
      detailBox(ws, row, split + 1, lastCol, next[0], next[1]);
      i += 2;
    }
    row += 2;
  }
  return row + 1;
}

/** "Reviewed", "Approved by Client"… shown as a coloured status cell. */
export function styleStatusCell(cell) {
  cell.font = font(10, { bold: true, color: { argb: 'FF9F1239' } });
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } };
}

/**
 * Table with a dark header row. `money` lists the column indexes (0-based) that hold
 * amounts; `right` lists other right-aligned columns. Returns the next free row.
 */
export function addTable(ws, row, headers, rows, { money = [], right = [], wrap = [], signed = [] } = {}) {
  const last = headers.length - 1;
  ws.getRow(row).height = 20;
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = font(9, { bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: money.includes(i) || right.includes(i) || i === last ? 'right' : 'left', wrapText: true, indent: 0 };
    cell.border = { top: { style: 'thin', color: { argb: XL.headerBg } }, bottom: { style: 'thin', color: { argb: XL.headerBg } } };
  });
  row += 1;
  rows.forEach((cols) => {
    cols.forEach((value, i) => {
      const cell = ws.getCell(row, i + 1);
      cell.value = value == null ? '' : value;
      cell.font = font(10, { bold: true });
      const isMoney = money.includes(i);
      if (isMoney && typeof value === 'number') cell.numFmt = signed.includes(i) ? SIGNED_MONEY_FMT : MONEY_FMT;
      if (signed.includes(i) && typeof value === 'number' && Math.abs(value) >= 0.005) {
        cell.font = font(10, { bold: true, color: { argb: value > 0 ? 'FF047857' : 'FFB91C1C' } });
      }
      cell.alignment = {
        vertical: 'top',
        horizontal: isMoney || right.includes(i) ? 'right' : 'left',
        wrapText: wrap.includes(i) || !isMoney,
      };
      cell.border = { top: LIGHT, bottom: LIGHT, left: LIGHT, right: LIGHT };
    });
    const longest = Math.max(...cols.map((v, i) => (wrap.includes(i) ? String(v ?? '').length : 0)), 0);
    if (longest > 42) ws.getRow(row).height = Math.min(90, 15 * Math.ceil(longest / 42));
    row += 1;
  });
  return row + 1;
}

/**
 * Right-hand totals block (label over value columns), then the amount in words.
 * lines: [{ label, value, strong }]
 */
export function addTotals(ws, row, lines, { labelCol, valueCol, lastCol, words }) {
  lines.filter(Boolean).forEach((line) => {
    merge(ws, row, labelCol, row, valueCol - 1);
    const l = ws.getCell(row, labelCol);
    l.value = line.label;
    l.font = font(10, { bold: true });
    const v = ws.getCell(row, valueCol);
    v.value = Number(line.value) || 0;
    v.numFmt = MONEY_FMT;
    v.font = font(line.strong ? 11 : 10, { bold: true });
    v.alignment = { horizontal: 'right' };
    for (let c = labelCol; c <= valueCol; c += 1) {
      ws.getCell(row, c).border = { top: line.strong ? { style: 'medium', color: { argb: XL.ink } } : INK_LINE };
    }
    row += 1;
  });
  if (words) {
    row += 1;
    merge(ws, row, 1, row, lastCol);
    const w = ws.getCell(row, 1);
    w.value = words;
    w.font = font(10, { bold: true, italic: true });
    w.alignment = { horizontal: 'center' };
    row += 1;
  }
  return row + 1;
}

/** A plain wrapped note across the sheet. */
export function addNote(ws, row, text, lastCol) {
  if (!String(text || '').trim()) return row;
  merge(ws, row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = font(10, { bold: true });
  cell.alignment = { wrapText: true, vertical: 'top' };
  const lines = String(text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0);
  ws.getRow(row).height = Math.max(16, lines * 14);
  return row + 2;
}

/**
 * Submitted by / Checked by: room to sign, a rule, the label, then the names.
 * Each side is { label, lines: [] }.
 */
export function addSignoff(ws, row, left, right, lastCol) {
  const split = Math.max(1, Math.ceil(lastCol / 2));
  const gap = lastCol >= 4 ? 1 : 0;
  const sides = [
    [1, split - gap > 0 ? split - gap : split, left],
    [split + 1, lastCol, right],
  ];
  for (let r = row; r < row + 3; r += 1) ws.getRow(r).height = 16; // space for a signature / seal
  row += 3;
  const tallest = Math.max(left.lines.filter(Boolean).length, right.lines.filter(Boolean).length);
  sides.forEach(([c1, c2, side]) => {
    merge(ws, row, c1, row, c2);
    const l = ws.getCell(row, c1);
    l.value = side.label;
    l.font = font(10, { bold: true });
    for (let c = c1; c <= c2; c += 1) ws.getCell(row, c).border = { top: INK_LINE };
    side.lines.filter(Boolean).forEach((text, i) => {
      merge(ws, row + 1 + i, c1, row + 1 + i, c2);
      const cell = ws.getCell(row + 1 + i, c1);
      cell.value = text;
      cell.font = font(10, { bold: true });
    });
  });
  return row + 2 + tallest;
}
