/**
 * Print-ready PVC cards (admin only): CR80 size 85.6 × 54 mm, page 1 = front, page 2 = back, for each
 * person. Vector text, the stored passport photo, a static QR (printed-card token) and a Code 128
 * barcode of the card number. Full-bleed artwork — set the card printer to "fit / no margins".
 */
import { jsPDF } from 'jspdf';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { barRuns } from './Barcode';
import { fmtDate, groupNumber, qrPayload, themeFor } from './cardModel';
import { qrDataUrlWithLogo } from './qrWithLogo';

const W = 85.6;
const H = 54;
const GOLD = [212, 176, 98]; // fallback when a theme has no accent (admin/manager gold)

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

/** Montserrat (OFL) from /public/fonts, embedded once per PDF; Helvetica if the files can't load. */
const FONT_FILES = [
    ['Montserrat_500Medium.ttf', 'normal'],
    ['Montserrat_700Bold.ttf', 'bold'],
    ['Montserrat_800ExtraBold.ttf', 'heavy'],
];
let fontData = null;
async function loadFonts() {
    if (fontData) return fontData;
    try {
        fontData = await Promise.all(
            FONT_FILES.map(async ([file, style]) => {
                const buf = new Uint8Array(await (await fetch(`/fonts/${file}`)).arrayBuffer());
                let bin = '';
                for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                return [file, style, btoa(bin)];
            }),
        );
    } catch {
        fontData = [];
    }
    return fontData;
}
let FACE = 'helvetica';
function useFonts(doc, data) {
    FACE = 'helvetica';
    if (!data.length) return;
    for (const [file, style, b64] of data) {
        doc.addFileToVFS(file, b64);
        doc.addFont(file, 'Montserrat', style);
    }
    FACE = 'Montserrat';
}
/** style: 'normal' | 'bold' | 'heavy' (heavy falls back to bold without Montserrat). */
const font = (doc, style) => doc.setFont(FACE, FACE === 'helvetica' && style === 'heavy' ? 'bold' : style);
/** Numbers keep the bank-card look. */
const mono = (doc) => doc.setFont('courier', 'bold');
/** "N/A", "-", "nil" … typed into a field count as nothing on file. */
const blank = (v) => !v || /^(n\/?a|-+|—|nil|none|null)$/i.test(String(v).trim());

const initials = (name) => {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
};

/** Fill + line transparency (jsPDF's plain `opacity` only fades fills, so lines printed solid). */
const alpha = (doc, a) => doc.setGState?.(new doc.GState({ opacity: a, 'stroke-opacity': a }));
/** Letter-spaced text that still lines up when centred / right-aligned (jsPDF ignores charSpace there). */
const spaced = (doc, str, x, y, cs, align = 'left') => {
    const w = doc.getTextWidth(str) + cs * Math.max(0, str.length - 1);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    doc.text(str, left, y, { charSpace: cs });
};
const light = (t) => t.text[0] > 200; // white text on a dark card
const softOf = (t) => (light(t) ? [255, 255, 255] : [100, 116, 139]);

function background(doc, t) {
    // smooth left → right gradient in thin vertical strips
    const steps = 80;
    for (let i = 0; i < steps; i += 1) {
        const k = i / (steps - 1);
        doc.setFillColor(...t.from.map((c, n) => Math.round(c + (t.to[n] - c) * k)));
        doc.rect((W / steps) * i, 0, W / steps + 0.1, H, 'F');
    }
    // fine security rings, bottom-right only and very faint so text stays crisp
    doc.setLineWidth(0.06);
    doc.setDrawColor(...(light(t) ? [255, 255, 255] : t.band));
    alpha(doc, light(t) ? 0.09 : 0.07);
    for (let r = 8; r < 46; r += 1.6) doc.circle(W + 6, H + 8, r, 'S');
    alpha(doc, 1);
}

/** Header band shared by both sides: logo tile, company name, sub-title, role pill. */
function header(doc, card, t, logo, sub, h) {
    const accent = t.accent || GOLD;
    doc.setFillColor(...t.band);
    doc.rect(0, 0, W, h, 'F');
    doc.setFillColor(...accent);
    doc.rect(0, h, W, 0.6, 'F');
    const tile = h - 4.4;
    if (logo) {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(3.6, 2.2, tile, tile, 1.1, 1.1, 'F');
        doc.addImage(logo, 'PNG', 3.6 + 0.6, 2.2 + 0.6, tile - 1.2, tile - 1.2);
    }
    const tx = logo ? 3.6 + tile + 2.4 : 4;
    doc.setTextColor(255, 255, 255);
    font(doc, 'heavy');
    doc.setFontSize(h > 10 ? 7.2 : 6);
    doc.text('AKK ENGINEERING PTE. LTD.', tx, h > 10 ? 5.9 : 4.6);
    font(doc, 'normal');
    doc.setFontSize(h > 10 ? 4.4 : 3.8);
    alpha(doc, 0.85);
    doc.text(sub, tx, h > 10 ? 8.7 : 7, { charSpace: 0.4 });
    alpha(doc, 1);
    // role pill
    const label = themeFor(card.role).short;
    font(doc, 'bold');
    doc.setFontSize(4.4);
    const pw = doc.getTextWidth(label) + 0.2 * (label.length - 1) + 4.4;
    const ph = 4.2;
    const py = (h - ph) / 2;
    doc.setDrawColor(...(card.role === 'manager' || card.role === 'admin' ? accent : [255, 255, 255]));
    doc.setLineWidth(0.25);
    doc.roundedRect(W - 3.6 - pw, py, pw, ph, ph / 2, ph / 2, 'S');
    doc.setTextColor(255, 255, 255);
    spaced(doc, label, W - 3.6 - pw / 2, py + ph / 2 + 0.6, 0.2, 'center');
}

function front(doc, card, logo) {
    const t = themeFor(card.role).pdf;
    const accent = t.accent || GOLD;
    const soft = softOf(t);
    background(doc, t);
    header(doc, card, t, logo, 'IDENTIFICATION CARD', 12);

    // photo
    const px = 4;
    const py = 15.4;
    const pwid = 19.5;
    const ph = 24.4;
    doc.setFillColor(...accent);
    doc.roundedRect(px - 0.5, py - 0.5, pwid + 1, ph + 1, 1.6, 1.6, 'F');
    doc.setFillColor(236, 239, 243);
    doc.roundedRect(px, py, pwid, ph, 1.2, 1.2, 'F');
    if (card.photo) {
        doc.saveGraphicsState();
        doc.roundedRect(px, py, pwid, ph, 1.2, 1.2, null);
        doc.clip();
        doc.discardPath();
        try {
            doc.addImage(card.photo, 'JPEG', px, py, pwid, ph);
        } catch {
            /* keep the frame */
        }
        doc.restoreGraphicsState();
    } else {
        font(doc, 'bold');
        doc.setTextColor(154, 163, 174);
        doc.setFontSize(16);
        doc.text(initials(card.name), px + pwid / 2, py + ph / 2 + 2.2, { align: 'center' });
    }

    // details
    const ix = 28;
    const iw = W - ix - 4;
    const lab = (s, x, y) => {
        font(doc, 'bold');
        doc.setFontSize(3.7);
        doc.setTextColor(...soft);
        alpha(doc, light(t) ? 0.7 : 1);
        doc.text(s.toUpperCase(), x, y, { charSpace: 0.3 });
        alpha(doc, 1);
    };
    const val = (s, x, y, w, size = 6) => {
        font(doc, 'bold');
        doc.setFontSize(size);
        doc.setTextColor(...t.text);
        doc.text(doc.splitTextToSize(String(s ?? '—'), w)[0] || '—', x, y);
    };
    lab('Name', ix, 17.4);
    font(doc, 'heavy');
    let nameSize = 8.6;
    const upper = String(card.name || '—').toUpperCase();
    doc.setFontSize(nameSize);
    while (nameSize > 7 && doc.getTextWidth(upper) > iw * 1.6) doc.setFontSize((nameSize -= 0.5));
    doc.setTextColor(...t.text);
    const name = doc.splitTextToSize(upper, iw).slice(0, 2);
    doc.text(name, ix, 21.2);
    let y = 21.2 + name.length * nameSize * 0.42 + 1.4;
    const half = iw / 2;
    lab('Employee ID', ix, y);
    lab(card.worker_type === 'local' ? 'Type' : 'Work Permit No.', ix + half, y);
    val(card.employee_id, ix, y + 3, half - 1.5);
    if (card.worker_type === 'local' || blank(card.work_permit_no)) val(card.worker_type === 'local' ? 'Local staff' : 'Not on file', ix + half, y + 3, half);
    else {
        mono(doc);
        doc.setFontSize(6);
        doc.setTextColor(...t.text);
        doc.text(doc.splitTextToSize(String(card.work_permit_no), half)[0], ix + half, y + 3);
    }
    y += 7.2;
    lab('Designation', ix, y);
    val(card.designation || '—', ix, y + 3, iw);

    // footer strip
    doc.setFillColor(...(light(t) ? [0, 0, 0] : t.band));
    alpha(doc, light(t) ? 0.22 : 0.06);
    doc.rect(0, H - 6.6, W, 6.6, 'F');
    alpha(doc, 1);
    font(doc, 'bold');
    doc.setFontSize(4.6);
    doc.setTextColor(...t.text);
    doc.text(`Valid until ${fmtDate(card.valid_until)}`, 4, H - 2.5);
    font(doc, 'normal');
    doc.setFontSize(3.5);
    doc.setTextColor(...soft);
    alpha(doc, light(t) ? 0.8 : 1);
    spaced(doc, 'PROPERTY OF AKK ENGINEERING', W - 4, H - 2.5, 0.3, 'right');
    alpha(doc, 1);
}

/** "Expires 15 Jan 2028" — nothing when there is no date, "No expiry" for open-ended. */
const expiry = (d) => {
    const s = fmtDate(d);
    return s === '—' ? '' : s === 'No expiry' ? 'No expiry' : `Expires ${s}`;
};

async function back(doc, card, logo) {
    const t = themeFor(card.role).pdf;
    const accent = t.accent || GOLD;
    const soft = softOf(t);
    background(doc, t);
    header(doc, card, t, logo, 'EMPLOYEE CARD', 9);

    const lab = (s, x, y) => {
        font(doc, 'bold');
        doc.setFontSize(3.5);
        doc.setTextColor(...soft);
        alpha(doc, light(t) ? 0.7 : 1);
        doc.text(s.toUpperCase(), x, y, { charSpace: 0.3 });
        alpha(doc, 1);
    };
    const val = (s, x, y, w, size = 5.2, isNumber = false) => {
        if (isNumber) mono(doc);
        else font(doc, 'bold');
        doc.setFontSize(size);
        doc.setTextColor(...t.text);
        const v = blank(s) ? '—' : String(s);
        doc.text(doc.splitTextToSize(v, w)[0] || '—', x, y);
    };
    const note = (s, x, y) => {
        if (!s) return;
        font(doc, 'normal');
        doc.setFontSize(3.6);
        doc.setTextColor(...soft);
        alpha(doc, light(t) ? 0.8 : 1);
        doc.text(s, x, y);
        alpha(doc, 1);
    };

    const L = 4;
    const colW = 28;
    const textW = W - 29 - L; // left of the QR
    let y = 13.6;
    lab('Card No.', L, y);
    mono(doc);
    doc.setFontSize(9.4);
    doc.setTextColor(...t.text);
    doc.text(groupNumber(card.card_number), L, y + 4);

    y += 8.4;
    const foreign = card.worker_type !== 'local';
    if (foreign) {
        lab('Work Permit', L, y);
        val(card.work_permit_no, L, y + 2.9, colW - 2, 5.2, true);
        note(expiry(card.permit_expiry_date), L, y + 5.3);
    }
    const sx = foreign ? L + colW : L;
    lab('Safety Certificate', sx, y);
    val(card.safety_cert_no, sx, y + 2.9, foreign ? textW - colW : colW * 2, 5, true);
    note(blank(card.safety_cert_no) ? '' : expiry(card.safety_cert_expiry_date), sx, y + 5.3);

    y += 8.8;
    lab('Date Joined', L, y);
    val(fmtDate(card.date_joined), L, y + 2.9, colW - 2);
    lab('Card Valid', L + colW, y);
    val(`${fmtDate(card.valid_from)} – ${fmtDate(card.valid_until)}`, L + colW, y + 2.9, textW - colW, 4.6);

    // QR (printed-card token + centred company logo) in a white tile
    const qr = await qrDataUrlWithLogo(qrPayload(`AKK1P.${card.qr_token}`), { margin: 1, width: 400 });
    const qs = 21;
    const qx = W - 4 - qs;
    const qy = 12.2;
    doc.setFillColor(...accent);
    doc.roundedRect(qx - 0.4, qy - 0.4, qs + 0.8, qs + 0.8, 1.6, 1.6, 'F');
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(qx, qy, qs, qs, 1.3, 1.3, 'F');
    doc.addImage(qr, 'PNG', qx + 1.6, qy + 1.6, qs - 3.2, qs - 3.2);
    note('Scan to verify', qx + qs / 2 - doc.getTextWidth('Scan to verify') / 2, qy + qs + 2.6);

    // barcode panel — bars on the left, number underneath, generous quiet zone
    const by = 38.4;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.roundedRect(L, by, W - 2 * L, 9.4, 1.2, 1.2, light(t) ? 'F' : 'FD');
    const { runs, modules } = barRuns(card.card_number);
    const bw = W - 2 * L - 8;
    const unit = bw / modules;
    doc.setFillColor(11, 18, 32);
    for (const [x, w] of runs) doc.rect(L + 4 + x * unit, by + 1.1, w * unit, 5.4, 'F');
    mono(doc);
    doc.setFontSize(4.4);
    doc.setTextColor(11, 18, 32);
    spaced(doc, groupNumber(card.card_number), W / 2, by + 8.6, 0.2, 'center');

    font(doc, 'normal');
    doc.setFontSize(3.2);
    doc.setTextColor(...soft);
    alpha(doc, light(t) ? 0.75 : 1);
    doc.text('If found, please return to AKK Engineering Pte. Ltd., 15 Kaki Bukit Rd 4, #01-50, Singapore 417808.', W / 2, H - 2.4, { align: 'center', maxWidth: W - 8 });
    alpha(doc, 1);
}


/** cards: payloads from core.admin_cards_for_print → jsPDF document (front + back per person). */
export async function buildPvcPdf(cards, onProgress) {
    if (!cards?.length) throw new Error('No cards to print.');
    const doc = new jsPDF({ unit: 'mm', format: [H, W], orientation: 'landscape', compress: true });
    const [logo, fonts] = await Promise.all([logoDataUrl(), loadFonts()]);
    useFonts(doc, fonts);
    for (let i = 0; i < cards.length; i += 1) {
        if (i > 0) doc.addPage([H, W], 'landscape');
        front(doc, cards[i], logo);
        doc.addPage([H, W], 'landscape');
        await back(doc, cards[i], logo);
        onProgress?.(i + 1, cards.length);
        if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    }
    return doc;
}

export async function downloadPvcCards(cards, fileName, onProgress) {
    const doc = await buildPvcPdf(cards, onProgress);
    await savePdfBlob(doc.output('blob'), fileName);
}
