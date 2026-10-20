import { formatDate } from '@/modules/timesheet/lib/timeUtils';

/** Period line on payslip: dd/mm/yyyy */
export function formatPayslipPeriodRange(startDate, endDate) {
    const start = formatDate(startDate);
    const end = formatDate(endDate);
    if (!start && !end) return 'Not specified';
    if (start && end) return `${start} - ${end}`;
    return start || end;
}

/** Pay date on payslip: dd-mm-yyyy */
export function formatPayslipPayDate(date) {
    if (date == null || date === '') return 'Not specified';
    const raw = String(date).trim();
    if (!raw || raw === 'Not specified') return 'Not specified';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split('-');
        return `${d}-${m}-${y}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        const dd = String(parsed.getDate()).padStart(2, '0');
        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
        const yyyy = parsed.getFullYear();
        return `${dd}-${mm}-${yyyy}`;
    }

    return raw.replace(/\//g, '-');
}

/** Convert m/d/yyyy or d/m/yyyy slash dates to dd/mm/yyyy for display. */
export function normalizeSlashDateToDdMmYyyy(value) {
    const raw = String(value || '').trim();
    const parts = raw.split('/');
    if (parts.length !== 3) return raw;
    let d = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return raw;
    if (d <= 12 && m <= 12 && d !== m) {
        // Ambiguous — treat as US m/d/y when first segment looks like month.
        if (parts[0].length <= 2 && parseInt(parts[0], 10) <= 12 && parseInt(parts[1], 10) > 12) {
            m = d;
            d = parseInt(parts[1], 10);
        } else if (m > 12) {
            [d, m] = [m, d];
        }
    } else if (m > 12) {
        [d, m] = [m, d];
    }
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function patchWorkerInfoGrid(doc) {
    const labels = doc.querySelectorAll('span');
    for (const label of labels) {
        const txt = label.textContent?.trim() || '';
        const valueEl = label.nextElementSibling;
        if (!valueEl || valueEl.tagName !== 'SPAN') continue;

        if (txt === 'Period:') {
            const raw = valueEl.textContent?.trim() || '';
            const m = raw.match(/^(.+?)\s*-\s*(.+)$/);
            if (m) {
                valueEl.textContent = `${normalizeSlashDateToDdMmYyyy(m[1].trim())} - ${normalizeSlashDateToDdMmYyyy(m[2].trim())}`;
            }
        }
        if (txt === 'Pay Date:' || txt === 'Salary Paid Date:') {
            valueEl.textContent = formatPayslipPayDate(valueEl.textContent?.trim());
        }
    }
}

function patchDetailRows(doc) {
    doc.querySelectorAll('.detail-row').forEach((row) => {
        const label = row.querySelector('.detail-label')?.textContent?.trim();
        const valueEl = row.querySelector('.detail-value');
        if (!label || !valueEl) return;
        if (label === 'Period:') {
            const raw = valueEl.textContent?.trim() || '';
            const m = raw.match(/^(.+?)\s*-\s*(.+)$/);
            if (m) {
                valueEl.textContent = `${normalizeSlashDateToDdMmYyyy(m[1].trim())} - ${normalizeSlashDateToDdMmYyyy(m[2].trim())}`;
            }
        }
        if (label === 'Salary Paid Date:' || label === 'Pay Date:') {
            valueEl.textContent = formatPayslipPayDate(valueEl.textContent?.trim());
        }
    });
}

export const PAYSLIP_PRINT_CSS = `
@page { size: A4; margin: 10mm 12mm; }
body {
  font-family: 'Poppins', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 11px;
  line-height: 1.35;
  margin: 0;
  padding: 0;
  color: #333;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.payslip-sheet, .payslip-batch-page {
  page-break-inside: avoid;
  break-inside: avoid-page;
}
.payslip-batch-page {
  page-break-after: always;
  break-after: page;
}
.payslip-batch-page:last-child {
  page-break-after: auto;
  break-after: auto;
}
.payslip-sheet .header,
.payslip-batch-page .header {
  page-break-before: avoid !important;
  break-before: avoid-page !important;
  page-break-after: avoid !important;
  break-after: avoid-page !important;
  margin-bottom: 6px !important;
}
.payslip-sheet .worker-info,
.payslip-batch-page .worker-info {
  page-break-after: avoid !important;
  break-after: avoid-page !important;
  margin-bottom: 8px !important;
  padding: 10px 12px !important;
}
.payslip-sheet .salary-container,
.payslip-batch-page .salary-container,
.payslip-sheet [style*="grid-template-columns: repeat(4"],
.payslip-batch-page [style*="grid-template-columns: repeat(4"] {
  page-break-inside: avoid !important;
  break-inside: avoid-page !important;
}
.payslip-sheet .signature-section,
.payslip-batch-page .signature-section {
  page-break-inside: avoid !important;
  break-inside: avoid-page !important;
}
.salary-box {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 8px 10px;
  background-color: #fff;
  page-break-inside: avoid;
  break-inside: avoid-page;
  min-height: 72px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.addition-box { background-color: #f1f8e9; border-left: 3px solid #2e7d32; }
.deduction-box { background-color: #ffebee; border-left: 3px solid #c62828; }
.employer-box { background-color: #f5f5f5; border-left: 3px solid #616161; }
.amount-large { font-size: 14px; font-weight: 600; margin: 0 0 4px 0; color: #1b5e20; }
.amount-label { font-size: 11px; color: #5f6368; line-height: 1.3; font-weight: 500; }
.company-name { font-size: 14px; font-weight: bold; margin: 0; text-align: center; color: #111 !important; }
.company-address { margin: 2px 0 6px 0; font-size: 10px; text-align: center; }
.report-title { font-size: 12px; margin: 0 0 8px 0; border-bottom: 1px solid #000; padding-bottom: 4px; text-align: center; }
.header { text-align: center; margin-bottom: 6px; border-bottom: none !important; padding-bottom: 0 !important; }
.signature-line { border-bottom: 1px solid #333; height: 18px; margin: 0 auto 4px auto; width: 160px; }
.signature-section { margin-top: 16px; display: flex; justify-content: space-between; padding: 0 12px; }
.signature-section p { text-align: center; margin: 0; font-size: 12px; color: #5d4037; }
@media print {
  body { padding: 0 !important; background: #fff !important; }
}
`;

function stripBodyArtifacts(doc) {
    doc.body.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => el.remove());
    doc.querySelectorAll('.header[style*="page-break-before"]').forEach((el) => {
        el.style.pageBreakBefore = 'auto';
        el.style.breakBefore = 'auto';
    });
}

function ensurePayslipSheetWrapper(doc) {
    if (doc.body.querySelector('.payslip-sheet')) return;
    const sheet = doc.createElement('div');
    sheet.className = 'payslip-sheet';
    while (doc.body.firstChild) {
        sheet.appendChild(doc.body.firstChild);
    }
    doc.body.appendChild(sheet);
}

/**
 * Normalize stored/generated payslip HTML for printing (dates, page breaks, layout).
 */
export function normalizePayslipHtmlForPrint(html, { standalone = true } = {}) {
    if (!html || typeof html !== 'string') return html;

    let slice = html;
    const page2 = html.indexOf('<!-- PAGE 2: PAYSLIP -->');
    if (page2 !== -1) slice = html.slice(page2);

    const parser = new DOMParser();
    const doc = parser.parseFromString(slice.includes('<html') ? slice : `<html><body>${slice}</body></html>`, 'text/html');

    stripBodyArtifacts(doc);
    patchWorkerInfoGrid(doc);
    patchDetailRows(doc);

    const marker = doc.body.querySelector('*');
    if (marker && doc.body.innerHTML.includes('<!-- PAGE 2: PAYSLIP -->')) {
        const htmlStr = doc.body.innerHTML.replace(/<!-- PAGE 2: PAYSLIP -->/g, '');
        doc.body.innerHTML = htmlStr;
    }

    ensurePayslipSheetWrapper(doc);

    if (!standalone) {
        return doc.body.querySelector('.payslip-sheet')?.innerHTML || doc.body.innerHTML;
    }

    const headStyles = doc.head.querySelector('style')?.textContent || '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>${PAYSLIP_PRINT_CSS}\n${headStyles}</style></head><body>${doc.body.innerHTML}</body></html>`;
}

/** Merge multiple payslip documents into one print-ready HTML file. */
export function buildBatchPayslipPrintDocument(payslipHtmlList) {
    const pages = (payslipHtmlList || [])
        .filter(Boolean)
        .map((html) => {
            const inner = normalizePayslipHtmlForPrint(html, { standalone: false });
            return `<div class="payslip-batch-page payslip-sheet">${inner || '<p>(Empty payslip)</p>'}</div>`;
        })
        .join('\n');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>${PAYSLIP_PRINT_CSS}</style></head><body>${pages}</body></html>`;
}
