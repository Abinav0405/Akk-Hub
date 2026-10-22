/**
 * Employee Information Record PDF — one A4 page per worker:
 *   header (AKK branding, title, generated date, CONFIDENTIAL) → employee ID card → only the
 *   fields the admin chose (the server already returned only those) → footer with page numbers.
 * Drawn with jsPDF (vector text, small files); photos are the stored passport JPEGs.
 */
import { jsPDF } from 'jspdf';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { EXPORT_FIELDS, GROUPS, LABEL, formatValue, showField } from './fields';

const BRAND = [140, 13, 38];
const BRAND_DEEP = [61, 8, 23];
const GOLD = [184, 145, 58];
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

function initials(name) {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
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

function drawCard(doc, logo, card, x, y, w) {
    const h = w / 1.586;
    const bandH = h * 0.23;
    // soft shadow (stacked, progressively lighter) → body + border
    [[0.9, [233, 235, 239]], [0.6, [239, 241, 244]], [0.3, [245, 246, 248]]].forEach(([d, c]) => {
        doc.setFillColor(...c);
        doc.roundedRect(x - d * 0.4, y + d * 1.2, w + d * 0.8, h + d * 0.6, 4, 4, 'F');
    });
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 4, 4, 'FD');
    // everything below is clipped to the card's rounded outline
    doc.saveGraphicsState();
    doc.roundedRect(x, y, w, h, 4, 4, null);
    doc.clip();
    doc.discardPath();
    // guilloche: fine, faint wave lines across the body (like the on-screen card)
    doc.setDrawColor(249, 242, 244);
    doc.setLineWidth(0.12);
    for (let k = 0; k < 14; k += 1) {
        const base = y + bandH + 2 + k * ((h - bandH) / 13);
        const steps = 56;
        const segs = [];
        let px = 0;
        let py = Math.sin((k * 0.9) * 1) * 1.4;
        for (let i = 1; i <= steps; i += 1) {
            const nx = (w / steps) * i;
            const ny = Math.sin(i * 0.34 + k * 0.9) * 1.4 + Math.sin(i * 0.11 + k) * 1.1;
            segs.push([nx - px, ny - py]);
            px = nx;
            py = ny;
        }
        doc.lines(segs, x, base + Math.sin(k * 0.9) * 1.4, [1, 1], 'S');
    }
    // band: smooth deep-crimson → brand gradient (thin vertical strips)
    const strips = 90;
    for (let i = 0; i < strips; i += 1) {
        const t = i / (strips - 1);
        doc.setFillColor(...BRAND_DEEP.map((c, n) => Math.round(c + (BRAND[n] - c) * Math.min(1, t * 1.15))));
        doc.rect(x + (w / strips) * i, y, w / strips + 0.15, bandH, 'F');
    }
    doc.restoreGraphicsState();
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.6);
    doc.line(x, y + bandH, x + w, y + bandH);
    // logo badge
    const lb = bandH * 0.62;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x + 5, y + (bandH - lb) / 2, lb, lb, 1.6, 1.6, 'F');
    if (logo) doc.addImage(logo, 'PNG', x + 5 + lb * 0.12, y + (bandH - lb) / 2 + lb * 0.12, lb * 0.76, lb * 0.76);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('AKK ENGINEERING PTE. LTD.', x + 8 + lb, y + bandH * 0.48);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.text('EMPLOYEE IDENTIFICATION CARD', x + 8 + lb, y + bandH * 0.78, { charSpace: 0.5 });

    // photo
    const pw = w * 0.25;
    const ph = pw * 1.26;
    const px = x + 6;
    const py = y + bandH + 5;
    doc.setFillColor(238, 240, 243);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.roundedRect(px, py, pw, ph, 2, 2, 'FD');
    if (card.photo) {
        try {
            doc.addImage(card.photo, 'JPEG', px + 0.6, py + 0.6, pw - 1.2, ph - 1.2);
        } catch {
            /* unreadable photo → placeholder stays */
        }
    } else {
        doc.setTextColor(154, 163, 174);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text(initials(card.name), px + pw / 2, py + ph / 2 + 3, { align: 'center' });
    }

    // details
    const ix = px + pw + 7;
    const iw = x + w - ix - 5;
    const label = (t, lx, ly) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.8);
        doc.setTextColor(138, 148, 163);
        doc.text(t.toUpperCase(), lx, ly, { charSpace: 0.35 });
    };
    const value = (t, lx, ly, maxW, muted = false) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.6);
        doc.setTextColor(...(muted ? [154, 163, 174] : INK));
        doc.text(doc.splitTextToSize(String(t), maxW)[0] || '', lx, ly);
    };
    let cy = py + 3.5;
    label('Name', ix, cy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(11, 18, 32);
    const nameLines = doc.splitTextToSize(String(card.name || '—').toUpperCase(), iw).slice(0, 2);
    doc.text(nameLines, ix, cy + 5.2);
    cy += 5.2 + nameLines.length * 4.9 + 2;
    label('Employee ID', ix, cy);
    label(card.worker_type === 'local' ? 'Type' : 'Work Permit No.', ix + iw / 2, cy);
    value(card.employee_id, ix, cy + 4.2, iw / 2 - 2);
    if (card.worker_type === 'local') value('Local staff', ix + iw / 2, cy + 4.2, iw / 2);
    else value(card.work_permit_no || 'Not on file', ix + iw / 2, cy + 4.2, iw / 2, !card.work_permit_no);
    cy += 10;
    label('Designation', ix, cy);
    value(card.designation || '—', ix, cy + 4.2, iw);

    // footer
    const fy = y + h - 5;
    doc.setDrawColor(...HAIR);
    doc.setLineWidth(0.2);
    doc.line(x, y + h * 0.87, x + w, y + h * 0.87);
    const employed = card.in_company !== false;
    doc.setFillColor(...(employed ? [4, 120, 87] : [185, 28, 28]));
    doc.circle(x + 7, fy - 1, 1.1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...(employed ? [4, 120, 87] : [185, 28, 28]));
    doc.text(employed ? 'Active employee' : 'Not in company', x + 10, fy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(161, 169, 180);
    doc.text('PROPERTY OF AKK ENGINEERING', x + w - 5, fy, { align: 'right', charSpace: 0.3 });
    return h;
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
        const cardW = 118;
        const cardH = drawCard(doc, logo, card, (W - cardW) / 2, 38, cardW);
        const newPage = () => {
            doc.addPage();
            owners[doc.getNumberOfPages()] = card;
            drawHeader(doc, logo, generated);
            return 38;
        };
        drawDetails(doc, values, fields, defs, card.worker_type, 16, 38 + cardH + 9, W - 32, newPage);
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
