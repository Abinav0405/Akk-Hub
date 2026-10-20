import { parseReturnQty } from '@/modules/materials/lib/inventory';
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

export const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Calibri, system-ui, sans-serif;
    margin: 0;
    padding: 24px;
    color: #1e293b;
    background: #fff;
    font-size: 13px;
    line-height: 1.45;
  }
  .accent-bar {
    height: 4px;
    background: #dc6b2f;
    margin: -24px -24px 20px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-header {
    text-align: center;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .company-name {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #0f172a;
  }
  .company-address {
    margin: 6px 0 0;
    font-size: 12px;
    color: #64748b;
  }
  .doc-title {
    margin: 12px 0 0;
    font-size: 15px;
    font-weight: 600;
    color: #334155;
  }
  .doc-meta {
    margin-top: 8px;
    font-size: 12px;
    color: #64748b;
  }
  .doc-meta span { margin: 0 6px; }
  .report-filters {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 20px;
    font-size: 12px;
    color: #475569;
  }
  .txn-block {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 20px;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .txn-head {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 12px 16px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .txn-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 20px;
  }
  .info-row { font-size: 13px; }
  .info-row .label {
    display: inline-block;
    min-width: 110px;
    font-weight: 600;
    color: #475569;
  }
  .info-row .value { color: #0f172a; }
  .txn-body { padding: 14px 16px 16px; }
  .section-title {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }
  table.materials {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  table.materials th {
    background: #334155;
    color: #fff;
    text-align: left;
    padding: 8px 10px;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table.materials td {
    padding: 9px 10px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
  }
  table.materials tr:nth-child(even) td { background: #f8fafc; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .badge-take { background: #ffedd5; color: #9a3412; }
  .badge-return { background: #dcfce7; color: #166534; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-approved { background: #dcfce7; color: #166534; }
  .badge-declined { background: #fee2e2; color: #991b1b; }
  .status-pill {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: #dcfce7;
    color: #166534;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .return-timeline { margin: 0; padding: 0; list-style: none; }
  .return-timeline li {
    border-left: 3px solid #94a3b8;
    padding: 4px 0 4px 10px;
    margin: 4px 0;
    font-size: 11px;
    color: #334155;
    background: #f8fafc;
  }
  .return-timeline li.full { border-left-color: #16a34a; background: #f0fdf4; }
  .return-timeline li.partial { border-left-color: #ea580c; background: #fff7ed; }
  .return-timeline .when { color: #64748b; font-size: 10px; }
  .muted { color: #94a3b8; }
  .notes-box {
    margin-top: 12px;
    padding: 10px 12px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    font-size: 12px;
    color: #78350f;
  }
  .approval-box {
    margin-top: 12px;
    padding: 10px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 12px;
    color: #334155;
    max-width: 320px;
  }
  .approval-box strong { color: #0f172a; }
  .signature-line {
    margin-top: 18px;
    border-bottom: 1px solid #94a3b8;
    width: 180px;
    height: 1px;
  }
  .sig-label { font-size: 10px; color: #94a3b8; margin-top: 4px; }
  .doc-footer {
    margin-top: 24px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 11px;
    color: #94a3b8;
    text-align: center;
  }
  @media print {
    body { padding: 12px; }
    .accent-bar { margin: -12px -12px 16px; }
    .txn-block { page-break-inside: avoid; break-inside: avoid; }
  }
`;

/**
 * Build Map: reference_number → [{ returner, quantity, date, time }, ...]
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
                quantity,
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

function statusBadgeClass(status) {
    const s = (status || 'pending').toLowerCase();
    if (s === 'approved') return 'badge-approved';
    if (s === 'declined') return 'badge-declined';
    return 'badge-pending';
}

function typeBadge(type) {
    const isReturn = type === 'return';
    return `<span class="badge ${isReturn ? 'badge-return' : 'badge-take'}">${isReturn ? 'RETURN' : 'TAKE'}</span>`;
}

function statusBadge(status) {
    const label = (status || 'pending').toUpperCase();
    return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(label)}</span>`;
}

function renderReturnStatusCell(material, transactionType, returnHistoryMap) {
    if (transactionType === 'return') {
        const returned = material.return_quantity ?? material.returned_quantity ?? material.quantity;
        return `<span class="status-pill">Returned ${escapeHtml(returned)}/${escapeHtml(material.quantity)}</span>`;
    }

    const ref = String(material.reference_number || '').trim();
    if (!ref) {
        return '<span class="muted">Not Returned</span>';
    }

    const history = returnHistoryMap?.get(ref) || returnHistoryMap?.get(material.reference_number);
    if (!history || history.length === 0) {
        if (material.returned) {
            return `Returned (${escapeHtml(formatDisplayDateTime(material.return_date) || material.return_date || '')})`;
        }
        return 'Taken to Site<br><span class="muted">Not Returned</span>';
    }

    const totalReturned = history.reduce((sum, entry) => sum + entry.quantity, 0);
    const remaining = material.quantity - totalReturned;
    const isFullyReturned = remaining <= 0;

    let html = '<ul class="return-timeline">';
    for (const entry of history) {
        html += `<li>Returned <strong>${escapeHtml(entry.quantity)}</strong>/${escapeHtml(material.quantity)}`
            + ` ${escapeHtml(material.name)} by ${escapeHtml(entry.returner)}`
            + `<div class="when">${escapeHtml(formatDisplayDate(entry.date))} at ${escapeHtml(entry.time)}</div></li>`;
    }
    if (isFullyReturned) {
        html += `<li class="full">Fully returned ${escapeHtml(material.quantity)}/${escapeHtml(material.quantity)}`
            + ` ${escapeHtml(material.name)}<div class="when">All materials returned</div></li>`;
    } else {
        html += `<li class="partial">Partially returned ${escapeHtml(totalReturned)}/${escapeHtml(material.quantity)}`
            + ` ${escapeHtml(material.name)}<div class="when">Remaining to return: ${escapeHtml(remaining)}/${escapeHtml(material.quantity)}</div></li>`;
    }
    html += '</ul>';
    return html;
}

function renderMaterialsTable(transaction, returnHistoryMap) {
    const rows = (transaction.materials || []).map((m) => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.quantity)}</td>
        <td>${escapeHtml(m.unit)}</td>
        <td class="mono">${escapeHtml(m.reference_number || 'N/A')}</td>
        <td>${renderReturnStatusCell(m, transaction.transaction_type, returnHistoryMap)}</td>
      </tr>
    `).join('');

    return `
      <table class="materials">
        <thead>
          <tr>
            <th>Material Name</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Reference #</th>
            <th>Return / Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
}

function renderApprovalBlock(transaction, compact = false) {
    if (!transaction.approval_status || transaction.approval_status === 'pending') return '';
    const outcome = transaction.approval_status === 'approved' ? 'APPROVED' : 'DECLINED';
    const by = transaction.approved_by ? ` by ${escapeHtml(transaction.approved_by)}` : '';
    const on = transaction.approval_date
        ? ` on ${escapeHtml(formatDisplayDateTime(transaction.approval_date) || transaction.approval_date)}`
        : '';

    if (compact) {
        return `<div class="approval-box"><strong>${outcome}</strong>${by}${on}</div>`;
    }

    return `
      <div class="approval-box">
        <strong>This request was ${outcome}</strong>${by}${on}
        <div class="signature-line"></div>
        <div class="sig-label">Signature</div>
      </div>
    `;
}

function renderTransactionBlock(transaction, returnHistoryMap, { compactApproval = false } = {}) {
    const siteRow = transaction.site_name
        ? `<div class="info-row"><span class="label">Site:</span><span class="value">${escapeHtml(transaction.site_name)}</span></div>`
        : '';

    return `
      <div class="txn-block">
        <div class="txn-head">
          <div class="txn-grid">
            <div class="info-row"><span class="label">Type:</span><span class="value">${typeBadge(transaction.transaction_type)}</span></div>
            <div class="info-row"><span class="label">Status:</span><span class="value">${statusBadge(transaction.approval_status)}</span></div>
            <div class="info-row"><span class="label">Date:</span><span class="value">${escapeHtml(formatDisplayDate(transaction.transaction_date))}</span></div>
            <div class="info-row"><span class="label">Time:</span><span class="value">${escapeHtml(transaction.transaction_time)}</span></div>
            <div class="info-row"><span class="label">Worker Name:</span><span class="value">${escapeHtml(transaction.worker_name)}</span></div>
            <div class="info-row"><span class="label">Worker ID:</span><span class="value">${escapeHtml(transaction.worker_id)}</span></div>
            ${siteRow}
          </div>
        </div>
        <div class="txn-body">
          <h3 class="section-title">Materials</h3>
          ${renderMaterialsTable(transaction, returnHistoryMap)}
          ${transaction.notes ? `<div class="notes-box"><strong>Notes:</strong> ${escapeHtml(transaction.notes)}</div>` : ''}
          ${renderApprovalBlock(transaction, compactApproval)}
        </div>
      </div>
    `;
}

function buildDocument({ title, subtitle, filterHtml = '', bodyHtml }) {
    const printedAt = formatDisplayDateTime(new Date());
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  <div class="accent-bar"></div>
  <div class="doc-header">
    <h1 class="company-name">${COMPANY_NAME}</h1>
    <p class="company-address">${COMPANY_ADDRESS}</p>
    <p class="doc-title">${escapeHtml(subtitle)}</p>
    <p class="doc-meta">Printed ${escapeHtml(printedAt)}</p>
  </div>
  ${filterHtml}
  ${bodyHtml}
  <p class="doc-footer">AKK Material Tracker · ${escapeHtml(printedAt)}</p>
</body>
</html>`;
}

function openPrintWindow(html, meta = {}) {
    return openPrintDocument(html, meta);
}

function singlePrintTitle(transaction) {
    const date = formatDisplayDate(transaction.transaction_date) || String(transaction.transaction_date || '');
    return `${transaction.worker_id || 'txn'} ${date} ${transaction.transaction_time || ''}`.trim();
}

/** Print one transaction receipt. */
export function printSingleTransaction(transaction, returnHistoryMap = new Map()) {
    const html = buildDocument({
        title: singlePrintTitle(transaction),
        subtitle: 'Transaction Receipt',
        bodyHtml: renderTransactionBlock(transaction, returnHistoryMap, { compactApproval: false }),
    });
    openPrintWindow(html, {
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

    // Sort ascending so the first page shows the oldest date (do not mutate caller array).
    const sorted = [...transactions].sort(compareTransactionsAscending);

    const filterParts = [];
    if (meta.startDate || meta.endDate) {
        filterParts.push(
            `<strong>Period:</strong> ${escapeHtml(formatDisplayDate(meta.startDate) || meta.startDate || 'Start')} to ${escapeHtml(formatDisplayDate(meta.endDate) || meta.endDate || 'End')}`
        );
    }
    if (meta.workerId) {
        filterParts.push(`<strong>Worker ID:</strong> ${escapeHtml(meta.workerId)}`);
    } else if (meta.filterNote) {
        filterParts.push(escapeHtml(meta.filterNote));
    }
    filterParts.push(`<strong>Transactions:</strong> ${sorted.length}`);

    const filterHtml = filterParts.length
        ? `<div class="report-filters">${filterParts.join(' &nbsp;·&nbsp; ')}</div>`
        : '';

    const bodyHtml = sorted
        .map((t) => renderTransactionBlock(t, returnHistoryMap, { compactApproval: true }))
        .join('');

    const html = buildDocument({
        title: 'Transaction History Report',
        subtitle: 'Transaction History Report',
        filterHtml,
        bodyHtml,
    });
    openPrintWindow(html, {
        id: meta.workerId || 'ALL',
        date: formatFileDate(meta.startDate || meta.endDate || todayIsoDate()),
        formName: 'Bulk Print',
    });
}
