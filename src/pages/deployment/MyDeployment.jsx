/**
 * Worker: my deployments (published only) — today first, then upcoming, then the last week.
 * Opening a day marks it "seen" for the planner. Also exports the Home card.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Car, ChevronRight, Clock, MapPin, Navigation, Star, Users } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { Banner, EmptyState, Spinner } from '@/ui/hub/primitives';
import { UNIFIED } from '@/core/supabase';
import { dayLabel, deploymentApi, directionsUrl } from '@/core/deployment';
import { paths } from '@/app/paths';
import { cn } from '@/ui/utils';

function useMyDeployments() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        if (!UNIFIED) return;
        try {
            setData(await deploymentApi.mine());
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, []);
    useEffect(() => {
        load();
    }, [load]);
    return { data, error, reload: load, setData };
}

function DayItems({ day, compact = false }) {
    return (
        <ul className="space-y-2">
            {day.items.map((it, i) => {
                const dir = directionsUrl(it.latitude, it.longitude);
                return (
                    <li key={i} className={cn('rounded-xl bg-slate-50 p-3', compact && 'bg-white/70')}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                                    <MapPin className="h-4 w-4 shrink-0 text-[var(--g-brand)]" aria-hidden />
                                    <span className="truncate">{it.place}</span>
                                </p>
                                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-700">
                                    <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                    {it.start} – {it.end}
                                </p>
                            </div>
                            {dir ? (
                                <a href={dir} target="_blank" rel="noreferrer" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-sm font-semibold text-[var(--g-brand-text)] ring-1 ring-[var(--g-hairline)]">
                                    <Navigation className="h-4 w-4" aria-hidden /> Directions
                                </a>
                            ) : null}
                        </div>
                        {!compact ? (
                            <div className="mt-2 space-y-1 text-sm text-slate-700">
                                {it.is_lead ? (
                                    <p className="flex items-center gap-1.5 font-semibold text-[var(--g-brand-text)]">
                                        <Star className="h-4 w-4" aria-hidden /> You are the team lead
                                    </p>
                                ) : it.lead ? (
                                    <p>Team lead: {it.lead}</p>
                                ) : null}
                                {it.vehicle ? (
                                    <p className="flex items-center gap-1.5">
                                        <Car className="h-4 w-4 text-slate-400" aria-hidden />
                                        {it.vehicle}
                                        {it.is_driver ? ' · you are driving' : it.driver ? ` · driver ${it.driver}` : ''}
                                    </p>
                                ) : null}
                                {it.crew?.length ? (
                                    <p className="flex items-start gap-1.5">
                                        <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                        <span>With {it.crew.join(', ')}</span>
                                    </p>
                                ) : null}
                                {it.job_ref ? <p>Job: {it.job_ref}</p> : null}
                                {it.notes ? <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-900">{it.notes}</p> : null}
                            </div>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

function whenLabel(day, today) {
    if (day === today) return 'Today';
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (day === tomorrow) return 'Tomorrow';
    return dayLabel(day, { weekday: 'long' });
}

export default function MyDeployment() {
    const { data, error, setData } = useMyDeployments();

    // Opening the page counts as seeing every upcoming deployment shown.
    useEffect(() => {
        if (!data) return;
        const unseen = data.days.filter((d) => !d.seen && d.day >= data.today);
        if (!unseen.length) return;
        Promise.all(unseen.map((d) => deploymentApi.markSeen(d.day).catch(() => {}))).then(() =>
            setData((x) => ({ ...x, days: x.days.map((d) => (d.day >= x.today ? { ...d, seen: true } : d)) })),
        );
    }, [data, setData]);

    const upcoming = (data?.days || []).filter((d) => d.day >= data.today);
    const past = (data?.days || []).filter((d) => d.day < data.today).reverse();

    return (
        <HubPage title="My deployment" backTo={paths.hubs.worker} narrow>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {!data && !error ? (
                <div className="mt-8 flex justify-center">
                    <Spinner />
                </div>
            ) : null}
            {data && !upcoming.length ? (
                <EmptyState icon={MapPin} title="No deployment sent to you yet">
                    When your manager sends out a deployment you&apos;ll get a notification, and it shows here.
                </EmptyState>
            ) : null}
            <div className="space-y-3">
                {upcoming.map((d) => (
                    <section key={d.day} className="g-card g-card--pad">
                        <div className="mb-2 flex items-baseline justify-between gap-2">
                            <h2 className="text-lg font-semibold">{whenLabel(d.day, data.today)}</h2>
                            <span className="text-sm text-slate-500">{dayLabel(d.day)}</span>
                        </div>
                        {d.notes ? <p className="mb-2 rounded-lg bg-slate-100 px-3 py-2 text-sm">{d.notes}</p> : null}
                        <DayItems day={d} />
                    </section>
                ))}
            </div>
            {past.length ? (
                <>
                    <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Last 7 days</h3>
                    <ul className="divide-y divide-[var(--g-hairline)] rounded-2xl border border-[var(--g-hairline)] bg-white">
                        {past.map((d) => (
                            <li key={d.day} className="flex justify-between gap-3 px-4 py-3 text-sm">
                                <span className="text-slate-500">{dayLabel(d.day)}</span>
                                <span className="truncate text-right">{d.items.map((i) => `${i.place} ${i.start}–${i.end}`).join(', ')}</span>
                            </li>
                        ))}
                    </ul>
                </>
            ) : null}
        </HubPage>
    );
}

/** Home card: today's deployment, else the next one. */
export function MyDeploymentCard() {
    const { data } = useMyDeployments();
    if (!UNIFIED || !data) return null;
    const next = data.days.find((d) => d.day >= data.today);
    return (
        <Link to={paths.deployment.mine} className="g-card g-card--pad block transition-colors hover:bg-slate-50" aria-label="My deployment">
            <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--g-brand-text)]">
                    Deployment{next ? ` · ${whenLabel(next.day, data.today)}` : ''}
                </p>
                <span className="flex items-center gap-1 text-sm text-slate-500">
                    {next && !next.seen ? <span className="rounded-full bg-[var(--g-brand)] px-2 py-0.5 text-xs font-semibold text-white">New</span> : null}
                    <ChevronRight className="h-4 w-4" aria-hidden />
                </span>
            </div>
            {next ? <DayItems day={next} compact /> : <p className="text-sm text-slate-500">No deployment sent to you yet.</p>}
        </Link>
    );
}
