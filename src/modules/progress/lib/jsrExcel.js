import ExcelJS from 'exceljs/dist/exceljs.bare.min.js';
import { formatDate } from '@/modules/progress/lib/dates';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { clientAdjustment, fileSafeName, fmtMoney, jsrStatusLabel, monthName, photoStageLabel } from '@/modules/progress/lib/jsrStatus';
import { hasCertifiedAmount, resolveLetterhead } from '@/modules/progress/lib/jsr';
import { DOCUMENT_KIND } from '@/modules/progress/lib/documentChrome';
import {
  amountInWords,
  claimLineAmount,
  groupLinkedPhotos,
  packageDetailLines,
  lineAmount,
  lineQty,
  lineRate,
  priceDecided,
  resolveSignoff,
  round2,
} from '@/modules/progress/lib/jsrPdf';
import {
  MONEY_FMT,
  addDetails,
  addImage,
  addLetterhead,
  addNote,
  addSectionTitle,
  addSignoff,
  addTable,
  addTotals,
  documentSheet,
  logoDataUrl,
  styleStatusCell,
} from '@/modules/progress/lib/excelDocument';

// The .xlsx follows the PDF: same letterhead, sections, figures (client-certified
// once the client decided), totals, amount in words and sign-off.

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STAGES = ['before', 'during', 'after', 'completion'];

async function saveWorkbook(workbook, name) {
  const buffer = await workbook.xlsx.writeBuffer();
  return savePdfBlob(new Blob([buffer], { type: XLSX_TYPE }), name);
}

/** Excel sheet names: ≤31 chars, no []:*?/\ and unique in the workbook. */
function sheetName(workbook, wanted) {
  const base = String(wanted || 'Sheet').replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (workbook.getWorksheet(name)) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  return name;
}

async function letterheadOf(company) {
  const co = await resolveLetterhead(company);
  return { co, logo: await logoDataUrl(co.logo_path) };
}

function signoffSides(signoff, { submittedDate, checkedDate } = {}) {
  return [
    {
      label: submittedDate ? `Submitted by · ${submittedDate}` : 'Submitted by',
      lines: [signoff.submitted_by_name, signoff.submitted_by_company],
    },
    {
      label: checkedDate ? `Checked by · ${checkedDate}` : 'Checked by · Date:',
      lines: [signoff.checked_by_name, signoff.checked_by_title, signoff.checked_by_company],
    },
  ];
}

// ---------------------------------------------------------------- JSR

const JSR_COLS = [7, 12, 44, 8, 8, 15, 16];

function fillJsrSheet(workbook, j, co, logo, name) {
  const ct = j.contract || {};
  const decided = priceDecided(j);
  const last = JSR_COLS.length;
  const ws = documentSheet(workbook, sheetName(workbook, name), JSR_COLS, {
    docRef: [j.jsr_no, DOCUMENT_KIND.jsr].filter(Boolean).join(' · '),
  });
  let row = addLetterhead(workbook, ws, {
    lastCol: last,
    logo,
    companyName: co.name,
    address: co.letterhead_address,
    kind: DOCUMENT_KIND.jsr,
    subtitle: j.sc_work || '',
    docNo: j.jsr_no,
  });

  row = addSectionTitle(ws, row, 'Job details', last);
  row = addDetails(ws, row, [
    ['LOA reference', j.loa || ct.loa],
    ['Work order reference', j.wo_ref],
    ['Subcontract work', j.sc_work, 'full'],
    ['Site', j.site?.name, 'full'],
    ['Location', j.location, 'full'],
    ['Actual completion date', j.completion_date ? formatDate(j.completion_date) : ''],
    ['Status', jsrStatusLabel(j.status)],
  ], last);
  // Status is the last value box (right half of the final details row).
  styleStatusCell(ws.getCell(row - 2, Math.ceil(last / 2) + 1));

  row = addSectionTitle(ws, row, 'Work items', last);
  const items = j.items || [];
  row = addTable(
    ws,
    row,
    ['S/No', 'Item no.', 'Description', 'Unit', 'Qty', 'Unit rate (S$)', 'Amount (S$)'],
    items.map((it, i) => [
      i + 1,
      it.code || 'NA',
      it.description || '',
      it.unit || '',
      Number(lineQty(it, decided)) || 0,
      Number(lineRate(it, decided)) || 0,
      Number(lineAmount(it, decided)) || 0,
    ]),
    { money: [5, 6], right: [4], wrap: [2] }
  );

  const submitted = Number(j.client_submitted_amount ?? j.total) || 0;
  const certifiedTotal = decided && hasCertifiedAmount(j.client_certified_amount) ? Number(j.client_certified_amount) : Number(j.total) || 0;
  const subtotal = items.length ? items.reduce((sum, it) => sum + (Number(lineAmount(it, decided)) || 0), 0) : certifiedTotal;
  const adj = clientAdjustment(submitted, subtotal);
  const changed = decided && adj.amount > 0;
  row = addTotals(ws, row - 1, [
    { label: 'Subtotal', value: subtotal },
    changed ? { label: 'Submitted', value: submitted } : null,
    changed ? { label: adj.label, value: adj.amount } : null,
    { label: 'Total (S$)', value: subtotal, strong: true },
  ], { labelCol: 5, valueCol: 7, lastCol: last, words: amountInWords(subtotal) });

  if (j.claim_no) {
    row = addNote(ws, row, `Included in monthly progress claim ${j.claim_no} (${j.claimed_month || ''})`, last);
  }
  if (j.client_reason || j.client_comments) {
    row = addSectionTitle(ws, row, 'Client response', last);
    row = addNote(ws, row, [j.client_reason ? `Reason: ${j.client_reason}` : '', j.client_comments || ''].filter(Boolean).join('\n'), last);
  }

  const signoff = resolveSignoff(j, co);
  const submittedDate = j.completion_date ? formatDate(j.completion_date) : (j.jsr_date ? formatDate(j.jsr_date) : '');
  const checkedDate = decided && j.client_responded_at ? formatDate(j.client_responded_at) : '';
  const [left, right] = signoffSides(signoff, { submittedDate, checkedDate });
  addSignoff(ws, row + 1, left, right, last);
  return ws;
}

/** What the client changed, line by line: original vs certified quantity, rate and amount. */
function addCertificationSheet(workbook, j, co, logo) {
  const items = j.items || [];
  if (!priceDecided(j) || !items.some((it) => hasCertifiedAmount(it.certified_amount))) return;
  const cols = [12, 34, 9, 9, 13, 13, 14, 14, 14];
  const last = cols.length;
  const ws = documentSheet(workbook, sheetName(workbook, 'Client certification'), cols, {
    docRef: [j.jsr_no, 'Client certification'].filter(Boolean).join(' · '),
    landscape: true,
  });
  let row = addLetterhead(workbook, ws, {
    lastCol: last, logo, companyName: co.name, address: co.letterhead_address,
    kind: 'Client certification', subtitle: jsrStatusLabel(j.status), docNo: j.jsr_no,
  });
  row = addSectionTitle(ws, row, 'Certified line prices', last);
  const rows = items.map((it) => {
    const certAmount = hasCertifiedAmount(it.certified_amount) ? Number(it.certified_amount) : Number(it.amount) || 0;
    return [
      it.code || 'NA',
      it.description || '',
      Number(it.qty) || 0,
      hasCertifiedAmount(it.certified_qty) ? Number(it.certified_qty) : Number(it.qty) || 0,
      Number(it.rate) || 0,
      hasCertifiedAmount(it.certified_rate) ? Number(it.certified_rate) : Number(it.rate) || 0,
      Number(it.amount) || 0,
      certAmount,
      round2(certAmount - (Number(it.amount) || 0)), // + addition, − deduction
    ];
  });
  row = addTable(ws, row,
    ['Item no.', 'Description', 'Qty', 'Certified qty', 'Unit rate (S$)', 'Certified rate (S$)', 'Amount (S$)', 'Certified amount (S$)', 'Change (S$)'],
    rows, { money: [4, 5, 6, 7, 8], signed: [8], right: [2, 3], wrap: [1] });
  const submitted = rows.reduce((s, r) => s + r[6], 0);
  const certified = rows.reduce((s, r) => s + r[7], 0);
  addTotals(ws, row - 1, [
    { label: 'Submitted', value: submitted },
    { label: 'Certified', value: certified },
    { label: clientAdjustment(submitted, certified).label, value: clientAdjustment(submitted, certified).amount, strong: true },
  ], { labelCol: 6, valueCol: 8, lastCol: last });
}

/** Photos two per row, grouped by package and stage like the PDF photo pages. */
function addPhotosSheet(workbook, j, photos, co, logo) {
  const groups = groupLinkedPhotos(photos);
  if (!groups.length) return;
  const cols = [44, 3, 44];
  const ws = documentSheet(workbook, sheetName(workbook, 'Photos'), cols, {
    docRef: [j.jsr_no, 'Photos'].filter(Boolean).join(' · '),
  });
  let row = addLetterhead(workbook, ws, {
    lastCol: 3, logo, companyName: co.name, address: co.letterhead_address,
    kind: DOCUMENT_KIND.jsr, subtitle: 'Supporting photographs', docNo: j.jsr_no,
  });
  const SLOT_ROWS = 15; // 15 × 15pt ≈ 300px — room for a 4:3 photo 300px wide
  const location = j.location || j.site?.name || '';
  groups.forEach((group) => {
    const packageSite = group.street || group.site_name || location || '';
    row = addSectionTitle(ws, row, `SITE: ${packageSite}${group.label ? ` · ${group.label}` : ''}`, 3);
    const details = packageDetailLines(group, packageSite).map(([label, value]) => `${label}: ${value}`).join('\n');
    if (details) row = addNote(ws, row - 1, details, 3);
    STAGES.forEach((stage) => {
      const list = group.stagePhotos[stage] || [];
      if (!list.length) return;
      ws.mergeCells(row, 1, row, 3);
      const head = ws.getCell(row, 1);
      head.value = photoStageLabel(stage);
      head.font = { name: 'Arial', size: 10, bold: true, underline: true };
      row += 2;
      for (let i = 0; i < list.length; i += 2) {
        [list[i], list[i + 1]].forEach((photo, k) => {
          if (!photo) return;
          addImage(workbook, ws, photo.dataUrl, {
            tl: { col: k === 0 ? 0.05 : 2.05, row: row - 1 + 0.1 },
            ext: { width: 300, height: 225 },
            editAs: 'oneCell',
          });
          const cap = ws.getCell(row + SLOT_ROWS - 3, k === 0 ? 1 : 3);
          cap.value = photo.caption || `Photo ${i + k + 1}`;
          cap.font = { name: 'Arial', size: 8, italic: true };
          cap.alignment = { wrapText: true, vertical: 'top' };
        });
        row += SLOT_ROWS;
      }
    });
    row += 1;
  });
}

export async function downloadJsrExcel(j, photos = []) {
  const { co, logo } = await letterheadOf(j.company);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = co.name || '';
  fillJsrSheet(workbook, j, co, logo, 'JSR');
  addCertificationSheet(workbook, j, co, logo);
  addPhotosSheet(workbook, j, photos, co, logo);
  return saveWorkbook(workbook, `${fileSafeName(j.jsr_no) || 'jsr'}.xlsx`);
}

// ---------------------------------------------------------------- Progress claim

export async function downloadClaimExcel(cl, nestedJsrs = []) {
  const { co, logo } = await letterheadOf(cl.company);
  const ct = cl.contract || {};
  const decided = priceDecided(cl);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = co.name || '';
  const docRef = [cl.claim_no, DOCUMENT_KIND.claim].filter(Boolean).join(' · ');
  const subtitle = cl.month ? monthName(cl.month) : '';
  const signoff = resolveSignoff(cl, co, nestedJsrs);
  const checkedDate = decided && cl.client_responded_at ? formatDate(cl.client_responded_at) : '';
  const [left, right] = signoffSides(signoff, { submittedDate: cl.claim_date ? formatDate(cl.claim_date) : '', checkedDate });

  const submitted = Number(cl.client_submitted_amount ?? cl.this_month_total) || 0;
  const thisM = decided && hasCertifiedAmount(cl.client_certified_amount) ? Number(cl.client_certified_amount) : Number(cl.this_month_total) || 0;
  const prev = Number(cl.prev_cert) || 0;
  const price = Number(cl.price) || 0;

  // Summary sheet
  const sumCols = [11, 30, 15, 15, 14, 15, 9];
  const ws = documentSheet(workbook, 'Claim', sumCols, { docRef });
  let row = addLetterhead(workbook, ws, {
    lastCol: 7, logo, companyName: co.name, address: co.letterhead_address,
    kind: DOCUMENT_KIND.claim, subtitle, docNo: cl.claim_no,
  });
  row = addSectionTitle(ws, row, 'Claim details', 7);
  row = addDetails(ws, row, [
    ['Claim date', cl.claim_date ? formatDate(cl.claim_date) : ''],
    ['Work done as of', monthName(cl.month)],
    ['Subcontractor', co.name, 'full'],
    ['Contract', ct.contract_title, 'full'],
    ['SC works', ct.sc_works, 'full'],
    ['LOA reference', ct.loa],
    ['PC No.', cl.pc_no == null ? '' : String(cl.pc_no)],
    ['Status', jsrStatusLabel(cl.status)],
  ], 7);
  styleStatusCell(ws.getCell(row - 2, 1));
  row = addSectionTitle(ws, row, 'Summary', 7);
  const cum = prev + thisM;
  row = addTable(ws, row,
    ['Schedule', 'Description', 'Contract Price', 'Previously Certified', 'This Month', 'Cumulative', '%'],
    [[ct.code || '', ct.description || '', price, prev, thisM, cum, price > 0 ? cum / price : 0]],
    { money: [2, 3, 4, 5], right: [6], wrap: [1] });
  ws.getCell(row - 2, 7).numFmt = '0.00%';
  row = addTotals(ws, row - 1, [
    { label: 'Subtotal', value: thisM },
    decided ? { label: 'Submitted', value: submitted } : null,
    decided && clientAdjustment(submitted, thisM).amount
      ? { label: clientAdjustment(submitted, thisM).label, value: clientAdjustment(submitted, thisM).amount }
      : null,
    { label: 'Total (S$)', value: thisM, strong: true },
  ], { labelCol: 5, valueCol: 7, lastCol: 7, words: amountInWords(thisM) });
  addSignoff(ws, row + 1, left, right, 7);

  // Schedule sheet: one line per JSR
  const jsrs = cl.jsrs || [];
  const schCols = decided ? [7, 24, 34, 15, 15, 14] : [7, 28, 40, 18];
  const sch = documentSheet(workbook, 'Schedule', schCols, { docRef });
  row = addLetterhead(workbook, sch, {
    lastCol: schCols.length, logo, companyName: co.name, address: co.letterhead_address,
    kind: DOCUMENT_KIND.claim, subtitle, docNo: cl.claim_no,
  });
  row = addSectionTitle(sch, row, `Schedule ${ct.code || ''}`.trim(), schCols.length);
  row = addNote(sch, row - 1, [ct.description, `PC No.: ${cl.pc_no ?? '—'}`].filter(Boolean).join('\n'), schCols.length);
  const scheduleRows = jsrs.map((r, i) => {
    const shown = Number(claimLineAmount(r, decided)) || 0;
    return decided
      ? [i + 1, r.wo_ref || '—', r.jsr_no, Number(r.total) || 0, shown, round2(shown - (Number(r.total) || 0))]
      : [i + 1, r.wo_ref || '—', r.jsr_no, shown];
  });
  row = addTable(sch, row,
    decided
      ? ['Item', 'Work Order No', 'JSR Reference', 'Submitted (S$)', 'Certified (S$)', 'Change (S$)']
      : ['Item', 'Work Order No', 'JSR Reference', 'This Month Claim (S$)'],
    scheduleRows,
    { money: decided ? [3, 4, 5] : [3], signed: decided ? [5] : [], wrap: [1, 2] });
  const shown = jsrs.length ? jsrs.reduce((s, r) => s + (Number(claimLineAmount(r, decided)) || 0), 0) : thisM;
  const schAdj = clientAdjustment(submitted, shown);
  const lastSch = schCols.length;
  row = addTotals(sch, row - 1, [
    { label: 'Subtotal', value: shown },
    decided && schAdj.amount ? { label: 'Submitted', value: submitted } : null,
    decided && schAdj.amount ? { label: schAdj.label, value: schAdj.amount } : null,
    { label: 'Total (S$)', value: shown, strong: true },
  ], { labelCol: lastSch - 1, valueCol: lastSch, lastCol: lastSch, words: amountInWords(shown) });
  addSignoff(sch, row + 1, left, right, lastSch);

  // The JSRs themselves, when the claim includes their details (as the PDF does).
  if (cl.include_jsr_details) {
    for (const j of nestedJsrs) {
      if (!j?.items?.length) continue;
      fillJsrSheet(workbook, j, co, logo, j.jsr_no || 'JSR');
    }
  }
  return saveWorkbook(workbook, `${fileSafeName(cl.claim_no) || 'claim'}.xlsx`);
}

// ---------------------------------------------------------------- Invoice

export async function downloadInvoiceExcel(kind, record) {
  const inv = record.invoice;
  if (!inv) return;
  const { co, logo } = await letterheadOf(record.company);
  const ct = record.contract || {};
  const decided = priceDecided(record);
  const signoff = resolveSignoff(record, co, record.jsrs);
  const submitted = kind === 'jsr' ? Number(record.total) || 0 : Number(record.this_month_total) || 0;
  const certified = hasCertifiedAmount(record.client_certified_amount) ? Number(record.client_certified_amount) : Number(inv.amount) || 0;
  const cols = [7, 13, 40, 16, 18];
  const last = cols.length;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = co.name || '';
  const ws = documentSheet(workbook, 'Invoice', cols, {
    docRef: [inv.invoice_no, DOCUMENT_KIND.invoice].filter(Boolean).join(' · '),
  });
  let row = addLetterhead(workbook, ws, {
    lastCol: last, logo, companyName: co.name, address: co.letterhead_address,
    kind: DOCUMENT_KIND.invoice, subtitle: kind === 'jsr' ? record.jsr_no : record.claim_no, docNo: inv.invoice_no,
  });
  row = addSectionTitle(ws, row, 'Invoice details', last);
  row = addDetails(ws, row, [
    ['Invoice date', inv.invoice_date ? formatDate(inv.invoice_date) : ''],
    ['Reference', inv.reference || (kind === 'jsr' ? record.jsr_no : record.claim_no)],
    ['Bill to', `${ct.client_name || '—'}\nAttn: ${ct.client_attn || '—'}`, 'full'],
    ['Contract', ct.contract_title, 'full'],
    ['LOA reference', ct.loa],
    ['PC No.', ct.pc_no == null ? '' : String(ct.pc_no)],
  ], last);

  const items = kind === 'jsr' ? (record.items || []) : [];
  if (items.length) {
    row = addSectionTitle(ws, row, 'Work items', last);
    row = addTable(ws, row, ['S/No', 'Item no.', 'Description', 'Unit rate (S$)', 'Amount (S$)'],
      items.map((it, i) => [i + 1, it.code || 'NA', it.description || '', Number(lineRate(it, decided)) || 0, Number(lineAmount(it, decided)) || 0]),
      { money: [3, 4], wrap: [2] });
  }
  row = addSectionTitle(ws, row, 'Amounts', last);
  row = addTotals(ws, row, [
    { label: 'Submitted claim amount', value: submitted },
    { label: 'Client certified amount', value: certified },
    { label: clientAdjustment(submitted, certified).label, value: clientAdjustment(submitted, certified).amount },
    { label: 'Invoice amount (S$)', value: Number(inv.amount) || 0, strong: true },
  ], { labelCol: 3, valueCol: 5, lastCol: last, words: amountInWords(inv.amount) });
  if (inv.notes) row = addNote(ws, row, inv.notes, last);
  addSignoff(ws, row + 1,
    { label: `For ${signoff.submitted_by_company || co.name || ''}`, lines: [signoff.submitted_by_name || ''] },
    { label: 'Received and acknowledged by', lines: [signoff.checked_by_company || ct.client_name || 'Client'] },
    last);
  return saveWorkbook(workbook, `${fileSafeName(inv.invoice_no) || 'invoice'}.xlsx`);
}

export { fmtMoney, MONEY_FMT };
