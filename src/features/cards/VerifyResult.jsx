/**
 * Result of a card check: big green / amber / red verdict, how the card was presented (live phone card,
 * printed card, typed number, old code = screenshot), the card front, every check, and — for staff —
 * today's deployment, open shift and vehicle.
 */
import { AlertTriangle, Car, CheckCircle2, Clock, Info, MapPin, ShieldAlert, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { CardFront } from './CardFaces';
import './cards.css';

const VERDICT = {
    green: { cls: 'bg-emerald-600', Icon: ShieldCheck, title: 'Verified' },
    amber: { cls: 'bg-amber-500', Icon: AlertTriangle, title: 'Check needed' },
    red: { cls: 'bg-red-600', Icon: ShieldAlert, title: 'Not allowed' },
};
const LEVEL = {
    red: { Icon: XCircle, cls: 'text-red-700 bg-red-50' },
    amber: { Icon: AlertTriangle, cls: 'text-amber-800 bg-amber-50' },
    green: { Icon: CheckCircle2, cls: 'text-emerald-800 bg-emerald-50' },
    info: { Icon: Info, cls: 'text-slate-700 bg-slate-50' },
};
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) : '');
const hm = (s) => (s ? String(s).slice(0, 5) : '');

export function methodLabel(r) {
    if (r.method === 'live') return r.live ? { text: 'Live card on the phone', tone: 'text-emerald-700', Icon: Smartphone } : { text: 'Old code — probably a screenshot', tone: 'text-red-700', Icon: ShieldAlert };
    if (r.method === 'printed') return { text: 'Printed card — compare the photo with the person', tone: 'text-slate-700', Icon: Info };
    return { text: 'Card number or barcode — compare the photo with the person', tone: 'text-slate-700', Icon: Info };
}

export default function VerifyResult({ result, children }) {
    if (!result) return null;
    if (!result.found) {
        return (
            <div className="akc-verdict rounded-2xl bg-red-600 p-5 text-center text-white">
                <XCircle className="mx-auto h-10 w-10" />
                <p className="mt-2 text-lg font-bold">Not an AKK card</p>
                <p className="text-sm text-white/85">{result.message || 'This code is not a valid AKK ID card.'}</p>
                {children}
            </div>
        );
    }
    const v = VERDICT[result.overall] || VERDICT.amber;
    const m = methodLabel(result);
    const today = result.today;
    return (
        <div className="space-y-3">
            <div className={`akc-verdict flex items-center gap-3 rounded-2xl p-4 text-white ${v.cls}`} role="status">
                <v.Icon className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">{v.title}</p>
                    <p className="truncate text-sm text-white/90">
                        {result.card?.name} · {result.card?.employee_id}
                    </p>
                </div>
            </div>
            <p className={`flex items-center justify-center gap-1.5 text-sm font-medium ${m.tone}`}>
                <m.Icon className="h-4 w-4" /> {m.text}
            </p>
            <div className="mx-auto w-full max-w-[400px]">
                <CardFront card={result.card} />
            </div>
            <ul className="space-y-1.5">
                {(result.checks || []).map((c, i) => {
                    const L = LEVEL[c.level] || LEVEL.info;
                    return (
                        <li key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium ${L.cls}`}>
                            <L.Icon className="mt-0.5 h-4 w-4 shrink-0" /> {c.text}
                        </li>
                    );
                })}
                {!result.checks?.length ? (
                    <li className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium ${LEVEL.green.cls}`}>
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Card, permit and safety certificate are all valid
                    </li>
                ) : null}
            </ul>
            {today ? (
                <div className="grid gap-2 sm:grid-cols-3">
                    <Fact Icon={MapPin} label="Today's deployment" value={today.deployment ? `${today.deployment.place || 'Site'}${today.deployment.start ? ` · ${hm(today.deployment.start)}–${hm(today.deployment.end)}` : ''}` : 'Not deployed'} />
                    <Fact Icon={Clock} label="Shift" value={today.shift ? `${today.shift.on_break ? 'On break' : 'Clocked in'} at ${today.shift.site || 'site'} since ${t(today.shift.entry_time)}` : 'Not clocked in'} />
                    <Fact Icon={Car} label="Vehicle" value={today.vehicle ? `${today.vehicle.status === 'on_break' ? 'On break with' : 'Driving'} ${today.vehicle.vehicle} since ${t(today.vehicle.started_at)}` : 'Not driving'} />
                </div>
            ) : null}
            <p className="text-center text-xs text-slate-400">Checked {new Date(result.verified_at).toLocaleString('en-SG')}</p>
            {children}
        </div>
    );
}

function Fact({ Icon, label, value }) {
    return (
        <div className="rounded-xl border border-[var(--g-hairline)] bg-white px-3 py-2">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Icon className="h-3.5 w-3.5" /> {label}
            </p>
            <p className="mt-0.5 text-sm font-medium text-slate-900">{value}</p>
        </div>
    );
}
