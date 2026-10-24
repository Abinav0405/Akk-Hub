/**
 * Employee Information Record PDF — one A4 page per worker:
 *   header (AKK branding, title, generated date, CONFIDENTIAL) → only the fields the admin chose
 *   (the server already returned only those) → footer with page numbers.
 * Drawn with jsPDF (vector text, small files). ID-card printing stays in features/cards/pvcPrint.js.
 */
import { jsPDF } from 'jspdf';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { EXPORT_FIELDS, GROUPS, LABEL, formatValue, showField } from './fields';

const BRAND = [140, 13, 38];
const INK = [15, 23, 42];
const MUTED = [107, 114, 128];
const HAIR = [226, 229, 234];

async function logoDataUrl() {
    try {
        const res = await fetch('/Akk-logo.png');
        const blob = await res.blob();
        return await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

function drawHeader(doc, logo, generated) {
    const W = doc.internal.pageSize.getWidth();
    if (logo) doc.addImage(logo, 'PNG', 16, 12, 14, 14);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text('AKK ENGINEERING PTE. LTD.', 34, 17.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('15 Kaki Bukit Rd 4, #01-50, Singapore 417808', 34, 22.5);

    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Employee Information Record', W - 16, 17, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${generated}`, W - 16, 22, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND);
    doc.text('CONFIDENTIAL — INTERNAL USE', W - 16, 26.5, { align: 'right' });

    doc.setDrawColor(...BRAND);
    doc.setLineWidth(0.6);
    doc.line(16, 31, W - 16, 31);
}

/**
 * The chosen details, grouped. Runs onto continuation pages (header repeated) when a worker has more
 * than one page of details; `newPage()` adds one and returns the y to continue from.
 */
function drawDetails(doc, values, fields, defs, workerType, x, y, w, newPage) {
    const pageBottom = doc.internal.pageSize.getHeight() - 20;
    const labelW = 58;
    let cy = y;
    for (const g of GROUPS) {
        const inGroup = defs.filter((f) => f.group === g.key && fields.includes(f.key) && (f.custom || showField(f, workerType, values?.[f.key])));
        if (!inGroup.length) continue;
        if (cy > pageBottom - 24) cy = newPage();
        // section heading
        doc.setFillColor(246, 247, 249);
        doc.rect(x, cy, w, 7, 'F');
        doc.setFillColor(...BRAND);
        doc.rect(x, cy, 1.2, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...INK);
        doc.text(g.label.toUpperCase(), x + 4, cy + 4.8, { charSpace: 0.3 });
        cy += 9;
        for (const f of inGroup) {
            const shown = formatValue(f.key, values?.[f.key]);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            const lines = doc.splitTextToSize(shown ?? 'Not provided', w - labelW - 4);
            const rowH = Math.max(7, lines.length * 4.6 + 2.6);
            if (cy + rowH > pageBottom) cy = newPage();
            doc.setTextColor(...MUTED);
            doc.setFontSize(8.5);
            doc.text(f.label || LABEL[f.key] || f.key, x + 4, cy + 4.6);
            doc.setFontSize(9.5);
            if (shown == null) {
                doc.setFont('helvetica', 'italic');
                doc.setTextColor(160, 166, 175);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...INK);
            }
            doc.text(lines, x + labelW, cy + 4.6);
            doc.setDrawColor(...HAIR);
            doc.setLineWidth(0.15);
            doc.line(x + 4, cy + rowH, x + w, cy + rowH);
            cy += rowH;
        }
        cy += 4;
    }
    return cy;
}

/**
 * @param {Array<{card: object, values: object}>} workers  rows from core.admin_export_workers
 * @param {string[]} fields selected field keys (the server already enforced the same list)
 * @param {(done:number,total:number)=>void} [onProgress]
 */
export async function buildWorkerInfoPdf(workers, fields, onProgress, defs = EXPORT_FIELDS) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const logo = await logoDataUrl();
    const generated = new Date().toLocaleString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const total = workers.length;
    const owners = []; // page index (1-based) → worker card, for the footers
    for (let i = 0; i < total; i += 1) {
        if (i > 0) doc.addPage();
        const { card, values } = workers[i];
        owners[doc.getNumberOfPages()] = card;
        drawHeader(doc, logo, generated);
        const newPage = () => {
            doc.addPage();
            owners[doc.getNumberOfPages()] = card;
            drawHeader(doc, logo, generated);
            return 38;
        };
        drawDetails(doc, values, fields, defs, card.worker_type, 16, 38, W - 32, newPage);
        onProgress?.(i + 1, total);
        // keep the page responsive on long exports
        if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
        doc.setPage(p);
        const card = owners[p];
        doc.setDrawColor(...HAIR);
        doc.setLineWidth(0.2);
        doc.line(16, H - 14, W - 16, H - 14);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(`${card.employee_id} · ${card.name || ''} · Employee Information Record · Confidential`, 16, H - 9);
        doc.text(`Page ${p} of ${pages}`, W - 16, H - 9, { align: 'right' });
    }
    return doc.output('blob');
}

export async function downloadWorkerInfoPdf(workers, fields, fileName, onProgress, defs) {
    const blob = await buildWorkerInfoPdf(workers, fields, onProgress, defs);
    await savePdfBlob(blob, fileName);
}
