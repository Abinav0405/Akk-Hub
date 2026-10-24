/**
 * The two faces of the AKK employee ID card (pure display).
 *   <CardFront card live onAddPhoto/>   role colour, photo, name, IDs, status, live clock on the holder's phone
 *   <CardBack card qr number onQrClick/> card number, permit / safety certificate, dates, QR, barcode
 * `card` is a payload from core._card_payload (my_card / admin_card_detail / card_verify).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { initialsOf } from '@/ui/photo';
import Barcode from './Barcode';
import { STATE_LABEL, daysLeft, fmtDate, groupNumber, themeFor } from './cardModel';
import './cards.css';

/**
 * Text that always fits its box on the card: shrinks the font instead of cutting the text off.
 * Needed because phones with a larger system font size (Android "Font size") enlarge text but not the card.
 *   lines=1 — one line, shrinks to the width;  lines=2 — up to two lines, shrinks until it fits them.
 */
function Fit({ as: Tag = 'span', className = '', lines = 1, min = 0.5, children, ...rest }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        let frame = 0;
        const run = () => {
            el.style.fontSize = '';
            const base = parseFloat(getComputedStyle(el).fontSize) || 0;
            if (!base) return;
            let size = base;
            for (let i = 0; i < 8; i += 1) {
                const over = lines > 1 ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
                if (over <= 0.5) break;
                const ratio = lines > 1 ? Math.sqrt(el.clientHeight / el.scrollHeight) : el.clientWidth / el.scrollWidth;
                size = Math.max(base * min, size * Math.min(0.95, ratio * 0.98));
                el.style.fontSize = `${size}px`;
                if (size <= base * min) break;
            }
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(run);
        };
        run();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
        ro?.observe(el.parentElement || el);
        document.fonts?.ready?.then(schedule).catch(() => {});
        return () => {
            cancelAnimationFrame(frame);
            ro?.disconnect();
        };
    }, [children, lines, min]);
    return (
        <Tag ref={ref} className={`${className} ${lines > 1 ? 'akc-fit2' : 'akc-fit'}`} {...rest}>
            {children}
        </Tag>
    );
}

/** Shrinks `content` as a whole (CSS zoom) when it is taller than `box` — the back's details block. */
function useFitHeight(boxRef, contentRef, deps) {
    useLayoutEffect(() => {
        const box = boxRef.current;
        const content = contentRef.current;
        if (!box || !content) return undefined;
        let frame = 0;
        const run = () => {
            content.style.zoom = '';
            const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
            const avail = box.clientHeight - pad;
            const need = content.scrollHeight;
            if (avail > 0 && need > avail + 0.5) content.style.zoom = String(Math.max(0.6, (avail / need) * 0.98));
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(run);
        };
        run();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
        ro?.observe(box);
        ro?.observe(content); // text that grows later (fonts loading, text size) re-fits too
        document.fonts?.ready?.then(schedule).catch(() => {});
        return () => {
            cancelAnimationFrame(frame);
            ro?.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

/** "Exp 16 Aug 2027" · "No expiry" · nothing when there is no date. */
function expiryText(d) {
    const s = fmtDate(d);
    return s === '—' ? '' : s === 'No expiry' ? 'No expiry' : `Exp ${s}`;
}

function LiveClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(id);
    }, []);
    return (
        <span className="akc__live" aria-label="Live card">
            <i aria-hidden />
            LIVE {now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
    );
}

export function cardStatus(card) {
    const state = card?.state || 'valid';
    if (state !== 'valid') return { tone: 'bad', text: STATE_LABEL[state] || 'Not valid' };
    const d = daysLeft(card.valid_until);
    if (d != null && d <= 30) return { tone: 'warn', text: d < 0 ? 'Card expired' : `Expires in ${d} day${d === 1 ? '' : 's'}` };
    return { tone: 'ok', text: card.role && card.role !== 'employee' ? 'Active' : 'Active employee' };
}

export function CardFront({ card, live = false, onAddPhoto, className = '' }) {
    if (!card) return null;
    const theme = themeFor(card.role);
    const status = cardStatus(card);
    const local = card.worker_type === 'local';
    return (
        <article className={`akc akc--front ${className}`} data-theme={theme.key} data-state={status.tone} aria-label={`AKK identification card of ${card.name}`}>
            <div className="akc__pattern" aria-hidden />
            {live ? <div className="akc__holo" aria-hidden /> : null}
            <header className="akc__band">
                <span className="akc__logo">
                    <img src="/Akk-logo.png" alt="" />
                </span>
                <span className="akc__org">
                    <Fit as="b">AKK ENGINEERING PTE. LTD.</Fit>
                    <Fit>IDENTIFICATION CARD</Fit>
                </span>
                <span className="akc__role">{theme.short}</span>
            </header>
            <div className="akc__body">
                <div className="akc__photo">
                    {card.photo ? (
                        <img src={card.photo} alt={`Photo of ${card.name}`} />
                    ) : onAddPhoto ? (
                        <button type="button" className="akc__addphoto" onClick={(e) => { e.stopPropagation(); onAddPhoto(); }}>
                            <ImagePlus aria-hidden />
                            Add passport photo
                        </button>
                    ) : (
                        <span className="akc__initials">{initialsOf(card.name)}</span>
                    )}
                </div>
                <div className="akc__info">
                    <span className="akc__label">Name</span>
                    <Fit as="p" lines={2} min={0.45} className="akc__name">
                        {card.name || '—'}
                    </Fit>
                    <div className="akc__grid">
                        <div>
                            <span className="akc__label">Employee ID</span>
                            <Fit className="akc__value akc__mono">{card.employee_id}</Fit>
                        </div>
                        <div>
                            <span className="akc__label">{local ? 'Type' : 'Work Permit No.'}</span>
                            {local ? (
                                <Fit className="akc__value">Local staff</Fit>
                            ) : (
                                <Fit min={0.38} className={`akc__value akc__mono ${card.work_permit_no ? '' : 'akc__muted'}`}>{card.work_permit_no || (card.work_permit_no === undefined ? '—' : 'Not on file')}</Fit>
                            )}
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <span className="akc__label">Designation</span>
                            <Fit min={0.38} className="akc__value">{card.designation || '—'}</Fit>
                        </div>
                    </div>
                </div>
            </div>
            <footer className="akc__foot">
                <Fit className="akc__status">{status.text}</Fit>
                {live ? <LiveClock /> : <Fit className="akc__micro">Property of AKK Engineering</Fit>}
            </footer>
        </article>
    );
}

/**
 * number: { full, show, onToggle } — full number, whether it is shown, and the reveal toggle.
 */
/**
 * qr: { src, stale, progress (0..1 of the refresh window) } — progress draws the countdown ring.
 */
export function CardBack({ card, qr, number, onQrClick, className = '' }) {
    const boxRef = useRef(null);
    const detailsRef = useRef(null);
    useFitHeight(boxRef, detailsRef, [card, number?.show]);
    if (!card) return null;
    const theme = themeFor(card.role);
    const local = card.worker_type === 'local';
    const R = 47;
    const C = 2 * Math.PI * R;
    const full = number?.full || card.card_number || null;
    const shown = full && number?.show !== false;
    const masked = card.card_number_masked || (card.card_last4 ? `•••• •••• •••• ${card.card_last4}` : '—');
    return (
        <article className={`akc akc--back ${className}`} data-theme={theme.key} aria-label="Back of the identification card">
            <div className="akc__pattern" aria-hidden />
            <div className="akc__stripe" aria-hidden />
            <div className="akc__back" ref={boxRef}>
                <div className="akc__details" ref={detailsRef}>
                    <div className="akc__cardno">
                        <span className="akc__label">
                            Card No.
                            {number?.onToggle && full ? (
                                <button type="button" className="akc__reveal" onClick={(e) => { e.stopPropagation(); number.onToggle(); }}>
                                    {shown ? 'HIDE' : 'SHOW'}
                                </button>
                            ) : null}
                        </span>
                        <Fit className="akc__value akc__mono">
                            {shown ? (
                                <span key="full">
                                    {groupNumber(full).split('').map((ch, i) => (
                                        <span key={i} className="akc__digit" style={{ animationDelay: `${i * 12}ms` }}>
                                            {ch === ' ' ? ' ' : ch}
                                        </span>
                                    ))}
                                </span>
                            ) : (
                                masked
                            )}
                        </Fit>
                    </div>
                    {!local ? (
                        <div className="akc__cell">
                            <span className="akc__label">Work Permit</span>
                            <Fit min={0.38} className="akc__value akc__mono">{card.work_permit_no || '—'}</Fit>
                            {expiryText(card.permit_expiry_date) ? <Fit className="akc__label akc__exp">{expiryText(card.permit_expiry_date)}</Fit> : null}
                        </div>
                    ) : null}
                    <div className="akc__cell">
                        <span className="akc__label">Safety Cert.</span>
                        <Fit min={0.38} className="akc__value akc__mono">{card.safety_cert_no || '—'}</Fit>
                        {card.safety_cert_no && expiryText(card.safety_cert_expiry_date) ? <Fit className="akc__label akc__exp">{expiryText(card.safety_cert_expiry_date)}</Fit> : null}
                    </div>
                    <div className="akc__cell">
                        <span className="akc__label">Date Joined</span>
                        <Fit className="akc__value">{fmtDate(card.date_joined)}</Fit>
                    </div>
                    <div className="akc__cell">
                        <span className="akc__label">Card Valid</span>
                        <Fit className="akc__value">
                            {fmtDate(card.valid_from)} – {fmtDate(card.valid_until)}
                        </Fit>
                    </div>
                </div>
                {qr ? (
                    <button
                        type="button"
                        className="akc__qr"
                        data-stale={qr.stale ? 'true' : 'false'}
                        onClick={(e) => { e.stopPropagation(); onQrClick?.(); }}
                        aria-label="Show the QR code large"
                    >
                        {qr.src ? <img src={qr.src} alt="Card QR code" /> : null}
                        {qr.progress != null ? (
                            <svg className="akc__qrring" viewBox="0 0 100 100" aria-hidden>
                                <circle cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * Math.min(1, Math.max(0, qr.progress))} />
                            </svg>
                        ) : null}
                    </button>
                ) : null}
            </div>
            {full ? (
                <div className="akc__barcode">
                    <Barcode value={full} />
                    <Fit className="akc__barnum">{shown ? groupNumber(full) : masked}</Fit>
                </div>
            ) : null}
            <Fit as="p" lines={2} min={0.55} className="akc__return">
                If found, please return to AKK Engineering Pte. Ltd., 15 Kaki Bukit Rd 4, #01-50, Singapore 417808.
            </Fit>
        </article>
    );
}
