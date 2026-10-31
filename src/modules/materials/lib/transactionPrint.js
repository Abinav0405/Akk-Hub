import { parseQty, parseReturnQty } from '@/modules/materials/lib/inventory';
import { escapeHtml } from '@/modules/materials/lib/utils';
import { openPrintDocument } from '@/modules/materials/lib/printDocument';
import {
    formatDisplayDate,
    formatDisplayDateTime,
    formatFileDate,
    todayIsoDate,
} from '@/modules/materials/lib/dates';

export { escapeHtml };

const COMPANY_NAME = 'AKK ENGINEERING PTE. LTD.';
const COMPANY_ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';
const LOGO_PATH = '/Akk-logo.png';

/*
 * Logo for the letterhead. Print documents are written into blank windows / iframes where a
 * relative image may not have loaded before print() fires, so the logo is fetched once,
 * shrunk and inlined as a data URL. Until it is ready the letterhead prints without it.
 */
let logoDataUrl = '';
function preloadLogo() {
    if (typeof window === 'undefined' || typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => {
        try {
            const size = 160;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            logoDataUrl = canvas.toDataURL('image/png');
        } catch {
            logoDataUrl = '';
        }
    };
    img.src = LOGO_PATH;
}
preloadLogo();

/*
 * A4 document styles. The page is 794 px wide at 96 dpi (the native PDF renderer uses
 * exactly that), so screen padding doubles as the page margin; browser print uses @page.
 */
export const PRINT_STYLES = `
  @page { size: A4; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  body {
    margin: 0 auto;
    max-width: 794px;
    padding: 44px 46px 40px;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, system-ui, sans-serif;
    font-size: 11.5px;
    line-height: 1.45;
    color: #17243b;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: Consolas, 'SF Mono', Menlo, 'Courier New', monospace; font-size: 10.5px; }
  .muted { color: #687386; }

  /* Letterhead */
  .lh { display: flex; align-items: center; gap: 14px; padding-bottom: 14px; border-bottom: 2px solid #b30d32; }
  .lh-logo { width: 54px; height: 54px; object-fit: contain; flex: none; }
  .lh-co { flex: 1; min-width: 0; }
  .lh-name { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: 0.04em; color: #17243b; }
  .lh-addr { margin: 3px 0 0; font-size: 10.5px; color: #687386; }
  .lh-doc { text-align: right; flex: none; }
  .lh-title { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #b30d32; }
  .lh-sub { margin: 3px 0 0; font-size: 10.5px; color: #687386; }

  /* Reference / details block */
  .facts { margin-top: 16px; border: 1px solid #d6dae2; }
  .facts td { padding: 6px 10px; border: 1px solid #e5e8ee; font-size: 11px; }
  .facts .k { width: 17%; color: #687386; font-weight: 600; background: #f7f8fa; white-space: nowrap; }
  .facts .v { width: 33%; font-weight: 600; color: #17243b; }
  .status { display: inline-block; padding: 1px 7px; border: 1px solid currentColor; border-radius: 3px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; }
  .st-approved { color: #168653; }
  .st-declined { color: #c62828; }
  .st-pending { color: #b77916; }

  /* Section headings */
  .sec { margin: 18px 0 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #17243b; }
  .sec span { font-weight: 500; letter-spacing: 0.02em; text-transform: none; color: #687386; }

  /* Materials table */
  .items { border: 1px solid #d6dae2; table-layout: fixed; }
  .items thead { display: table-header-group; }
  .items th { padding: 6px 8px; background: #17243b; color: #fff; font-size: 9.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
  .items td { padding: 7px 8px; border-top: 1px solid #e5e8ee; font-size: 11px; }
  .items tbody tr { break-inside: avoid; page-break-inside: avoid; }
  .items tbody tr:nth-child(even) td { background: #fafbfc; }
  .items .no { width: 26px; color: #687386; }
  .items .code { width: 64px; }
  .items .unit { width: 46px; }
  .items .q { width: 66px; }
  .items .stc { width: 122px; }
  .items .desc { font-weight: 600; word-break: break-word; }
  .items tfoot td { padding: 6px 8px; border-top: 1px solid #d6dae2; background: #f7f8fa; font-size: 10.5px; font-weight: 600; }
  .out { font-weight: 700; color: #8f5d0f; }

  /* Return record */
  .rec { border: 1px solid #e5e8ee; }
  .rec th { padding: 5px 8px; background: #f7f8fa; border-bottom: 1px solid #e5e8ee; font-size: 9.5px; font-weight: 600; color: #687386; letter-spacing: 0.04em; text-transform: uppercase; }
  .rec td { padding: 5px 8px; border-top: 1px solid #eef0f4; font-size: 10.5px; }

  /* Notes, approval, signatures */
  .note { margin-top: 12px; padding: 8px 10px; border-left: 3px solid #b77916; background: #fbf8f1; font-size: 11px; }
  .note b { display: block; margin-bottom: 2px; font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #8f5d0f; }
  .signs { display: table; width: 100%; margin-top: 30px; table-layout: fixed; break-inside: avoid; page-break-inside: avoid; }
  .sign { display: table-cell; padding-right: 22px; }
  .sign:last-child { padding-right: 0; }
  .sign-role { font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #687386; }
  .sign-line { height: 40px; border-bottom: 1px solid #17243b; }
  .sign-meta { margin-top: 5px; font-size: 10.5px; }
  .sign-meta div { display: flex; gap: 6px; padding: 2px 0; }
  .sign-meta span { color: #687386; min-width: 34px; }
  .sign-meta strong { font-weight: 600; }

  /* Report (bulk) */
  .summary { margin-top: 16px; border: 1px solid #d6dae2; }
  .summary td { padding: 7px 10px; border-left: 1px solid #e5e8ee; font-size: 11px; }
  .summary td:first-child { border-left: 0; }
  .summary .k { display: block; font-size: 9.5px; font-weight: 600; color: #687386; letter-spacing: 0.05em; text-transform: uppercase; }
  .summary .v { font-weight: 700; font-size: 12px; }
  .entry { margin-top: 16px; break-inside: avoid; page-break-inside: avoid; }
  .entry-head { display: flex; align-items: baseline; gap: 10px; padding: 7px 10px; border: 1px solid #d6dae2; border-bottom: 0; background: #f7f8fa; }
  .entry-no { font-weight: 700; color: #b30d32; min-width: 22px; }
  .entry-who { flex: 1; min-width: 0; font-weight: 700; font-size: 12px; }
  .entry-who span { font-weight: 500; color: #687386; }
  .entry-when { color: #687386; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .entry-sub { padding: 5px 10px; border: 1px solid #d6dae2; border-bottom: 0; font-size: 10.5px; color: #687386; }
  .entry-sub b { color: #17243b; font-weight: 600; }
  .entry-sub i { font-style: normal; margin: 0 6px; color: #c3c8d1; }

  /* Footer */
  .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #e5e8ee; display: flex; justify-content: space-between; gap: 12px; font-size: 9.5px; color: #98a1b0; }

  @media print {
    body { padding: 0; max-width: none; }
  }
`;

/**
 * Build Map: reference_number → [{ returner, workerId, quantity, date, time }, ...]
 * from an array of approved return transactions.
 */
export function buildReturnHistoryMap(approvedReturns) {
    const map = new Map();
    for (const txn of approvedReturns || []) {
        for (const mat of txn.materials || []) {
            const ref = String(mat.reference_number || '').trim();
            if (!ref) continue;
            const quantity = parseReturnQty(mat.return_quantity);
            if (quantity <= 0) continue;
            if (!map.has(ref)) map.set(ref, []);
            map.get(ref).push({
                returner: txn.worker_name || 'Unknown',
                workerId: txn.worker_id || '',
                quantity,
                unit: mat.unit || '',
                date: txn.transaction_date || '',
                time: txn.transaction_time || '',
            });
        }
    }
    return map;
}

/** Fetch all approved return transactions once (ordered oldest → newest). */
export async function fetchApprovedReturnsOnce(supabaseClient) {
    const { data, error } = await supabaseClient
        .from('transactions')
        .select('*')
        .eq('transaction_type', 'return')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const e = (v) => escapeHtml(v ?? '');
const isReturnTx = (t) => t.transaction_type === 'return';

function docRef(transaction) {
    const raw = String(transaction.id || '').replace(/-/g, '');
    return raw ? `${isReturnTx(transaction) ? 'MR' : 'MI'}-${raw.slice(0, 8).toUpperCase()}` : '—';
}

function statusChip(status) {
    const s = (status || 'pending').toLowerCase();
    const cls = s === 'approved' ? 'st-approved' : s === 'declined' ? 'st-declined' : 'st-pending';
    return `<span class="status ${cls}">${e(s.toUpperCase())}</span>`;
}

function dateTime(date, time) {
    return [formatDisplayDate(date) || date, time].filter(Boolean).join(' ');
}

/** Returned / outstanding for a take line, from the row's own return fields. */
function takeLine(material) {
    const qty = parseQty(material.quantity);
    const recorded = Math.min(qty, Math.max(0, parseReturnQty(material.returned_quantity)));
    const returned = material.returned ? qty : recorded;
    return { qty, returned, outstanding: Math.max(0, qty - returned) };
}

function lineStatus(transaction, material) {
    const status = transaction.approval_status || 'pending';
    if (isReturnTx(transaction)) {
        if (status === 'approved') return 'Return accepted';
        if (status === 'declined') return 'Return declined';
        return 'Awaiting approval';
    }
    if (status === 'pending') return 'Awaiting approval';
    if (status === 'declined') return 'Not issued';
    if (!material.reference_number) return 'No item code';
    const q = takeLine(material);
    if (q.outstanding === 0) return 'Fully returned';
    if (q.returned > 0) return 'Partially returned';
    return 'Not returned';
}

/** Per-unit totals so pieces, metres and sets are never added together. */
function unitTotals(rows) {
    const byUnit = new Map();
    for (const { unit, value } of rows) {
        const key = String(unit || '').trim().toLowerCase();
        if (!byUnit.has(key)) byUnit.set(key, { unit: String(unit || '').trim(), value: 0 });
        byUnit.get(key).value += value;
    }
    return [...byUnit.values()]
        .filter((u) => u.value > 0)
        .map((u) => `${u.value}${u.unit ? `&nbsp;${e(u.unit)}` : ''}`)
        .join('<br>') || '0';
}

function returnRecords(transaction, returnHistoryMap) {
    if (isReturnTx(transaction) || transaction.approval_status !== 'approved') return [];
    const rows = [];
    for (const m of transaction.materials || []) {
        const ref = String(m.reference_number || '').trim();
        if (!ref) continue;
        const history = returnHistoryMap?.get(ref) || [];
        for (const h of history) {
            // Returns are allocated per worker; older maps without workerId keep every entry.
            if (h.workerId && transaction.worker_id && h.workerId !== transaction.worker_id) continue;
            rows.push({ ...h, ref, name: m.name, unit: h.unit || m.unit || '' });
        }
    }
    return rows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

// ── Sections ───────────────────────────────────────────────────────────────

function letterhead(title, sub) {
    const logo = logoDataUrl ? `<img class="lh-logo" src="${logoDataUrl}" alt="" />` : '';
    return `
  <header class="lh">
    ${logo}
    <div class="lh-co">
      <h1 class="lh-name">${COMPANY_NAME}</h1>
      <p class="lh-addr">${COMPANY_ADDRESS}</p>
    </div>
    <div class="lh-doc">
      <p class="lh-title">${e(title)}</p>
      ${sub ? `<p class="lh-sub">${sub}</p>` : ''}
    </div>
  </header>`;
}

function materialsTable(transaction) {
    const materials = transaction.materials || [];
    const take = !isReturnTx(transaction);
    const showReturns = take && transaction.approval_status === 'approved';
    if (!materials.length) return '<p class="muted">No materials recorded on this request.</p>';

    const issuedRows = [];
    const returnedRows = [];
    const outRows = [];
    const body = materials.map((m, i) => {
        const unit = m.unit || '';
        let cells;
        if (take) {
            const q = takeLine(m);
            issuedRows.push({ unit, value: q.qty });
            if (showReturns && m.reference_number) {
                returnedRows.push({ unit, value: q.returned });
                outRows.push({ unit, value: q.outstanding });
            }
            const has = showReturns && m.reference_number;
            cells = `
          <td class="num">${e(q.qty)}</td>
          <td class="num">${has ? e(q.returned) : '—'}</td>
          <td class="num${has && q.outstanding ? ' out' : ''}">${has ? e(q.outstanding) : '—'}</td>`;
        } else {
            const back = parseReturnQty(m.return_quantity);
            const of = parseQty(m.quantity);
            issuedRows.push({ unit, value: back });
            cells = `
          <td class="num">${e(of)}</td>
          <td class="num">${e(back)}</td>`;
        }
        return `
        <tr>
          <td class="no">${i + 1}</td>
          <td class="mono">${e(m.reference_number || '—')}</td>
          <td class="desc">${e(m.name || 'Unnamed material')}</td>
          <td>${e(unit)}</td>${cells}
          <td>${e(lineStatus(transaction, m))}</td>
        </tr>`;
    }).join('');

    const head = take
        ? '<th class="q num">Issued</th><th class="q num">Returned</th><th class="q num">Outst.</th>'
        : '<th class="q num">Taken</th><th class="q num">Returning</th>';
    const foot = take
        ? `<td class="num">${unitTotals(issuedRows)}</td><td class="num">${showReturns ? unitTotals(returnedRows) : '—'}</td><td class="num">${showReturns ? unitTotals(outRows) : '—'}</td>`
        : `<td></td><td class="num">${unitTotals(issuedRows)}</td>`;

    return `
    <table class="items">
      <colgroup><col class="no"/><col class="code"/><col/><col class="unit"/>${take ? '<col class="q"/><col class="q"/><col class="q"/>' : '<col class="q"/><col class="q"/>'}<col class="stc"/></colgroup>
      <thead><tr><th class="no">#</th><th class="code">Code</th><th>Description</th><th class="unit">Unit</th>${head}<th class="stc">Status</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="4">Total · ${materials.length} line${materials.length === 1 ? '' : 's'}</td>${foot}<td></td></tr></tfoot>
    </table>`;
}

function returnRecordTable(records) {
    if (!records.length) return '';
    const rows = records.map((r) => `
        <tr>
          <td class="num" style="text-align:left">${e(dateTime(r.date, r.time))}</td>
          <td class="mono">${e(r.ref)}</td>
          <td>${e(r.name)}</td>
          <td class="num">${e(r.quantity)}${r.unit ? `&nbsp;${e(r.unit)}` : ''}</td>
          <td>${e(r.returner)}</td>
        </tr>`).join('');
    return `
    <h2 class="sec">Return record <span>— approved returns for these items by this employee</span></h2>
    <table class="rec">
      <thead><tr><th style="width:110px">Date</th><th style="width:70px">Code</th><th>Description</th><th class="num" style="width:80px">Qty</th><th style="width:170px">Returned by</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function detailsBlock(transaction) {
    const decided = transaction.approval_status === 'approved' || transaction.approval_status === 'declined';
    const decisionLabel = transaction.approval_status === 'declined' ? 'Declined by' : 'Approved by';
    return `
    <table class="facts">
      <tr>
        <td class="k">Employee</td><td class="v">${e(transaction.worker_name || '—')}</td>
        <td class="k">Reference</td><td class="v mono">${e(docRef(transaction))}</td>
      </tr>
      <tr>
        <td class="k">Employee ID</td><td class="v">${e(transaction.worker_id || '—')}</td>
        <td class="k">Request date</td><td class="v">${e(dateTime(transaction.transaction_date, transaction.transaction_time) || '—')}</td>
      </tr>
      <tr>
        <td class="k">Site</td><td class="v">${e(transaction.site_name || '—')}</td>
        <td class="k">Status</td><td class="v">${statusChip(transaction.approval_status)}</td>
      </tr>
      ${decided ? `
      <tr>
        <td class="k">${decisionLabel}</td><td class="v">${e(transaction.approved_by || '—')}</td>
        <td class="k">Decision date</td><td class="v">${e(formatDisplayDateTime(transaction.approval_date) || transaction.approval_date || '—')}</td>
      </tr>` : ''}
    </table>`;
}

function signatureBlock(transaction) {
    const take = !isReturnTx(transaction);
    const sign = (role, name) => `
      <div class="sign">
        <div class="sign-role">${role}</div>
        <div class="sign-line"></div>
        <div class="sign-meta">
          <div><span>Name</span><strong>${name ? e(name) : '&nbsp;'}</strong></div>
          <div><span>Date</span><strong>&nbsp;</strong></div>
        </div>
      </div>`;
    return `
    <div class="signs">
      ${sign(take ? 'Requested by' : 'Returned by', transaction.worker_name)}
      ${sign(transaction.approval_status === 'declined' ? 'Declined by' : 'Approved by', transaction.approved_by)}
      ${sign(take ? 'Issued by (store)' : 'Received by (store)', '')}
    </div>`;
}

function footer(printedAt) {
    return `<footer class="foot"><span>System-generated by AKK Hub · Material Tracker</span><span>Printed ${e(printedAt)}</span></footer>`;
}

function wrapDocument(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${e(title)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>${body}
</body>
</html>`;
}

// ── Documents ──────────────────────────────────────────────────────────────

export function buildSingleTransactionHtml(transaction, returnHistoryMap = new Map()) {
    const printedAt = formatDisplayDateTime(new Date());
    const take = !isReturnTx(transaction);
    const title = take ? 'Material Issue Voucher' : 'Material Return Voucher';
    const body = `
  ${letterhead(title, `Ref <span class="mono">${e(docRef(transaction))}</span>`)}
  ${detailsBlock(transaction)}
  <h2 class="sec">Materials</h2>
  ${materialsTable(transaction)}
  ${returnRecordTable(returnRecords(transaction, returnHistoryMap))}
  ${transaction.notes ? `<div class="note"><b>Remarks</b>${e(transaction.notes)}</div>` : ''}
  ${signatureBlock(transaction)}
  ${footer(printedAt)}`;
    return wrapDocument(singlePrintTitle(transaction), body);
}

function reportEntry(transaction, index, returnHistoryMap) {
    const take = !isReturnTx(transaction);
    const decided = transaction.approval_status !== 'pending' && transaction.approved_by;
    return `
  <section class="entry">
    <div class="entry-head">
      <span class="entry-no">${index}.</span>
      <span class="entry-who">${e(transaction.worker_name || '—')} <span>· ID ${e(transaction.worker_id || '—')}</span></span>
      <span class="entry-when">${e(dateTime(transaction.transaction_date, transaction.transaction_time))}</span>
    </div>
    <div class="entry-sub">
      <b>${take ? 'TAKE' : 'RETURN'}</b><i>|</i>${statusChip(transaction.approval_status)}<i>|</i>Ref <span class="mono">${e(docRef(transaction))}</span>
      ${transaction.site_name ? `<i>|</i>Site <b>${e(transaction.site_name)}</b>` : ''}
      ${decided ? `<i>|</i>${transaction.approval_status === 'declined' ? 'Declined' : 'Approved'} by <b>${e(transaction.approved_by)}</b>${transaction.approval_date ? ` · ${e(formatDisplayDateTime(transaction.approval_date))}` : ''}` : ''}
    </div>
    ${materialsTable(transaction)}
    ${returnRecordTable(returnRecords(transaction, returnHistoryMap))}
    ${transaction.notes ? `<div class="note"><b>Remarks</b>${e(transaction.notes)}</div>` : ''}
  </section>`;
}

export function buildBulkTransactionsHtml(transactions, returnHistoryMap = new Map(), meta = {}) {
    // Sort ascending so the first page shows the oldest date (do not mutate caller array).
    const sorted = [...transactions].sort(compareTransactionsAscending);
    const printedAt = formatDisplayDateTime(new Date());
    const counts = { take: 0, return: 0, pending: 0, approved: 0, declined: 0 };
    for (const t of sorted) {
        counts[isReturnTx(t) ? 'return' : 'take']++;
        if (counts[t.approval_status] !== undefined) counts[t.approval_status]++;
    }
    const period = meta.startDate || meta.endDate
        ? `${formatDisplayDate(meta.startDate) || 'Start'} – ${formatDisplayDate(meta.endDate) || 'End'}`
        : sorted.length
            ? `${formatDisplayDate(sorted[0].transaction_date)} – ${formatDisplayDate(sorted[sorted.length - 1].transaction_date)}`
            : '—';
    const scope = meta.workerId ? `Employee ID ${meta.workerId}` : meta.filterNote || 'All employees';

    const body = `
  ${letterhead('Material Transaction Report', `${sorted.length} request${sorted.length === 1 ? '' : 's'}`)}
  <table class="summary"><tr>
    <td><span class="k">Period</span><span class="v">${e(period)}</span></td>
    <td><span class="k">Scope</span><span class="v">${e(scope)}</span></td>
    <td><span class="k">Take / Return</span><span class="v">${counts.take} / ${counts.return}</span></td>
    <td><span class="k">Approved · Pending · Declined</span><span class="v">${counts.approved} · ${counts.pending} · ${counts.declined}</span></td>
  </tr></table>
  ${sorted.map((t, i) => reportEntry(t, i + 1, returnHistoryMap)).join('')}
  <div class="signs">
    <div class="sign"><div class="sign-role">Prepared by</div><div class="sign-line"></div><div class="sign-meta"><div><span>Name</span><strong>&nbsp;</strong></div><div><span>Date</span><strong>&nbsp;</strong></div></div></div>
    <div class="sign"><div class="sign-role">Verified by</div><div class="sign-line"></div><div class="sign-meta"><div><span>Name</span><strong>&nbsp;</strong></div><div><span>Date</span><strong>&nbsp;</strong></div></div></div>
    <div class="sign"></div>
  </div>
  ${footer(printedAt)}`;
    return wrapDocument('Material Transaction Report', body);
}

function openPrintWindow(html, meta = {}) {
    return openPrintDocument(html, meta);
}

function singlePrintTitle(transaction) {
    const date = formatDisplayDate(transaction.transaction_date) || String(transaction.transaction_date || '');
    return `${transaction.worker_id || 'txn'} ${date} ${transaction.transaction_time || ''}`.trim();
}

/** Print one transaction as an issue / return voucher. */
export function printSingleTransaction(transaction, returnHistoryMap = new Map()) {
    openPrintWindow(buildSingleTransactionHtml(transaction, returnHistoryMap), {
        id: transaction.worker_id || transaction.id || 'NA',
        date: formatFileDate(transaction.transaction_date || todayIsoDate()),
        formName: 'Receipt',
    });
}

/** Oldest → newest for bulk/report print only (UI lists stay newest-first). */
function compareTransactionsAscending(a, b) {
    const dateCmp = String(a.transaction_date || '').localeCompare(String(b.transaction_date || ''));
    if (dateCmp !== 0) return dateCmp;
    const timeCmp = String(a.transaction_time || '').localeCompare(String(b.transaction_time || ''));
    if (timeCmp !== 0) return timeCmp;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

/**
 * Print many transactions as a history report.
 * @param {object} meta - optional { startDate, endDate, workerId, filterNote }
 */
export function printBulkTransactions(transactions, returnHistoryMap = new Map(), meta = {}) {
    if (!transactions?.length) {
        const err = new Error('NO_TRANSACTIONS');
        err.code = 'NO_TRANSACTIONS';
        throw err;
    }
    openPrintWindow(buildBulkTransactionsHtml(transactions, returnHistoryMap, meta), {
        id: meta.workerId || 'ALL',
        date: formatFileDate(meta.startDate || meta.endDate || todayIsoDate()),
        formName: 'Bulk Print',
    });
}
