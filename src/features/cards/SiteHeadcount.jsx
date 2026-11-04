/**
 * "On site" (Scan ID card page): who is clocked in right now, grouped by site, and who is on today's
 * published deployment but not clocked in yet — for roll calls and evacuations.
 * Supervisors see their own site; managers and admins see every site. Refreshes every minute.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coffee, Loader2, MapPin, RefreshCw, UserX } from 'lucide-react';
import { Button } from '@/ui/button';
import { cardsScan } from './api';

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) : '');

export default function SiteHeadcount() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setBusy(true);
        try {
            setData(await cardsScan.headcount());
            setError('');
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    }, []);
    useEffect(() => {
        load();
        const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
        return () => window.clearInterval(id);
    }, [load]);

    const sites = useMemo(() => {
        const by = new Map();
        for (const p of data?.on_site || []) {
            const key = p.site || 'Unknown site';
            if (!by.has(key)) by.set(key, []);
            by.get(key).push(p);
        }
        return [...by.entries()];
    }, [data]);

    if (error) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
    if (!data) {
        return (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading headcount…
            </p>
        );
    }
    const total = data.on_site.length;
    const onBreak = data.on_site.filter((p) => p.on_break).length;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--g-hairline)] bg-white p-3">
                <div className="min-w-0 flex-1">
                    <p className="text-3xl font-bold leading-none tabular-nums text-slate-900">{total}</p>
                    <p className="mt-1 text-xs text-slate-500">
                        on site now{onBreak ? ` · ${onBreak} on break` : ''} · updated {hm(data.at)}
                    </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={load} disabled={busy} aria-label="Refresh headcount">
                    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            {!sites.length ? <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">Nobody is clocked in right now.</p> : null}
            {sites.map(([site, people]) => (
                <section key={site} className="overflow-hidden rounded-2xl border border-[var(--g-hairline)] bg-white">
                    <h3 className="flex items-center gap-1.5 border-b border-[var(--g-hairline)] bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                        <MapPin className="h-4 w-4 text-[var(--g-brand)]" /> {site}
                        <span className="ml-auto text-xs font-medium text-slate-500">{people.length}</span>
                    </h3>
                    <ul className="divide-y divide-[var(--g-hairline)]">
                        {people.map((p) => (
                            <li key={p.worker_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-slate-900">{p.name || p.worker_id}</span>
                                    <span className="block text-xs text-slate-500">
                                        {p.worker_id} · in since {hm(p.entry_time)}
                                        {p.last_scan ? ` · card scanned ${hm(p.last_scan)}` : ''}
                                    </span>
                                </span>
                                {p.on_break ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                        <Coffee className="h-3 w-3" /> Break
                                    </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </section>
            ))}

            {data.expected?.length ? (
                <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
                    <h3 className="flex items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                        <UserX className="h-4 w-4" /> Deployed today, not clocked in
                        <span className="ml-auto text-xs font-medium">{data.expected.length}</span>
                    </h3>
                    <ul className="divide-y divide-[var(--g-hairline)]">
                        {data.expected.map((p) => (
                            <li key={`${p.employee_id}-${p.place}`} className="px-3 py-2 text-sm">
                                <span className="block truncate font-medium text-slate-900">{p.name || p.employee_id}</span>
                                <span className="block text-xs text-slate-500">
                                    {p.employee_id} · {p.place || 'Site'}
                                    {p.start ? ` · ${String(p.start).slice(0, 5)}–${String(p.end || '').slice(0, 5)}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}
