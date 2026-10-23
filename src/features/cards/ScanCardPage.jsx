/**
 * Staff: "Scan ID card" (/card/scan) — supervisors, managers, admins.
 *   Check card: verify + site access check (supervisor → their site; admin may pick a site)
 *   Clock in / out: scan a worker's card and record entry / break / exit with the normal shift rules
 */
import { useEffect, useState } from 'react';
import { Car, Coffee, Loader2, LogIn, LogOut, ScanLine, ShieldCheck } from 'lucide-react';
import VehicleByCard from './VehicleByCard';
import { toast } from 'sonner';
import { HubPage } from '@/ui/PortalShell';
import { Button } from '@/ui/button';
import { useIdentity } from '@/core/auth/identity';
import { UNIFIED, supabaseCore, supabaseTimesheet } from '@/core/supabase';
import { cardsScan } from './api';
import CardScanner from './CardScanner';
import VerifyResult from './VerifyResult';
import { clockIn, clockOut, openShiftOf, toggleBreak } from './cardClock';
import { CardFront } from './CardFaces';

export default function ScanCardPage() {
    const identity = useIdentity();
    const role = identity?.role;
    const [mode, setMode] = useState('verify');
    const [nonce, setNonce] = useState(0);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [places, setPlaces] = useState([]);
    const [place, setPlace] = useState('');

    useEffect(() => {
        if (role !== 'admin' || !UNIFIED) return;
        supabaseCore.rpc('admin_list_places').then(({ data }) => setPlaces(Array.isArray(data) ? data : []));
    }, [role]);

    const next = () => {
        setResult(null);
        setNonce((n) => n + 1);
    };

    const onVerify = async (code) => {
        setBusy(true);
        try {
            setResult(await cardsScan.verify(code, 'site', place || null));
        } catch (e) {
            toast.error(e.message);
            next();
        } finally {
            setBusy(false);
        }
    };

    return (
        <HubPage title="Scan ID card" eyebrow="AKK ID" narrow>
            <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-100 p-1" role="tablist">
                {[
                    ['verify', 'Check card', ShieldCheck],
                    ['clock', 'Clock in / out', LogIn],
                    ['vehicle', 'Vehicle', Car],
                ].map(([k, l, Icon]) => (
                    <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={mode === k}
                        onClick={() => {
                            setMode(k);
                            next();
                        }}
                        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors ${mode === k ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600'}`}
                    >
                        <Icon className="h-4 w-4" /> {l}
                    </button>
                ))}
            </div>

            {mode === 'verify' ? (
                <div className="space-y-3">
                    {role === 'admin' && places.length ? (
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-slate-700">Check for site (optional)</span>
                            <select value={place} onChange={(e) => setPlace(e.target.value)} className="h-11 w-full rounded-xl border border-[var(--g-hairline)] bg-white px-3">
                                <option value="">Any site — show today&apos;s deployment</option>
                                {places.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    {result ? (
                        <VerifyResult result={result}>
                            <Button type="button" className="mt-2 h-12 w-full" onClick={next}>
                                <ScanLine className="mr-2 h-4 w-4" /> Scan next card
                            </Button>
                        </VerifyResult>
                    ) : (
                        <CardScanner key={nonce} onCode={onVerify} busy={busy} />
                    )}
                </div>
            ) : mode === 'vehicle' ? (
                <VehicleByCard key={nonce} onNext={next} />
            ) : (
                <ClockByCard key={nonce} onNext={next} />
            )}
        </HubPage>
    );
}

function ClockByCard({ onNext }) {
    const [ctx, setCtx] = useState(null);
    const [busy, setBusy] = useState(false);
    const [shift, setShift] = useState(undefined);
    const [sites, setSites] = useState([]);
    const [siteId, setSiteId] = useState('');
    const [done, setDone] = useState('');

    const onCode = async (code) => {
        setBusy(true);
        try {
            const r = await cardsScan.clockContext(code);
            setCtx(r);
            if (r.found && !r.blocked) {
                setShift(await openShiftOf(r.worker_id));
                if (!r.site) {
                    const { data } = await supabaseTimesheet.from('sites').select('id, site_name, is_active').order('site_name');
                    setSites((data || []).filter((s) => s.is_active !== false));
                }
            }
        } catch (e) {
            toast.error(e.message);
            onNext();
        } finally {
            setBusy(false);
        }
    };

    if (!ctx) return <CardScanner onCode={onCode} busy={busy} hint="Scan the worker's ID card" />;
    if (!ctx.found || ctx.blocked) {
        return (
            <VerifyResult result={ctx.found ? { ...ctx, overall: 'red' } : ctx}>
                {ctx.blocked ? <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{ctx.blocked}</p> : null}
                <Button type="button" className="mt-2 h-12 w-full" onClick={onNext}>
                    Scan another card
                </Button>
            </VerifyResult>
        );
    }

    const site = ctx.site || sites.find((s) => s.id === siteId) || null;
    const act = async (fn) => {
        if (!site) {
            toast.error('Choose the site first');
            return;
        }
        setBusy(true);
        try {
            const msg = await fn(ctx.worker_id, site);
            setDone(msg);
            setShift(await openShiftOf(ctx.worker_id));
            toast.success(`${msg} — ${ctx.card.name}`);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };
    const warn = ctx.overall !== 'green' ? (ctx.checks || []).filter((c) => c.level === 'red' || c.level === 'amber') : [];

    return (
        <div className="space-y-3">
            <div className="mx-auto w-full max-w-[400px]">
                <CardFront card={ctx.card} />
            </div>
            {warn.length ? (
                <ul className="space-y-1">
                    {warn.map((c, i) => (
                        <li key={i} className={`rounded-xl px-3 py-2 text-sm font-medium ${c.level === 'red' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
                            {c.text}
                        </li>
                    ))}
                </ul>
            ) : null}
            {ctx.site ? (
                <p className="text-center text-sm text-slate-600">
                    Site: <b>{ctx.site.site_name}</b>
                </p>
            ) : (
                <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-11 w-full rounded-xl border border-[var(--g-hairline)] bg-white px-3" aria-label="Site">
                    <option value="">Choose the site…</option>
                    {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.site_name}
                        </option>
                    ))}
                </select>
            )}
            <p className="text-center text-sm font-medium text-slate-700">
                {shift === undefined ? 'Checking…' : shift ? `${shift.on_break ? 'On break' : 'Clocked in'} at ${shift.sites?.site_name || 'site'} since ${new Date(shift.entry_time).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}` : 'Not clocked in'}
            </p>
            {done ? <p className="akc-verdict rounded-xl bg-emerald-600 p-3 text-center font-semibold text-white">{done} ✓</p> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button type="button" className="h-12" disabled={busy || !!shift} onClick={() => act(clockIn)}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />} Clock in
                </Button>
                <Button type="button" variant="outline" className="h-12" disabled={busy || !shift} onClick={() => act(toggleBreak)}>
                    <Coffee className="mr-2 h-4 w-4" /> {shift?.on_break ? 'End break' : 'Start break'}
                </Button>
                <Button type="button" variant="outline" className="h-12" disabled={busy || !shift} onClick={() => act(clockOut)}>
                    <LogOut className="mr-2 h-4 w-4" /> Clock out
                </Button>
            </div>
            <Button type="button" variant="ghost" className="h-11 w-full" onClick={onNext}>
                <ScanLine className="mr-2 h-4 w-4" /> Scan next worker
            </Button>
        </div>
    );
}
