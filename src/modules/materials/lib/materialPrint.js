import { formatHistoryEntry, LOW_STOCK_THRESHOLD } from '@/modules/materials/lib/inventory';
import { escapeHtml } from '@/modules/materials/lib/utils';
import { openPrintDocument } from '@/modules/materials/lib/printDocument';
import { formatDisplayDateTime, formatFileDate, todayIsoDate } from '@/modules/materials/lib/dates';

export { escapeHtml };

function stockStatus(material) {
    if (material.quantity === 0) return { label: 'Out of Stock', class: 'status-out' };
    if (material.quantity <= LOW_STOCK_THRESHOLD) return { label: 'Low Stock', class: 'status-low' };
    return { label: 'In Stock', class: 'status-in' };
}

const PRINT_STYLES = `
    * { box-sizing: border-box; }
    body { font-family: Segoe UI, Calibri, system-ui, sans-serif; margin: 0; padding: 24px; color: #1e293b; background: #fff; }
    .accent-bar { height: 4px; background: #dc6b2f; margin: -24px -24px 20px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
    .company { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; letter-spacing: 0.02em; }
    .subtitle { font-size: 15px; font-weight: 600; margin: 10px 0 0; color: #334155; }
    .meta { font-size: 12px; color: #64748b; margin-top: 6px; }
    table.summary { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
    table.summary th { background: #334155; color: #fff; text-align: left; padding: 10px 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.summary td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
    table.summary tr:nth-child(even) td { background: #f8fafc; }
    .mono { font-family: Consolas, Courier New, monospace; }
    .status-in { color: #15803d; font-weight: 600; }
    .status-low { color: #b45309; font-weight: 600; }
    .status-out { color: #dc2626; font-weight: 600; }
    .material-block { margin-bottom: 28px; page-break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .material-block-header { background: #f1f5f9; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; font-size: 14px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .material-block-body { padding: 12px 16px; }
    .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; font-size: 13px; }
    .detail-grid label { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
    .history-title { font-size: 13px; font-weight: 600; color: #475569; margin: 12px 0 8px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .history-item { border-left: 3px solid #cbd5e1; padding: 8px 12px; margin-bottom: 8px; background: #f8fafc; font-size: 12px; }
    .history-item.take { border-left-color: #f97316; }
    .history-item.return { border-left-color: #22c55e; }
    .history-item.restock { border-left-color: #3b82f6; }
    .history-item.adjustment { border-left-color: #64748b; }
    .history-date { color: #64748b; font-size: 11px; margin-top: 2px; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 12px; } .accent-bar { margin: -12px -12px 16px; } .material-block { page-break-inside: avoid; } }
`;

function renderHistory(entries) {
    if (!entries?.length) {
        return '<p style="color:#94a3b8;font-size:12px;margin:0;">No history recorded.</p>';
    }
    return entries.map((entry) => {
        const fmt = formatHistoryEntry(entry);
        const typeClass = entry.action_type || 'adjustment';
        return '<div class="history-item ' + typeClass + '"><div>' + escapeHtml(fmt.text) + '</div><div class="history-date">' + escapeHtml(fmt.date) + '</div></div>';
    }).join('');
}

function renderMaterialDetails(material) {
    const status = stockStatus(material);
    return '<div class="detail-grid">' +
        '<div><label>Ref No.</label><span class="mono">#' + escapeHtml(material.reference_number) + '</span></div>' +
        '<div><label>Name</label><span>' + escapeHtml(material.name) + '</span></div>' +
        '<div><label>Quantity</label><span>' + escapeHtml(material.quantity) + ' ' + escapeHtml(material.unit) + '</span></div>' +
        '<div><label>Status</label><span class="' + status.class + '">' + status.label + '</span></div>' +
        '</div>';
}

function renderSummaryTable(materials) {
    const rows = materials.map((m) => {
        const status = stockStatus(m);
        return '<tr><td class="mono">#' + escapeHtml(m.reference_number) + '</td><td>' + escapeHtml(m.name) + '</td><td style="text-align:center;font-weight:600;">' + escapeHtml(m.quantity) + '</td><td>' + escapeHtml(m.unit) + '</td><td class="' + status.class + '">' + status.label + '</td></tr>';
    }).join('');
    return '<table class="summary"><thead><tr><th>Ref No.</th><th>Name</th><th style="text-align:center;">Qty</th><th>Unit</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function renderMaterialBlock(material, historyEntries, includeHistory) {
    const historyHtml = includeHistory ? '<div class="history-title">Movement History</div>' + renderHistory(historyEntries) : '';
    return '<div class="material-block">' +
        '<div class="material-block-header">#' + escapeHtml(material.reference_number) + ' — ' + escapeHtml(material.name) + '</div>' +
        '<div class="material-block-body">' + renderMaterialDetails(material) + historyHtml + '</div>' +
        '</div>';
}

function buildPrintDocument({ title, subtitle, bodyHtml, countLabel }) {
    const printedAt = formatDisplayDateTime(new Date());
    return '<!DOCTYPE html><html><head><title>' + escapeHtml(title) + '</title><style>' + PRINT_STYLES + '</style></head><body>' +
        '<div class="accent-bar"></div>' +
        '<div class="header"><p class="company">AKK ENGINEERING PTE. LTD.</p><p class="subtitle">' + escapeHtml(subtitle) + '</p><p class="meta">Printed ' + printedAt + (countLabel ? ' · ' + escapeHtml(countLabel) : '') + '</p></div>' +
        bodyHtml +
        '<p class="footer">AKK Material Tracker · ' + printedAt + '</p></body></html>';
}

export function openMaterialPrint(html, meta = {}) {
    return openPrintDocument(html, meta);
}

export function printSingleMaterial(material, historyEntries, includeHistory) {
    const subtitle = includeHistory ? 'Material Report — With History' : 'Material Report — Summary Only';
    const body = renderMaterialBlock(material, historyEntries, includeHistory);
    openMaterialPrint(
        buildPrintDocument({
            title: 'Material #' + material.reference_number,
            subtitle,
            countLabel: '#' + material.reference_number + ' ' + material.name,
            bodyHtml: body,
        }),
        {
            id: material.reference_number || material.id || 'NA',
            date: formatFileDate(todayIsoDate()),
            formName: 'Material Report',
        }
    );
}

export function printAllMaterials(materials, historyMap, includeHistory) {
    const subtitle = includeHistory ? 'Materials Inventory — Full Report With History' : 'Materials Inventory — Summary List';
    const bodyHtml = includeHistory
        ? materials.map((m) => renderMaterialBlock(m, historyMap[m.id] || [], true)).join('')
        : renderSummaryTable(materials);
    openMaterialPrint(
        buildPrintDocument({
            title: 'Materials Inventory',
            subtitle,
            countLabel: materials.length + ' material(s)',
            bodyHtml,
        }),
        {
            id: 'ALL',
            date: formatFileDate(todayIsoDate()),
            formName: 'Inventory Report',
        }
    );
}
