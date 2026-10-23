/**
 * Admin: one person's ID card — flip to the back (printed-card QR, barcode), and when `actions`:
 *   renew (new number, old one stops working) · cancel (lost / stolen) · print PVC
 *   linked logins (manager / supervisor / admin accounts → card colour) · card history · recent scans
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Ban, History, Link2, Loader2, Printer, RefreshCw, RotateCw, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { cardsAdmin } from './api';
import { CardBack, CardFront } from './CardFaces';
import FlipCard from './FlipCard';
import { downloadPvcCards } from './pvcPrint';
import { STATE_LABEL, fmtDate, qrPayload, themeFor } from './cardModel';

const ROLE_TONE = { admin: 'bg-red-50 text-red-800', manager: 'bg-emerald-50 text-emerald-800', supervisor: 'bg-blue-50 text-blue-800' };

export default function AdminCardView({ employeeId, actions = true, onChanged }) {
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [qrSrc, setQrSrc] = useState(null);
    const [flipped, setFlipped] = useState(false);
    const [busy, setBusy] = useState('');
    const [accounts, setAccounts] = useState(null);
    const [pick, setPick] = useState('');
    const [showHistory, setShowHistory] = useState(false);

    const load = useCallback(async () => {
        try {
            setError('');
            setD(await cardsAdmin.detail(employeeId));
        } catch (e) {
            setError(e.message);
        }
    }, [employeeId]);
    useEffect(() => {
        setD(null);
        setFlipped(false);
        if (employeeId) load();
    }, [employeeId, load]);

    const card = d?.card ? { ...d.card, role: d.role } : null;
    useEffect(() => {
        if (!card?.qr_token) return;
        QRCode.toDataURL(qrPayload(`AKK1P.${card.qr_token}`), { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setQrSrc).catch(() => setQrSrc(null));
    }, [card?.qr_token]);

    useEffect(() => {
        if (!actions || accounts) return;
        cardsAdmin.linkable().then(setAccounts).catch(() => setAccounts([]));
    }, [actions, accounts]);
    const free = useMemo(() => (accounts || []).filter((a) => !(a.employee_ids || []).includes(employeeId)), [accounts, employeeId]);

    const run = async (key, fn, ok) => {
        setBusy(key);
        try {
            await fn();
            if (ok) toast.success(ok);
            await load();
            onChanged?.();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy('');
        }
    };

    if (error) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
    if (!d) return <div className="mx-auto aspect-[1.586] w-full max-w-[440px] animate-pulse rounded-[18px] bg-slate-200/70" aria-busy="true" />;
    if (!card) return <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">No card — this person is not in the company.</p>;

    const active = card.status === 'active';
    return (
        <div className="space-y-3">
            <FlipCard
                flipped={flipped}
                onFlip={setFlipped}
                front={<CardFront card={card} />}
                back={<CardBack card={card} qr={qrSrc ? { src: qrSrc, stale: !active } : null} number={{ full: card.card_number, show: true }} />}
            />
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <RotateCw className="h-3.5 w-3.5" aria-hidden /> Tap the card to flip · {themeFor(card.role).label.toLowerCase()} card · {STATE_LABEL[card.state] || card.state}
                {card.printed_count ? ` · printed ${card.printed_count}×` : ''}
            </p>

            {actions ? (
                <>
                    <div className="grid grid-cols-3 gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!!busy || card.state === 'left'}
                            onClick={() => {
                                const reason = window.prompt(active ? 'Renew this card? The old number and QR stop working.\nReason (optional):' : 'Issue a new card?\nReason (optional):', active ? 'Renewal' : 'New card');
                                if (reason === null) return;
                                run('renew', () => cardsAdmin.renew(employeeId, reason), 'New card issued');
                            }}
                        >
                            {busy === 'renew' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {active ? 'Renew' : 'New card'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!!busy || !active}
                            onClick={() => {
                                const reason = window.prompt('Cancel this card (lost / stolen)? It stops working at once.\nReason:', 'Lost card');
                                if (!reason) return;
                                run('void', () => cardsAdmin.cancel(employeeId, reason), 'Card cancelled');
                            }}
                        >
                            <Ban className="h-4 w-4" /> Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!!busy || !active}
                            onClick={() =>
                                run('print', async () => {
                                    const rows = await cardsAdmin.forPrint([employeeId]);
                                    await downloadPvcCards(rows.map((r) => ({ ...r, role: card.role })), `AKK-Card-${employeeId}.pdf`);
                                })
                            }
                        >
                            {busy === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
                        </Button>
                    </div>

                    <section className="rounded-xl border border-[var(--g-hairline)] bg-white p-3">
                        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                            <Link2 className="h-4 w-4 text-[var(--g-brand)]" /> Linked logins
                        </h4>
                        <p className="mb-2 text-xs text-slate-500">
                            Link this person&apos;s manager / supervisor / admin logins (one login can be linked to several IDs, e.g. 1047 and 1047r). The highest role sets the card colour (admin = white, manager = green,
                            supervisor = blue, employee = red) and shows their card when they sign in with those logins.
                        </p>
                        <ul className="space-y-1.5">
                            {d.links.map((l) => (
                                <li key={l.login} className="flex items-center gap-2 text-sm">
                                    <span className="min-w-0 flex-1 truncate">
                                        {l.name ? `${l.name} · ` : ''}
                                        <span className="font-mono text-xs text-slate-600">{l.login}</span>
                                    </span>
                                    {l.roles.map((r) => (
                                        <span key={r} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${ROLE_TONE[r] || 'bg-slate-100'}`}>
                                            {r}
                                        </span>
                                    ))}
                                    <button
                                        type="button"
                                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700"
                                        aria-label={`Unlink ${l.login}`}
                                        disabled={!!busy}
                                        onClick={() => run('unlink', () => cardsAdmin.unlink(l.login, employeeId), 'Unlinked').then(() => setAccounts(null))}
                                    >
                                        <Unlink className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                            {!d.links.length ? <li className="text-xs italic text-slate-400">No linked logins — employee card.</li> : null}
                        </ul>
                        <div className="mt-2 flex gap-2">
                            <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm" aria-label="Login to link">
                                <option value="">{accounts ? (free.length ? 'Choose a login to link…' : 'All logins are linked') : 'Loading logins…'}</option>
                                {free.map((a) => (
                                    <option key={a.login} value={a.login}>
                                        {a.name ? `${a.name} — ` : ''}
                                        {a.login} ({a.top_role}){a.employee_ids?.length ? ` · also ${a.employee_ids.join(', ')}` : ''}
                                    </option>
                                ))}
                            </select>
                            <Button
                                type="button"
                                size="sm"
                                disabled={!pick || !!busy}
                                onClick={() =>
                                    run('link', () => cardsAdmin.link(employeeId, pick), 'Login linked').then(() => {
                                        setPick('');
                                        setAccounts(null);
                                    })
                                }
                            >
                                Link
                            </Button>
                        </div>
                    </section>

                    <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                        <History className="h-4 w-4" /> {showHistory ? 'Hide' : 'Show'} card history & scans
                    </button>
                    {showHistory ? (
                        <div className="grid gap-3 md:grid-cols-2">
                            <ul className="divide-y divide-[var(--g-hairline)] rounded-xl border border-[var(--g-hairline)] bg-white text-sm">
                                {d.history.map((h, i) => (
                                    <li key={i} className="px-3 py-2">
                                        <span className="font-mono">•••• {h.card_last4}</span> <span className="capitalize text-slate-600">· {h.status}</span>
                                        <span className="block text-xs text-slate-500">
                                            {fmtDate(h.valid_from)} – {fmtDate(h.valid_until)}
                                            {h.end_reason ? ` · ${h.end_reason}` : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <ul className="max-h-60 divide-y divide-[var(--g-hairline)] overflow-y-auto rounded-xl border border-[var(--g-hairline)] bg-white text-sm">
                                {d.scans.length ? (
                                    d.scans.map((s, i) => (
                                        <li key={i} className="flex items-center gap-2 px-3 py-2">
                                            <span className={`h-2 w-2 shrink-0 rounded-full ${s.result === 'red' ? 'bg-red-500' : s.result === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                                            <span className="min-w-0 flex-1 truncate capitalize">
                                                {s.purpose} · {String(s.method || '').replace('_', ' ')} <span className="normal-case text-slate-500">· {s.by || 'public'}</span>
                                            </span>
                                            <span className="text-xs text-slate-400">{new Date(s.at).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                        </li>
                                    ))
                                ) : (
                                    <li className="px-3 py-3 text-xs text-slate-400">No scans yet.</li>
                                )}
                            </ul>
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
