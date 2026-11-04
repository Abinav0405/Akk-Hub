/**
 * Admin → Employees → ID cards → "Security": what needs a look, newest first —
 *   card alerts (cancelled / replaced / ex-employee cards scanned, reused or old live codes),
 *   accounts locked after failed passwords, sign-ins (flagged when another sign-in was ended),
 *   and the older attendance security alerts.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, LogIn, ShieldAlert } from 'lucide-react';
import { cn } from '@/ui/utils';
import { cardsAdmin } from './api';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const CARD_KIND = { bad_card: 'Invalid card scanned', reused_code: 'Live code reused', old_code: 'Old live code shown' };

export default function SecurityFeed() {
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [showAllSignins, setShowAllSignins] = useState(false);
    useEffect(() => {
        cardsAdmin.securityFeed(200).then(setD).catch((e) => setError(e.message));
    }, []);

    if (error) {
        return (
            <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {/function .* does not exist|could not find the function/i.test(error) ? 'The security feed needs database update 107 — ask for it to be applied.' : error}
            </p>
        );
    }
    if (!d) {
        return (
            <p className="mt-3 flex items-center gap-2 p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
        );
    }
    const replaced = d.signins.filter((s) => s.event_type === 'signin_replaced');
    const signins = showAllSignins ? d.signins : replaced;
    const locked = d.lockouts.filter((l) => l.locked_until && new Date(l.locked_until) > new Date());

    return (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Block title="Card alerts" Icon={ShieldAlert} empty="No card alerts." count={d.card_alerts.length}>
                {d.card_alerts.map((a, i) => (
                    <Item key={i} tone={a.kind === 'old_code' ? 'amber' : 'red'} title={`${CARD_KIND[a.kind] || a.kind} — ${a.name || a.employee_id || 'unknown'}`} sub={`${a.detail} · by ${a.scanned_by || 'public'}`} at={a.at} />
                ))}
            </Block>
            <Block title="Locked / failing logins" Icon={KeyRound} empty="No failed-password lockouts." count={d.lockouts.length}>
                {d.lockouts.map((l, i) => (
                    <Item
                        key={i}
                        tone={locked.includes(l) ? 'red' : 'amber'}
                        title={`${l.identifier} (${l.role})`}
                        sub={`${l.failed_count} failed attempt${l.failed_count === 1 ? '' : 's'}${l.locked_until && new Date(l.locked_until) > new Date() ? ` · locked until ${when(l.locked_until)}` : ''}`}
                        at={l.at}
                    />
                ))}
            </Block>
            <Block
                title={showAllSignins ? 'All sign-ins' : 'Sign-ins that ended another session'}
                Icon={LogIn}
                empty={showAllSignins ? 'No sign-ins recorded yet.' : 'None — every sign-in was on the same device or after signing out.'}
                count={signins.length}
                action={
                    <button type="button" onClick={() => setShowAllSignins((v) => !v)} className="text-xs font-semibold text-[var(--g-brand-text)]">
                        {showAllSignins ? 'Only flagged' : 'Show all'}
                    </button>
                }
            >
                {signins.map((s, i) => (
                    <Item key={i} tone={s.event_type === 'signin_replaced' ? 'amber' : 'green'} title={`${s.identifier} (${s.role})`} sub={`${s.event_type === 'signin_replaced' ? 'New device — earlier sign-in ended' : 'Signed in'}${s.ip ? ` · ${s.ip}` : ''}`} at={s.at} />
                ))}
            </Block>
            <Block title="Other security alerts" Icon={AlertTriangle} empty="No alerts." count={d.alerts.length}>
                {d.alerts.map((a, i) => (
                    <Item key={i} tone="amber" title={`${a.alert_type} — ${a.identifier} (${a.role})`} sub={a.message} at={a.at} />
                ))}
            </Block>
        </div>
    );
}

function Block({ title, Icon, empty, count, action, children }) {
    return (
        <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--g-hairline)]">
            <h3 className="flex items-center gap-1.5 border-b border-[var(--g-hairline)] bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <Icon className="h-4 w-4 text-[var(--g-brand)]" /> {title}
                <span className="ml-auto flex items-center gap-3 text-xs font-medium text-slate-500">
                    {action}
                    {count}
                </span>
            </h3>
            <ul className="max-h-80 divide-y divide-[var(--g-hairline)] overflow-y-auto text-sm">{count ? children : <li className="p-4 text-center text-xs text-slate-400">{empty}</li>}</ul>
        </section>
    );
}

function Item({ tone, title, sub, at }) {
    return (
        <li className="flex items-start gap-2.5 px-3 py-2">
            <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} />
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{title}</span>
                {sub ? <span className="block text-xs text-slate-500">{sub}</span> : null}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-slate-400">{when(at)}</span>
        </li>
    );
}
