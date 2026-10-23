/**
 * The holder's own digital ID card (Account tab): workers, and managers / supervisors / admins whose
 * login is linked to one or more employee IDs (a switcher appears when several are linked).
 *   - tap to flip → back with a LIVE QR (signed by the server, refreshed every 30 s; older than 2 min =
 *     shown as old to any verifier, so a screenshot can't be passed off), barcode, permit / certificate
 *   - ticking clock + moving holographic band on the front (a screenshot is obviously still)
 *   - "Details" sheet (Singpass-style), number reveal for 10 s, QR full screen
 *   - no photo yet → "Add passport photo" (crop dialog) right on the card
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ChevronDown, Copy, ImagePlus, Maximize2, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';
import PhotoCropDialog from '@/ui/PhotoCropDialog';
import { cardsMe } from './api';
import { CardBack, CardFront, cardStatus } from './CardFaces';
import FlipCard from './FlipCard';
import { fmtDate, groupNumber, qrPayload, themeFor } from './cardModel';

const REFRESH_MS = 30_000;
const STALE_MS = 115_000;

function useLiveCode(enabled, employeeId) {
    const [code, setCode] = useState(null);
    const [at, setAt] = useState(0);
    const [src, setSrc] = useState(null);
    const busy = useRef(false);
    const refresh = useCallback(async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            const r = await cardsMe.liveCode(employeeId);
            setCode(r.code);
            setAt(Date.now());
            setSrc(await QRCode.toDataURL(qrPayload(r.code), { margin: 1, width: 420, errorCorrectionLevel: 'M' }));
        } catch {
            /* offline: keep the last code; it is marked old after 2 minutes */
        } finally {
            busy.current = false;
        }
    }, [employeeId]);
    useEffect(() => {
        setCode(null);
        setAt(0);
        setSrc(null);
        if (!enabled) return undefined;
        void refresh();
        const id = window.setInterval(() => {
            if (document.visibilityState === 'visible') void refresh();
        }, REFRESH_MS);
        const onVis = () => document.visibilityState === 'visible' && void refresh();
        document.addEventListener('visibilitychange', onVis);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, [enabled, refresh]);
    return { code, at, src, refresh };
}

function useTick(enabled, ms = 1000) {
    const [, setT] = useState(0);
    useEffect(() => {
        if (!enabled) return undefined;
        const id = window.setInterval(() => setT((t) => t + 1), ms);
        return () => window.clearInterval(id);
    }, [enabled, ms]);
}

export default function DigitalCard({ canEditPhoto = false }) {
    const [card, setCard] = useState(undefined); // undefined = loading, null = no card
    const [choices, setChoices] = useState([]);
    const [empId, setEmpId] = useState(null); // chosen linked ID (staff with several)
    const [flipped, setFlipped] = useState(false);
    const [open, setOpen] = useState(false);
    const [showNumber, setShowNumber] = useState(false);
    const [zoom, setZoom] = useState(false);
    const [cropFile, setCropFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const fileRef = useRef(null);
    const hideTimer = useRef(0);

    useEffect(() => {
        if (UNIFIED) cardsMe.choices().then(setChoices).catch(() => setChoices([]));
    }, []);

    const load = useCallback(() => {
        if (!UNIFIED) return;
        cardsMe.card(empId).then((c) => setCard(c || null)).catch(() => setCard(null));
    }, [empId]);
    useEffect(() => {
        setFlipped(false);
        setShowNumber(false);
        load();
        const onPhoto = () => load();
        window.addEventListener('akk:photo-changed', onPhoto);
        return () => window.removeEventListener('akk:photo-changed', onPhoto);
    }, [load]);

    const valid = card?.state === 'valid';
    const live = useLiveCode(Boolean(valid), card?.employee_id && choices.length > 1 ? card.employee_id : null);
    const stale = !live.at || Date.now() - live.at > STALE_MS;
    useTick(Boolean(valid && (flipped || zoom)));

    useEffect(() => () => window.clearTimeout(hideTimer.current), []);
    const toggleNumber = () => {
        window.clearTimeout(hideTimer.current);
        setShowNumber((v) => {
            if (!v) hideTimer.current = window.setTimeout(() => setShowNumber(false), 10_000);
            return !v;
        });
    };

    const pickPhoto = () => fileRef.current?.click();
    const savePhoto = async (dataUrl) => {
        setSaving(true);
        try {
            const { error } = await supabaseCore.rpc('set_my_photo', { p_session_token: getRoleSessionToken(), p_photo: dataUrl });
            if (error) throw error;
            setCropFile(null);
            toast.success('Photo added to your ID card');
            window.dispatchEvent(new CustomEvent('akk:photo-changed'));
        } catch (e) {
            toast.error(e.message || 'Could not save the photo');
        } finally {
            setSaving(false);
        }
    };

    if (!UNIFIED || card === null) return null;
    if (card === undefined) {
        return <div className="mx-auto aspect-[1.586] w-full max-w-[440px] animate-pulse rounded-[18px] bg-slate-200/70" aria-busy="true" aria-label="Loading your ID card" />;
    }

    const status = cardStatus(card);
    const progress = live.at ? Math.min(1, (Date.now() - live.at) / REFRESH_MS) : null;
    const qr = valid ? { src: live.src, stale, progress: stale ? null : progress } : null;
    const theme = themeFor(card.role);
    const needsPhoto = !card.photo && canEditPhoto;
    const copyNumber = async () => {
        try {
            await navigator.clipboard.writeText(card.card_number);
            toast.success('Card number copied');
        } catch {
            toast.error('Could not copy');
        }
    };

    return (
        <div className="space-y-3">
            {choices.length > 1 ? (
                <div className="mx-auto flex max-w-[440px] gap-1.5 overflow-x-auto rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Your IDs">
                    {choices.map((c) => (
                        <button
                            key={c.employee_id}
                            type="button"
                            role="tab"
                            aria-selected={(empId || card.employee_id) === c.employee_id}
                            onClick={() => setEmpId(c.employee_id)}
                            className={`min-h-9 shrink-0 rounded-xl px-3 text-sm font-semibold ${(empId || card.employee_id) === c.employee_id ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600'}`}
                        >
                            {c.employee_id}
                            {!c.in_company ? <span className="ml-1 text-xs font-normal text-red-600">left</span> : null}
                        </button>
                    ))}
                </div>
            ) : null}

            {needsPhoto ? (
                <div className="akc-enter flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm ring-2 ring-amber-200">
                        <ImagePlus className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">Complete your ID card</span>
                        <span className="block text-xs text-slate-600">Add a passport-size photo — plain background, face centred.</span>
                    </span>
                    <button type="button" onClick={pickPhoto} className="h-9 shrink-0 rounded-xl bg-[var(--g-brand)] px-3 text-sm font-semibold text-white">
                        Add photo
                    </button>
                </div>
            ) : null}

            <div className="akc-enter">
                <FlipCard
                    flipped={flipped}
                    onFlip={setFlipped}
                    label={`${theme.label.toLowerCase()} ID card`}
                    front={<CardFront card={card} live={valid} onAddPhoto={needsPhoto ? pickPhoto : undefined} />}
                    back={<CardBack card={card} qr={qr} number={{ full: card.card_number, show: showNumber, onToggle: toggleNumber }} onQrClick={() => setZoom(true)} />}
                />
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                <RotateCw className="h-3.5 w-3.5" aria-hidden /> Tap the card to {flipped ? 'see the front' : 'show your QR'}
            </div>

            <div className="mx-auto max-w-[440px] overflow-hidden rounded-2xl border border-[var(--g-hairline)] bg-white">
                <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left">
                    <span>
                        <span className="block text-sm font-semibold text-slate-900">Card details</span>
                        <span className={`block text-xs ${status.tone === 'bad' ? 'text-red-700' : status.tone === 'warn' ? 'text-amber-700' : 'text-emerald-700'}`}>{status.text}</span>
                    </span>
                    <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                <div className="akc-sheet" data-open={open ? 'true' : 'false'}>
                    <div>
                        <dl className="akc-sheet__inner divide-y divide-[var(--g-hairline)] border-t border-[var(--g-hairline)] text-sm">
                            <Row label="Card number">
                                <span className="font-mono tracking-wider">{showNumber ? groupNumber(card.card_number) : `•••• •••• •••• ${card.card_last4}`}</span>
                                <button type="button" onClick={toggleNumber} className="ml-2 text-xs font-semibold text-[var(--g-brand-text)]">
                                    {showNumber ? 'Hide' : 'Show'}
                                </button>
                                {showNumber ? (
                                    <button type="button" onClick={copyNumber} className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-600" aria-label="Copy card number">
                                        <Copy className="h-3.5 w-3.5" />
                                    </button>
                                ) : null}
                            </Row>
                            <Row label="Card type">{theme.label.charAt(0) + theme.label.slice(1).toLowerCase()}</Row>
                            <Row label="Valid">
                                {fmtDate(card.valid_from)} – {fmtDate(card.valid_until)}
                            </Row>
                            {card.worker_type !== 'local' ? (
                                <Row label="Work permit">
                                    {card.work_permit_no || '—'} <span className="text-slate-500">· exp {fmtDate(card.permit_expiry_date)}</span>
                                </Row>
                            ) : null}
                            <Row label="Safety certificate">
                                {card.safety_cert_no || '—'} <span className="text-slate-500">· exp {fmtDate(card.safety_cert_expiry_date)}</span>
                            </Row>
                            <Row label="Date joined">{fmtDate(card.date_joined)}</Row>
                        </dl>
                    </div>
                </div>
            </div>

            {zoom && qr?.src ? (
                <div className="akc-qrzoom" role="dialog" aria-modal="true" aria-label="Your card QR code" onClick={() => setZoom(false)}>
                    <div className="akc-qrzoom__box text-center">
                        <p className="mb-1 text-lg font-bold text-slate-900">{card.name}</p>
                        <p className="mb-4 text-sm text-slate-500">
                            {card.employee_id} · {theme.label}
                        </p>
                        <img src={qr.src} alt="Card QR code" className={`mx-auto w-full rounded-2xl ${stale ? 'opacity-40 blur-sm' : ''}`} style={{ imageRendering: 'pixelated' }} />
                        <p className={`mt-4 text-sm font-medium ${stale ? 'text-red-700' : 'text-emerald-700'}`}>
                            {stale ? 'Code is old — check your connection' : `Live code · refreshes in ${Math.max(0, Math.ceil((REFRESH_MS - (Date.now() - live.at)) / 1000))}s`}
                        </p>
                        <button type="button" className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
                            <X className="h-4 w-4" /> Close
                        </button>
                    </div>
                </div>
            ) : null}

            {canEditPhoto ? (
                <>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) setCropFile(f);
                        }}
                    />
                    <PhotoCropDialog file={cropFile} busy={saving} onCancel={() => setCropFile(null)} onDone={savePhoto} />
                </>
            ) : null}
            {valid && flipped ? (
                <p className="text-center text-[11px] text-slate-400">
                    <Maximize2 className="mr-1 inline h-3 w-3" aria-hidden />
                    Tap the QR to show it full screen for scanning
                </p>
            ) : null}
        </div>
    );
}

function Row({ label, children }) {
    return (
        <div className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-40 sm:shrink-0">{label}</dt>
            <dd className="text-slate-900">{children}</dd>
        </div>
    );
}
