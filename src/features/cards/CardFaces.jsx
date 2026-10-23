/**
 * The two faces of the AKK employee ID card (pure display).
 *   <CardFront card live onAddPhoto/>   role colour, photo, name, IDs, status, live clock on the holder's phone
 *   <CardBack card qr number onQrClick/> card number, permit / safety certificate, dates, QR, barcode
 * `card` is a payload from core._card_payload (my_card / admin_card_detail / card_verify).
 */
import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { initialsOf } from '@/ui/photo';
import Barcode from './Barcode';
import { STATE_LABEL, daysLeft, fmtDate, groupNumber, themeFor } from './cardModel';
import './cards.css';

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
        <article className={`akc ${className}`} data-theme={theme.key} data-state={status.tone} aria-label={`AKK identification card of ${card.name}`}>
            <div className="akc__pattern" aria-hidden />
            {live ? <div className="akc__holo" aria-hidden /> : null}
            <header className="akc__band">
                <span className="akc__logo">
                    <img src="/Akk-logo.png" alt="" />
                </span>
                <span className="akc__org">
                    <b>AKK ENGINEERING PTE. LTD.</b>
                    <span>IDENTIFICATION CARD</span>
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
                    <p className="akc__name">{card.name || '—'}</p>
                    <div className="akc__grid">
                        <div>
                            <span className="akc__label">Employee ID</span>
                            <span className="akc__value akc__mono">{card.employee_id}</span>
                        </div>
                        <div>
                            <span className="akc__label">{local ? 'Type' : 'Work Permit No.'}</span>
                            {local ? (
                                <span className="akc__value">Local staff</span>
                            ) : (
                                <span className={`akc__value akc__mono ${card.work_permit_no ? '' : 'akc__muted'}`}>{card.work_permit_no || (card.work_permit_no === undefined ? '—' : 'Not on file')}</span>
                            )}
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <span className="akc__label">Designation</span>
                            <span className="akc__value">{card.designation || '—'}</span>
                        </div>
                    </div>
                </div>
            </div>
            <footer className="akc__foot">
                <span className="akc__status">{status.text}</span>
                {live ? <LiveClock /> : <span className="akc__micro">Property of AKK Engineering</span>}
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
    if (!card) return null;
    const theme = themeFor(card.role);
    const local = card.worker_type === 'local';
    const R = 47;
    const C = 2 * Math.PI * R;
    const full = number?.full || card.card_number || null;
    const shown = full && number?.show !== false;
    const masked = card.card_number_masked || (card.card_last4 ? `•••• •••• •••• ${card.card_last4}` : '—');
    return (
        <article className={`akc ${className}`} data-theme={theme.key} aria-label="Back of the identification card">
            <div className="akc__pattern" aria-hidden />
            <div className="akc__stripe" aria-hidden />
            <div className="akc__back">
                <div className="akc__details">
                    <div className="akc__cardno">
                        <span className="akc__label">
                            Card No.
                            {number?.onToggle && full ? (
                                <button type="button" className="akc__reveal" onClick={(e) => { e.stopPropagation(); number.onToggle(); }}>
                                    {shown ? 'HIDE' : 'SHOW'}
                                </button>
                            ) : null}
                        </span>
                        <span className="akc__value akc__mono">
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
                        </span>
                    </div>
                    {!local ? (
                        <div>
                            <span className="akc__label">Work Permit</span>
                            <span className="akc__value akc__mono">{card.work_permit_no || '—'}</span>
                            <span className="akc__label" style={{ marginTop: '0.4cqw' }}>Exp {fmtDate(card.permit_expiry_date)}</span>
                        </div>
                    ) : null}
                    <div>
                        <span className="akc__label">Safety Cert.</span>
                        <span className="akc__value akc__mono">{card.safety_cert_no || '—'}</span>
                        <span className="akc__label" style={{ marginTop: '0.4cqw' }}>Exp {fmtDate(card.safety_cert_expiry_date)}</span>
                    </div>
                    <div>
                        <span className="akc__label">Date Joined</span>
                        <span className="akc__value">{fmtDate(card.date_joined)}</span>
                    </div>
                    <div>
                        <span className="akc__label">Card Valid</span>
                        <span className="akc__value">
                            {fmtDate(card.valid_from)} – {fmtDate(card.valid_until)}
                        </span>
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
                    <span>{shown ? groupNumber(full) : masked}</span>
                </div>
            ) : null}
            <p className="akc__return">If found, please return to AKK Engineering Pte. Ltd., 15 Kaki Bukit Rd 4, #01-50, Singapore 417808.</p>
        </article>
    );
}
