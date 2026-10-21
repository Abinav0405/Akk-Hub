/**
 * Supervisor (view only): who is deployed to my site on a day, and who has clocked in.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, MapPin } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { Banner, EmptyState, Spinner } from '@/ui/hub/primitives';
import { addDays, dayLabel, deploymentApi, iso } from '@/core/deployment';
import { paths } from '@/app/paths';

export default function SiteCrew() {
    const [day, setDay] = useState(() => iso(new Date()));
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        setData(null);
        deploymentApi
            .crew(day)
            .then((d) => live && (setData(d), setError('')))
            .catch((e) => live && setError(e.message));
        return () => {
            live = false;
        };
    }, [day]);

    return (
        <HubPage title="Site crew" backTo={paths.hubs.supervisor} narrow>
            <div className="flex items-center gap-2">
                {[0, 1].map((n) => {
                    const d = addDays(iso(new Date()), n);
                    return (
                        <button key={n} type="button" aria-pressed={day === d} onClick={() => setDay(d)} className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${day === d ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]' : 'border-[var(--g-hairline)] bg-white'}`}>
                            {n === 0 ? 'Today' : 'Tomorrow'}
                        </button>
                    );
                })}
                <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-10 rounded-full border border-[var(--g-hairline)] bg-white px-3 text-sm" aria-label="Pick a day" />
            </div>
            {error ? <Banner tone="danger" className="mt-3">{error}</Banner> : null}
            {!data && !error ? (
                <div className="mt-8 flex justify-center">
                    <Spinner />
                </div>
            ) : null}
            {data && !data.sites.length ? (
                <EmptyState icon={MapPin} title={`No deployment sent for ${dayLabel(day)}`} className="mt-4" />
            ) : null}
            <div className="mt-4 space-y-3">
                {(data?.sites || []).map((s, i) => (
                    <section key={i} className="g-card g-card--pad">
                        <h2 className="font-semibold">{s.place}</h2>
                        <p className="text-sm text-slate-500">
                            {s.start}–{s.end}
                            {s.lead ? ` · lead ${s.lead}` : ''}
                        </p>
                        {s.notes ? <p className="mt-1 text-sm">{s.notes}</p> : null}
                        <ul className="mt-2 divide-y divide-[var(--g-hairline)]">
                            {(s.crew || []).map((c) => (
                                <li key={c.employee_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                                    <span className="min-w-0 truncate">
                                        {c.name} <span className="text-slate-400">{c.employee_id}</span>
                                        {c.start !== s.start || c.end !== s.end ? <span className="text-slate-500"> · {c.start}–{c.end}</span> : null}
                                    </span>
                                    {c.clocked_in ? (
                                        <span className="flex shrink-0 items-center gap-1 text-emerald-700">
                                            <CheckCircle2 className="h-4 w-4" /> In{c.clocked_site && c.clocked_site !== s.place ? ` at ${c.clocked_site}` : ''}
                                        </span>
                                    ) : (
                                        <span className="flex shrink-0 items-center gap-1 text-slate-400">
                                            <Circle className="h-4 w-4" /> Not in
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </HubPage>
    );
}
