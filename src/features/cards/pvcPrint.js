/**
 * Print-ready PVC cards (admin only): CR80 size 85.6 × 54 mm, page 1 = front, page 2 = back, for each
 * person. Vector text, the stored passport photo, a static QR (printed-card token) and a Code 128
 * barcode of the card number. Full-bleed artwork — set the card printer to "fit / no margins".
 */
import { jsPDF } from 'jspdf';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import QRCode from 'qrcode';
import { barRuns } from './Barcode';
import { fmtDate, groupNumber, qrPayload, themeFor } from './cardModel';

const W = 85.6;
const H = 54;
const GOLD = [212, 176, 98];

async function logoDataUrl() {
    try {
        const blob = await (await fetch('/Akk-logo.png')).blob();
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

const initials = (name) => {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
};

function background(doc, t) {
    // smooth diagonal-ish gradient in thin vertical strips
    const steps = 60;
    for (let i = 0; i < steps; i += 1) {
        const k = i / (steps - 1);
        doc.setFillColor(...t.from.map((c, n) => Math.round(c + (t.to[n] - c) * k)));
        doc.rect((W / steps) * i, 0, W / steps + 0.1, H, 'F');
    }
    // faint guilloche arcs
    doc.setLineWidth(0.08);
    doc.setDrawColor(...(t.text[0] > 200 ? [255, 255, 255] : [140, 13, 38]));
    doc.setGState?.(new doc.GState({ opacity: 0.08 }));
    // only in the lower-right corner, away from the text
    for (let r = 6; r < 40; r += 2.2) doc.circle(W + 4, H + 10, r, 'S');
    doc.setGState?.(new doc.GState({ opacity: 1 }));
}

function front(doc, card, logo) {
    const t = themeFor(card.role).pdf;
    const label = themeFor(card.role).short;
    background(doc, t);
    // band
    doc.setFillColor(...t.band);
    doc.rect(0, 0, W, 12, 'F');
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(0, 12, W, 12);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(3.5, 2.4, 7.2, 7.2, 1.2, 1.2, 'F');
    if (logo) doc.addImage(logo, 'PNG', 4.2, 3.1, 5.8, 5.8);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.text('AKK ENGINEERING PTE. LTD.', 12.4, 5.9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.6);
    doc.text('IDENTIFICATION CARD', 12.4, 8.6, { charSpace: 0.35 });
    // role pill
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.6);
    const pw = doc.getTextWidth(label) + 4;
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.2);
    doc.roundedRect(W - 3.5 - pw, 4, pw, 4, 2, 2, 'S');
    doc.text(label, W - 3.5 - pw / 2, 6.7, { align: 'center' });

    // photo
    const px = 4;
    const py = 15;
    const pwid = 19;
    const ph = 23.8;
    doc.setFillColor(238, 240, 243);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.roundedRect(px, py, pwid, ph, 1.4, 1.4, 'FD');
    if (card.photo) {
        try {
            doc.addImage(card.photo, 'JPEG', px + 0.4, py + 0.4, pwid - 0.8, ph - 0.8);
        } catch {
            /* keep the frame */
        }
    } else {
        doc.setTextColor(154, 163, 174);
        doc.setFontSize(14);
        doc.text(initials(card.name), px + pwid / 2, py + ph / 2 + 2, { align: 'center' });
    }

    // details
    const ix = 27;
    const iw = W - ix - 4;
    const soft = t.text[0] > 200 ? [255, 255, 255] : [138, 148, 163];
    const lab = (s, x, y) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(3.9);
        doc.setTextColor(...soft);
        doc.setGState?.(new doc.GState({ opacity: t.text[0] > 200 ? 0.72 : 1 }));
        doc.text(s.toUpperCase(), x, y, { charSpace: 0.25 });
        doc.setGState?.(new doc.GState({ opacity: 1 }));
    };
    const val = (s, x, y, w, size = 6.2) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(size);
        doc.setTextColor(...t.text);
        doc.text(doc.splitTextToSize(String(s ?? '—'), w)[0] || '—', x, y);
    };
    lab('Name', ix, 17);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.6);
    doc.setTextColor(...t.text);
    const name = doc.splitTextToSize(String(card.name || '—').toUpperCase(), iw).slice(0, 2);
    doc.text(name, ix, 20.6);
    let y = 20.6 + name.length * 3.5 + 1.2;
    lab('Employee ID', ix, y);
    lab(card.worker_type === 'local' ? 'Type' : 'Work Permit No.', ix + iw / 2, y);
    val(card.employee_id, ix, y + 3, iw / 2 - 1);
    val(card.worker_type === 'local' ? 'Local staff' : card.work_permit_no || 'Not on file', ix + iw / 2, y + 3, iw / 2);
    y += 7;
    lab('Designation', ix, y);
    val(card.designation || '—', ix, y + 3, iw);

    // footer
    doc.setFillColor(0, 0, 0);
    doc.setGState?.(new doc.GState({ opacity: t.text[0] > 200 ? 0.18 : 0.04 }));
    doc.rect(0, H - 6.8, W, 6.8, 'F');
    doc.setGState?.(new doc.GState({ opacity: 1 }));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(4.6);
    doc.setTextColor(...t.text);
    doc.text(`Valid until ${fmtDate(card.valid_until)}`, 4, H - 2.6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.8);
    doc.text('PROPERTY OF AKK ENGINEERING', W - 4, H - 2.6, { align: 'right' });
}

async function back(doc, card) {
    const t = themeFor(card.role).pdf;
    background(doc, t);
    doc.setFillColor(20, 20, 20);
    if (card.role === 'admin') doc.setFillColor(92, 7, 24);
    doc.rect(0, 3, W, 7, 'F');

    const soft = t.text[0] > 200 ? [255, 255, 255] : [138, 148, 163];
    const lab = (s, x, y) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(3.6);
        doc.setTextColor(...soft);
        doc.text(s.toUpperCase(), x, y, { charSpace: 0.2 });
    };
    const val = (s, x, y, size = 5.2, mono = false) => {
        doc.setFont(mono ? 'courier' : 'helvetica', 'bold');
        doc.setFontSize(size);
        doc.setTextColor(...t.text);
        doc.text(String(s ?? '—'), x, y);
    };
    let y = 14.5;
    lab('Card No.', 4, y);
    val(groupNumber(card.card_number), 4, y + 3.4, 7.4, true);
    y += 7.6;
    const colW = 27;
    if (card.worker_type !== 'local') {
        lab('Work Permit', 4, y);
        val(card.work_permit_no || '—', 4, y + 2.8, 5, true);
        lab(`Exp ${fmtDate(card.permit_expiry_date)}`, 4, y + 5.2);
    }
    lab('Safety Cert.', 4 + (card.worker_type !== 'local' ? colW : 0), y);
    val(card.safety_cert_no || '—', 4 + (card.worker_type !== 'local' ? colW : 0), y + 2.8, 4.6, true);
    lab(`Exp ${fmtDate(card.safety_cert_expiry_date)}`, 4 + (card.worker_type !== 'local' ? colW : 0), y + 5.2);
    y += 8.6;
    lab('Date joined', 4, y);
    val(fmtDate(card.date_joined), 4, y + 2.8);
    lab('Card valid', 4 + colW, y);
    val(`${fmtDate(card.valid_from)} – ${fmtDate(card.valid_until)}`, 4 + colW, y + 2.8, 4.6);

    // QR (printed-card token)
    const qr = await QRCode.toDataURL(qrPayload(`AKK1P.${card.qr_token}`), { margin: 1, width: 360, errorCorrectionLevel: 'M' });
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.35);
    doc.roundedRect(W - 25, 12.5, 21, 21, 1.2, 1.2, 'FD');
    doc.addImage(qr, 'PNG', W - 24.2, 13.3, 19.4, 19.4);

    // barcode
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(4, 37, W - 8, 8.6, 1, 1, 'F');
    const { runs, modules } = barRuns(card.card_number);
    const bw = 52;
    const unit = bw / modules;
    doc.setFillColor(11, 18, 32);
    for (const [x, w] of runs) doc.rect(6 + x * unit, 38, w * unit, 6.6, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(5);
    doc.setTextColor(11, 18, 32);
    doc.text(groupNumber(card.card_number), W - 6, 42.2, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.4);
    doc.setTextColor(...soft);
    doc.text('If found, please return to AKK Engineering Pte. Ltd., 15 Kaki Bukit Rd 4, #01-50, Singapore 417808.', 4, 49.6, { maxWidth: W - 8 });
}

/** cards: payloads from core.admin_cards_for_print */
export async function downloadPvcCards(cards, fileName, onProgress) {
    if (!cards?.length) throw new Error('No cards to print.');
    const doc = new jsPDF({ unit: 'mm', format: [H, W], orientation: 'landscape', compress: true });
    const logo = await logoDataUrl();
    for (let i = 0; i < cards.length; i += 1) {
        if (i > 0) doc.addPage([H, W], 'landscape');
        front(doc, cards[i], logo);
        doc.addPage([H, W], 'landscape');
        await back(doc, cards[i]);
        onProgress?.(i + 1, cards.length);
        if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }
    await savePdfBlob(doc.output('blob'), fileName);
}
