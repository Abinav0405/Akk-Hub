import ExcelJS from 'exceljs/dist/exceljs.bare.min.js';
import { formatDate } from '@/modules/progress/lib/dates';
import { packageHeading } from '@/modules/progress/lib/sectionLabel';
import { buildReportDocumentName } from '@/modules/progress/lib/packagePdf';
import { packageCompletionPct, packagePhotoCounts, submittedByLabel } from '@/modules/progress/lib/packageProgress';

const COMPANY = 'AKK ENGINEERING PTE. LTD.';

// Excel Format Picture size from the original manual reports:
// 7.37 cm wide × 5.56 cm tall, 100% scale, lock aspect ratio,
// relative to original picture size. Embed each JPEG at the 96dpi
// pixel size for those centimetres so Excel reports original = display.
const PHOTO_WIDTH_CM = 7.37;
const PHOTO_HEIGHT_CM = 5.56;
const PHOTO_WIDTH_PX = Math.round((PHOTO_WIDTH_CM * 96) / 2.54);
const PHOTO_HEIGHT_PX = Math.round((PHOTO_HEIGHT_CM * 96) / 2.54);
/** Pixels stored per on-page pixel (sharpness). The on-page size stays 7.37 × 5.56 cm. */
const PHOTO_DENSITY = 3;

// Row height is natively in points (1pt = 1/72in = 0.0352778cm).
const PHOTO_ROW_H = PHOTO_HEIGHT_CM / 0.0352778;
// Column width is in "characters"; Calibri 11 ≈ pixels ~= chars * 7 + 5 at 96dpi.
const COL_PHOTO_W = (PHOTO_WIDTH_PX - 5) / 7;

const COL_MARGIN_W = 3.71;
const COL_GUTTER_W = 8.71;

// Do not size photos with a pixel `ext` (oneCell). That matches 96dpi Windows
// Excel at 100% zoom and overlaps on other Windows PCs (125%/150% scaling,
// Excel 2016/365, Page Layout) as well as Mac / WPS / Excel Online.
// twoCell + a real cell grid is what those copies all honor.
// Do not set a custom row height on the photo rows: Excel then writes
// customHeight=1 and some Windows builds ignore it, collapsing the slot.
// 15.25 (not 15) makes ExcelJS write sheet customHeight so every PC uses
// this default instead of its own Normal-style row height.
const EXCEL_DEFAULT_ROW_PT = 15.25;
const PHOTO_SLOT_ROWS = Math.max(2, Math.ceil(PHOTO_ROW_H / EXCEL_DEFAULT_ROW_PT));
const GAP_ROWS = 4;
const HEADER_ROW_H = 26;
const HEADER_GAP_ROWS = 1;

const STAGE_ORDER = [
  ['before', 'BEFORE'],
  ['during', 'DURING'],
  ['after', 'AFTER'],
  ['completion', 'COMPLETION'],
];

function excelPhotoSrc(item) {
  if (!item) return null;
  return typeof item === 'string' ? item : item.dataUrl || item.src || null;
}

function placeLetterheadLogo(workbook, ws, logoSrc, { col = 1, row = 3, size = 34 } = {}) {
  const parts = dataUrlParts(logoSrc);
  if (!parts) return false;
  const imgId = workbook.addImage({
    base64: parts.base64,
    extension: parts.extension === 'jpg' ? 'jpeg' : parts.extension,
  });
  ws.addImage(imgId, {
    tl: { col, row },
    ext: { width: size, height: size },
  });
  return true;
}
function excelPhotoCaption(item) {
  if (!item || typeof item === 'string') return '';
  return String(item.caption || '').trim();
}

function dataUrlParts(dataUrl) {
  const match = /^data:image\/(\w+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  return { extension: ext, base64: match[2] };
}

function uint8ToBase64(bytes) {
  const chunk = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Canvas JPEGs often have no DPI; some Excel then treat pixels at 72dpi or the PC's display scale. */
/**
 * Write the JPEG's DPI. Excel sizes a picture's "original size" from it, so a photo stored
 * at 3× the pixels with 3× the DPI still shows at the same centimetres — at 100% — but sharp.
 */
function setJpegDpi(dataUrl, dpi = 96) {
  const parts = dataUrlParts(dataUrl);
  if (!parts || parts.extension !== 'jpeg') return dataUrl;
  const binary = atob(parts.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const jfif = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0
    && bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0
    && ((bytes[4] << 8) | bytes[5]) >= 16;
  if (!jfif) return dataUrl;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  bytes[13] = 1;
  bytes[14] = (d >> 8) & 0xff;
  bytes[15] = d & 0xff;
  bytes[16] = (d >> 8) & 0xff;
  bytes[17] = d & 0xff;
  return `data:image/jpeg;base64,${uint8ToBase64(bytes)}`;
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read photo'));
    img.src = src;
  });
}

/** Center-crop and resample so the JPEG's native size is exactly 7.37 × 5.56 cm at 96dpi. */
async function fitExcelPhoto(src) {
  const img = await loadHtmlImage(src);
  const sourceW = img.naturalWidth || img.width;
  const sourceH = img.naturalHeight || img.height;
  if (!sourceW || !sourceH) return null;

  const targetRatio = PHOTO_WIDTH_PX / PHOTO_HEIGHT_PX;
  const sourceRatio = sourceW / sourceH;
  let sx;
  let sy;
  let sw;
  let sh;
  if (sourceRatio > targetRatio) {
    sh = sourceH;
    sw = sh * targetRatio;
    sx = (sourceW - sw) / 2;
    sy = 0;
  } else {
    sw = sourceW;
    sh = sw / targetRatio;
    sx = 0;
    sy = (sourceH - sh) / 2;
  }

  // Keep up to 3× the on-page pixels (never enlarging a smaller photo) so it stays sharp
  // when zoomed or printed; the DPI is raised to match so the size on the page is unchanged.
  const density = Math.max(1, Math.min(PHOTO_DENSITY, sw / PHOTO_WIDTH_PX));
  const outW = Math.round(PHOTO_WIDTH_PX * density);
  const outH = Math.round(PHOTO_HEIGHT_PX * density);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  return setJpegDpi(canvas.toDataURL('image/jpeg', 0.92), 96 * density);
}

function placePhoto(ws, workbook, dataUrl, col, rowIndex, rowSpan) {
  const parts = dataUrlParts(dataUrl);
  if (!parts) return;
  const imgId = workbook.addImage({ base64: parts.base64, extension: parts.extension });
  ws.addImage(imgId, {
    tl: { nativeCol: col, nativeColOff: 0, nativeRow: rowIndex, nativeRowOff: 0 },
    br: { nativeCol: col + 1, nativeColOff: 0, nativeRow: rowIndex + rowSpan, nativeRowOff: 0 },
    ext: { width: PHOTO_WIDTH_PX, height: PHOTO_HEIGHT_PX },
    editAs: 'twoCell',
  });
}

/** Keep every slot row real (value in the photo columns) so Excel cannot collapse it. */
function fillRows(ws, startRow, count) {
  for (let i = 0; i < count; i += 1) {
    const r = ws.getRow(startRow + i);
    r.getCell(1).value = '\u00A0';
    r.getCell(2).value = '\u00A0';
    r.getCell(3).value = '\u00A0';
    r.getCell(4).value = '\u00A0';
  }
}

/**
 * Builds the same report as the Print/Email PDF, but as an .xlsx workbook with
 * photos embedded two-per-row — matching the original manual Excel format this
 * app replaced (title block, LOCATION/section/DATE lines, then a photo grid
 * per stage). Returns a Blob ready to hand to savePdfBlob (name aside, it's a
 * generic blob-download/share helper).
 */
export async function buildPackageWorkbookBlob({
  title,
  displayId,
  packageDate,
  siteName,
  lcbId,
  sectionLabel,
  companyName,
  companyAddress,
  logoSrc,
  stagePhotos,
  description,
}) {
  const docTitle = (title || buildReportDocumentName({ displayId, packageDate, siteName, lcbId, sectionLabel })).toUpperCase();
  const letterheadName = companyName || COMPANY;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Report', {
    properties: { defaultRowHeight: EXCEL_DEFAULT_ROW_PT, dyDescent: 0.25 },
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: COL_MARGIN_W },
    { width: COL_PHOTO_W },
    { width: COL_GUTTER_W },
    { width: COL_PHOTO_W },
  ];
  ws.views = [{ showGridLines: false }];
  ws.headerFooter.oddFooter = `&L&"Arial"&8${String(displayId || docTitle).replace(/&/g, '&&')} · Package Report&R&"Arial,Bold"&8Page &P of &N`;

  const mergeAndSet = (range, value, style) => {
    ws.mergeCells(range);
    const cell = ws.getCell(range.split(':')[0]);
    cell.value = value;
    Object.assign(cell, style);
    return cell;
  };

  const centerBold = (size) => ({
    font: { name: 'Calibri', size, bold: true },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  });

  // Letterhead as on the PDF: logo, company name and address on the left; document kind
  // and package number on the right; a red rule; then the title and boxed details.
  const ACCENT = { argb: 'FFC0392B' };
  const INK = { argb: 'FF111111' };
  const LIGHT = { style: 'thin', color: { argb: 'FFE6E6E6' } };
  const arial = (size, extra = {}) => ({ name: 'Arial', size, color: INK, ...extra });

  ws.getRow(1).height = 20;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 18;
  const hasLogo = placeLetterheadLogo(workbook, ws, logoSrc, { col: 0.1, row: 0.1, size: 46 });
  const indent = hasLogo ? 5 : 0;
  mergeAndSet('B1:C1', letterheadName, { font: arial(13, { bold: true }), alignment: { vertical: 'middle', indent } });
  mergeAndSet('B2:C3', companyAddress || '', {
    font: arial(9, { bold: true, color: { argb: 'FF333333' } }),
    alignment: { vertical: 'top', indent, wrapText: true },
  });
  ws.getCell('D1').value = 'Package Report';
  ws.getCell('D1').font = arial(16, { bold: true });
  ws.getCell('D1').alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell('D2').value = siteName || '';
  ws.getCell('D2').font = arial(9, { bold: true, color: { argb: 'FF333333' } });
  ws.getCell('D2').alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
  ws.getCell('D3').value = displayId || '';
  ws.getCell('D3').font = arial(10, { bold: true });
  ws.getCell('D3').alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(4).height = 6;
  ['B4', 'C4', 'D4'].forEach((ref) => { ws.getCell(ref).border = { bottom: { style: 'medium', color: ACCENT } }; });

  ws.getRow(6).height = 40;
  mergeAndSet('B6:D6', docTitle, {
    font: arial(15, { bold: true }),
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  });

  const box = (r, c1, c2, label, value) => {
    ws.mergeCells(r, c1, r, c2);
    ws.mergeCells(r + 1, c1, r + 1, c2);
    const l = ws.getCell(r, c1);
    l.value = label;
    l.font = arial(8, { bold: true, color: { argb: 'FF4B5563' } });
    l.alignment = { vertical: 'bottom', indent: 1 };
    const v = ws.getCell(r + 1, c1);
    v.value = value || '—';
    v.font = arial(11, { bold: true });
    v.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    for (let rr = r; rr <= r + 1; rr += 1) {
      for (let cc = c1; cc <= c2; cc += 1) {
        ws.getCell(rr, cc).border = {
          ...(rr === r ? { top: LIGHT } : {}),
          ...(rr === r + 1 ? { bottom: LIGHT } : {}),
          ...(cc === c1 ? { left: LIGHT } : {}),
          ...(cc === c2 ? { right: LIGHT } : {}),
        };
      }
    }
  };
  // Details: two per line (B:C | D), the long ones full width — as the PDF's details table.
  const sectionName = String(sectionLabel || '').trim() || 'Section ID';
  const sectionValue = String(lcbId || '').trim() || 'N/A';
  let row = 8;
  ws.getRow(row).height = 14;
  ws.getRow(row + 1).height = 20;
  box(row, 2, 3, 'Package', displayId || '—');
  box(row, 4, 4, 'Date', formatDate(packageDate) || packageDate || '—');
  row += 2;
  ws.getRow(row).height = 14;
  ws.getRow(row + 1).height = String(siteName || '').length > 70 ? 32 : 20;
  box(row, 2, 4, 'Site', siteName || '—');
  row += 2;
  ws.getRow(row).height = 14;
  ws.getRow(row + 1).height = String(sectionValue || '').length > 70 ? 32 : 20;
  box(row, 2, 4, sectionName, sectionValue);
  row += 2;
  const desc = String(description || '').trim();
  if (desc) {
    ws.getRow(row).height = 14;
    ws.getRow(row + 1).height = Math.min(90, 16 * Math.max(1, Math.ceil(desc.length / 80)));
    box(row, 2, 4, 'Description', desc);
    row += 2;
  }
  row += 1;
  let addedAnyStage = false;

  for (const [key, label] of STAGE_ORDER) {
    const dataUrls = stagePhotos[key] || [];
    if (dataUrls.length === 0) continue;
    addedAnyStage = true;

    ws.getRow(row).height = HEADER_ROW_H;
    const headerCell = mergeAndSet(`B${row}:D${row}`, `PHOTOGRAPHS ${label} SERVICING`, {
      font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FF111111' } },
      alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
    });
    headerCell.border = { left: { style: 'thick', color: { argb: 'FFC0392B' } } };
    row += 1;
    fillRows(ws, row, HEADER_GAP_ROWS);
    row += HEADER_GAP_ROWS;

    for (let i = 0; i < dataUrls.length; i += 2) {
      const slotStart = row;
      fillRows(ws, slotStart, PHOTO_SLOT_ROWS);
      const leftSrc = excelPhotoSrc(dataUrls[i]);
      const rightSrc = excelPhotoSrc(dataUrls[i + 1]);
      const left = leftSrc ? await fitExcelPhoto(leftSrc) : null;
      const right = rightSrc ? await fitExcelPhoto(rightSrc) : null;
      placePhoto(ws, workbook, left, 1, slotStart - 1, PHOTO_SLOT_ROWS);
      placePhoto(ws, workbook, right, 3, slotStart - 1, PHOTO_SLOT_ROWS);
      row = slotStart + PHOTO_SLOT_ROWS;
      const leftCaption = excelPhotoCaption(dataUrls[i]);
      const rightCaption = excelPhotoCaption(dataUrls[i + 1]);
      if (leftCaption || rightCaption) {
        const captionRow = ws.getRow(row);
        captionRow.height = 18;
        captionRow.getCell(2).value = leftCaption;
        captionRow.getCell(4).value = rightCaption;
        captionRow.getCell(2).font = { name: 'Calibri', size: 9, italic: true };
        captionRow.getCell(4).font = { name: 'Calibri', size: 9, italic: true };
        captionRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
        captionRow.getCell(4).alignment = { wrapText: true, vertical: 'top' };
        row += 1;
      }
      fillRows(ws, row, GAP_ROWS);
      row += GAP_ROWS;
    }
  }

  if (!addedAnyStage) {
    ws.getRow(row).height = 30;
    mergeAndSet(`B${row}:D${row}`, 'No photos on this package yet.', centerBold(12));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function summaryStatus(pkg) {
  if (pkg?.sent_to_export) return 'Sent to export';
  const status = String(pkg?.approval_status || 'pending');
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** One-row-per-package summary of the filtered set — not a photo dump. */
export async function buildPackageSummaryWorkbookBlob({
  title = 'Package summary',
  packages = [],
  companyName,
  companyAddress,
  logoSrc,
}) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Summary', {
    properties: { defaultRowHeight: EXCEL_DEFAULT_ROW_PT, dyDescent: 0.25 },
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { header: 'Package ID', key: 'display_id', width: 14 },
    { header: 'Site', key: 'site', width: 28 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Completion %', key: 'pct', width: 14 },
    { header: 'Photos', key: 'photos', width: 12 },
    { header: 'Before', key: 'before', width: 10 },
    { header: 'During', key: 'during', width: 10 },
    { header: 'After', key: 'after', width: 10 },
    { header: 'Completion photos', key: 'completion', width: 16 },
    { header: 'Submitted by', key: 'submitted', width: 28 },
  ];

  // Same letterhead as the PDF summary: logo, company, address · title on the right · red rule.
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
  ws.getRow(1).height = 20;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 18;
  const hasLogo = placeLetterheadLogo(workbook, ws, logoSrc, { col: 0.05, row: 0.1, size: 46 });
  ws.mergeCells('A1:E1');
  ws.getCell('A1').value = companyName || COMPANY;
  ws.getCell('A1').font = { name: 'Arial', size: 13, bold: true };
  ws.getCell('A1').alignment = { indent: hasLogo ? 6 : 0, vertical: 'middle' };
  ws.mergeCells('A2:E3');
  ws.getCell('A2').value = companyAddress || '';
  ws.getCell('A2').font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF333333' } };
  ws.getCell('A2').alignment = { indent: hasLogo ? 6 : 0, vertical: 'top', wrapText: true };
  ws.mergeCells('F1:K2');
  ws.getCell('F1').value = title;
  ws.getCell('F1').font = { name: 'Arial', size: 16, bold: true };
  ws.getCell('F1').alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  ws.mergeCells('F3:K3');
  ws.getCell('F3').value = `${(packages || []).length} package${(packages || []).length === 1 ? '' : 's'}`;
  ws.getCell('F3').font = { name: 'Arial', size: 10, bold: true };
  ws.getCell('F3').alignment = { horizontal: 'right' };
  ws.getRow(4).height = 6;
  for (let c = 1; c <= 11; c += 1) ws.getCell(4, c).border = { bottom: { style: 'medium', color: { argb: 'FFC0392B' } } };

  const header = ws.getRow(5);
  header.values = [
    'Package ID', 'Site', 'Date', 'Status', 'Completion %',
    'Photos', 'Before', 'During', 'After', 'Completion photos', 'Submitted by',
  ];
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const lightBorder = { style: 'thin', color: { argb: 'FFE6E6E6' } };
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 11 } };
  ws.headerFooter.oddFooter = `&L&"Arial"&8${String(title).replace(/&/g, '&&')}&R&"Arial,Bold"&8Page &P of &N`;

  (packages || []).forEach((pkg, i) => {
    const counts = packagePhotoCounts(pkg);
    const r = ws.getRow(6 + i);
    r.values = [
      pkg.display_id || '',
      packageHeading({ ...pkg, display_id: '' }),
      formatDate(pkg.package_date) || pkg.package_date || '',
      summaryStatus(pkg),
      packageCompletionPct(pkg),
      counts.total,
      counts.before,
      counts.during,
      counts.after,
      counts.completion,
      submittedByLabel(pkg),
    ];
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 11) return;
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'top', wrapText: col === 2 || col === 11 };
      cell.border = { top: lightBorder, bottom: lightBorder, left: lightBorder, right: lightBorder };
    });
    r.getCell(5).numFmt = '0"%"';
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
