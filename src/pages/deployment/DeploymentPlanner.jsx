/**
 * Deployment planner (managers + admins): week strip → day editor.
 *   Sites (Attendance sites only) → time window, team lead, vehicle + driver, job ref, notes → crew.
 *   A worker may be at more than one site a day; overlapping times, approved leave and people who
 *   left the company are flagged here and refused by the server.
 *   Save draft → Publish (workers notified at once) → later edits → Send changes (only affected
 *   workers notified). "Seen" ticks show who has opened their deployment.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, CalendarDays, Car, Check, ChevronLeft, ChevronRight, Copy, Eye, Loader2, MapPin, Moon, Plus, Save, Search,
    Send, Sun, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { Banner, EmptyState, Spinner } from '@/ui/hub/primitives';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { UNIFIED } from '@/core/supabase';
import { addDays, dayLabel, deploymentApi, endSuffix, iso, mondayOf, overlaps, parseDay } from '@/core/deployment';
import DateInput from '@/ui/DateInput';
import { toast } from 'sonner';
import { useIdentity, homePathFor } from '@/core/auth/identity';
import { cn } from '@/ui/utils';

const field = 'h-10 w-full rounded-lg border border-[var(--g-hairline)] bg-white px-2.5 text-sm';

const emptySite = (place) => ({
    key: Math.random().toString(36).slice(2),
    place_id: place?.id || '',
    start_time: '08:00',
    end_time: '17:00',
    end_plus: 0,
    team_lead: '',
    vehicle_id: '',
    driver_id: '',
    job_ref: '',
    notes: '',
    crew: [],
});

function fromServerDay(day) {
    return {
        notes: day?.notes || '',
        sites: (day?.sites || []).map((s) => ({
            key: s.id,
            place_id: s.place_id,
            start_time: s.start_time,
            end_time: s.end_time,
            end_plus: Number(s.end_plus) || 0,
            team_lead: s.team_lead || '',
            vehicle_id: s.vehicle_id || '',
            driver_id: s.driver_id || '',
            job_ref: s.job_ref || '',
            notes: s.notes || '',
            crew: s.crew.map((c) => ({
                employee_id: c.employee_id,
                start_time: c.start_time,
                end_time: c.end_time,
                end_plus: Number(c.end_plus) || 0,
                leave_override: c.leave_override,
                seen_at: c.seen_at,
            })),
        })),
    };
}

function toPayload(draft) {
    return {
        notes: draft.notes,
        sites: draft.sites.map((s) => ({
            place_id: s.place_id,
            start_time: s.start_time,
            end_time: s.end_time,
            end_plus: s.end_plus || 0,
            team_lead: s.team_lead,
            vehicle_id: s.vehicle_id,
            driver_id: s.driver_id,
            job_ref: s.job_ref,
            notes: s.notes,
            crew: s.crew.map((c) => ({
                employee_id: c.employee_id,
                start_time: ownTimes(s, c) ? c.start_time : null,
                end_time: ownTimes(s, c) ? c.end_time : null,
                end_plus: ownTimes(s, c) ? c.end_plus || 0 : null,
                leave_override: Boolean(c.leave_override),
            })),
        })),
    };
}

/** A crew member with times of their own (not the site's). */
const ownTimes = (s, c) => c.start_time !== s.start_time || c.end_time !== s.end_time || (c.end_plus || 0) !== (s.end_plus || 0);

/** Effective times of a crew member (custom or the site's). */
const span = (site, c) => ({ start: c.start_time || site.start_time, end: c.end_time || site.end_time, endPlus: c.end_plus ?? site.end_plus ?? 0 });

function statusOf(day) {
    if (!day) return { label: 'Not planned', tone: 'none' };
    if (day.status === 'draft') return { label: 'Draft', tone: 'draft' };
    if (day.dirty) return { label: 'Changes not sent', tone: 'changed' };
    return { label: 'Sent', tone: 'sent' };
}
const TONE = {
    none: 'bg-slate-100 text-slate-500',
    draft: 'bg-amber-50 text-amber-800',
    changed: 'bg-amber-100 text-amber-900',
    sent: 'bg-emerald-50 text-emerald-800',
};

export default function DeploymentPlanner() {
    const identity = useIdentity();
    const [weekStart, setWeekStart] = useState(null);
    const [selected, setSelected] = useState(null);
    const [board, setBoard] = useState(null);
    const [draft, setDraft] = useState(null);
    const [edited, setEdited] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [picker, setPicker] = useState(null); // site key
    const [copyOpen, setCopyOpen] = useState(false);

    const load = useCallback(async (start, day) => {
        setError('');
        try {
            const data = await deploymentApi.board(start, addDays(start, 6));
            setBoard(data);
            const current = data.days.find((d) => d.day === day);
            setDraft(fromServerDay(current));
            setEdited(false);
        } catch (e) {
            setError(e.message);
        }
    }, []);

    // First load: the week containing tomorrow, tomorrow selected.
    useEffect(() => {
        if (!UNIFIED) return;
        (async () => {
            try {
                const today = iso(new Date());
                const tomorrow = addDays(today, 1);
                const start = mondayOf(tomorrow);
                setWeekStart(start);
                setSelected(tomorrow);
                await load(start, tomorrow);
            } catch (e) {
                setError(e.message);
            }
        })();
    }, [load]);

    const daysById = useMemo(() => Object.fromEntries((board?.days || []).map((d) => [d.day, d])), [board]);
    const serverDay = selected ? daysById[selected] : null;
    const workers = board?.workers || [];
    const workerName = useCallback((id) => workers.find((w) => w.employee_id === id)?.name || id, [workers]);
    const places = board?.places || [];
    const placeById = useMemo(() => Object.fromEntries(places.map((p) => [p.id, p])), [places]);
    const onLeave = useCallback(
        (id) => (board?.leave || []).find((l) => l.employee_id === id && selected >= l.from && selected <= l.to),
        [board, selected],
    );

    const goTo = async (day, start = weekStart) => {
        if (edited) {
            const ok = await confirmAction({ title: 'Discard your unsaved changes?', confirmLabel: 'Discard', destructive: true });
            if (!ok) return;
        }
        setSelected(day);
        setNotice('');
        if (start !== weekStart) {
            setWeekStart(start);
            setBoard(null);
            await load(start, day);
        } else {
            setDraft(fromServerDay(daysById[day]));
            setEdited(false);
        }
    };

    const update = (fn) => {
        setDraft((d) => fn(structuredClone(d)));
        setEdited(true);
        setNotice('');
    };
    const updateSite = (key, patch) =>
        update((d) => {
            const s = d.sites.find((x) => x.key === key);
            const oldStart = s.start_time;
            const oldEnd = s.end_time;
            const oldPlus = s.end_plus || 0;
            Object.assign(s, patch);
            // Crew following the site's times move with it.
            if (patch.start_time || patch.end_time || patch.end_plus !== undefined) {
                s.crew.forEach((c) => {
                    if (c.start_time === oldStart && c.end_time === oldEnd && (c.end_plus || 0) === oldPlus) {
                        c.start_time = s.start_time;
                        c.end_time = s.end_time;
                        c.end_plus = s.end_plus || 0;
                    }
                });
            }
            return d;
        });

    // ---- live checks ----
    const issues = useMemo(() => {
        if (!draft) return [];
        const out = [];
        const seen = new Map();
        draft.sites.forEach((s) => {
            const place = placeById[s.place_id];
            if (!s.place_id) out.push({ level: 'block', text: 'A site row has no site chosen.' });
            if (!s.end_plus && s.end_time <= s.start_time) out.push({ level: 'block', text: `${place?.name || 'A site'}: the end is before the start — choose Night shift, or set the end date to the next day.` });
            if (place && !place.has_location) out.push({ level: 'warn', text: `${place.name} has no location set (no Directions for workers).` });
            if (!s.crew.length) out.push({ level: 'warn', text: `${place?.name || 'A site'} has nobody assigned.` });
            s.crew.forEach((c) => {
                const t = span(s, c);
                const list = seen.get(c.employee_id) || [];
                list.forEach((o) => {
                    if (overlaps(o.t, t)) out.push({ level: 'block', text: `${workerName(c.employee_id)} is at ${o.place} and ${place?.name} at the same time.` });
                });
                list.push({ t, place: place?.name });
                seen.set(c.employee_id, list);
                const leave = onLeave(c.employee_id);
                if (leave && !c.leave_override) out.push({ level: 'block', text: `${workerName(c.employee_id)} is on ${leave.type || 'approved'} leave.`, fix: { site: s.key, id: c.employee_id } });
            });
        });
        return out;
    }, [draft, placeById, workerName, onLeave]);
    const blocked = issues.some((i) => i.level === 'block');

    const assignedIds = useMemo(() => new Set((draft?.sites || []).flatMap((s) => s.crew.map((c) => c.employee_id))), [draft]);
    const status = statusOf(serverDay);

    const save = async () => {
        setBusy('save');
        setError('');
        try {
            const day = await deploymentApi.saveDay(selected, toPayload(draft), serverDay?.rev);
            setBoard((b) => ({ ...b, days: [...b.days.filter((d) => d.day !== selected), day] }));
            setDraft(fromServerDay(day));
            setEdited(false);
            return day;
        } catch (e) {
            setError(e.message);
            return null;
        } finally {
            setBusy('');
        }
    };

    const publish = async () => {
        let day = serverDay;
        if (edited || !day) {
            day = await save();
            if (!day) return;
        }
        const crew = day.sites.reduce((n, s) => n + s.crew.length, 0);
        const ok = await confirmAction({
            title: day.version ? 'Send the changes?' : `Publish ${dayLabel(selected)}?`,
            message: day.version
                ? 'Only workers whose deployment changed are notified.'
                : `${crew} worker${crew === 1 ? '' : 's'} will be notified now.`,
            confirmLabel: day.version ? 'Send changes' : 'Publish',
        });
        if (!ok) return;
        setBusy('publish');
        try {
            const res = await deploymentApi.publish(selected, day.rev);
            setNotice(`Sent — ${res.new} new, ${res.changed} changed, ${res.removed} cancelled.`);
            await load(weekStart, selected);
            setNotice(`Sent — ${res.new} new, ${res.changed} changed, ${res.removed} cancelled.`);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };

    const discard = async () => {
        const ok = await confirmAction({ title: 'Clear this day?', message: 'The draft for this day is removed.', confirmLabel: 'Clear', destructive: true });
        if (!ok) return;
        setBusy('discard');
        try {
            await deploymentApi.discardDay(selected);
            await load(weekStart, selected);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };

    const sendWeek = async () => {
        const pending = (board?.days || []).filter((d) => d.dirty && d.sites.length && d.day >= iso(new Date()));
        if (!pending.length) return;
        const ok = await confirmAction({
            title: `Send ${pending.length} day${pending.length === 1 ? '' : 's'}?`,
            message: pending.map((d) => dayLabel(d.day)).join(', '),
            confirmLabel: 'Send all',
        });
        if (!ok) return;
        setBusy('week');
        let total = { new: 0, changed: 0, removed: 0 };
        try {
            for (const d of pending) {
                const r = await deploymentApi.publish(d.day, d.rev);
                total = { new: total.new + r.new, changed: total.changed + r.changed, removed: total.removed + r.removed };
            }
            await load(weekStart, selected);
            setNotice(`Week sent — ${total.new} new, ${total.changed} changed, ${total.removed} cancelled.`);
        } catch (e) {
            setError(e.message);
            await load(weekStart, selected);
        } finally {
            setBusy('');
        }
    };

    if (!UNIFIED) {
        return (
            <HubPage title="Deployment" backTo={homePathFor(identity?.role)}>
                <Banner tone="warning">Deployment needs the one AKK Hub backend.</Banner>
            </HubPage>
        );
    }

    const weekDays = weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
    const weekPending = (board?.days || []).filter((d) => d.dirty && d.sites.length && d.day >= iso(new Date())).length;
    const pastDay = selected && selected < addDays(iso(new Date()), -1);

    return (
        <HubPage title="Deployment" backTo={homePathFor(identity?.role)}>
            {/* Week strip */}
            <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous week" className="g-btn g-btn--ghost !min-h-10 !px-2" onClick={() => goTo(addDays(weekStart, -7), addDays(weekStart, -7))}>
                    <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="grid flex-1 grid-cols-7 gap-1">
                    {weekDays.map((d) => {
                        const sd = daysById[d];
                        const st = statusOf(sd);
                        const count = sd ? sd.sites.reduce((n, s) => n + s.crew.length, 0) : 0;
                        return (
                            <button
                                key={d}
                                type="button"
                                onClick={() => goTo(d)}
                                aria-pressed={d === selected}
                                className={cn(
                                    'flex min-h-[64px] flex-col items-center justify-center rounded-xl border px-1 py-1.5 text-center transition-colors',
                                    d === selected ? 'border-[var(--g-brand)] bg-[var(--g-brand-soft)]' : 'border-[var(--g-hairline)] bg-white hover:bg-slate-50',
                                )}
                            >
                                <span className="text-[11px] font-semibold uppercase text-slate-500">{dayLabel(d, { weekday: 'short' })}</span>
                                <span className="text-base font-semibold tabular-nums text-slate-900">{dayLabel(d, { day: 'numeric' })}</span>
                                <span className={cn('mt-0.5 h-1.5 w-1.5 rounded-full', st.tone === 'sent' ? 'bg-emerald-500' : st.tone === 'none' ? 'bg-slate-200' : 'bg-amber-500')} />
                                {count ? <span className="text-[10px] text-slate-500">{count}</span> : null}
                            </button>
                        );
                    })}
                </div>
                <button type="button" aria-label="Next week" className="g-btn g-btn--ghost !min-h-10 !px-2" onClick={() => goTo(addDays(weekStart, 7), addDays(weekStart, 7))}>
                    <ChevronRight className="h-5 w-5" />
                </button>
            </div>
            {weekPending > 1 ? (
                <div className="mt-2 flex justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={sendWeek} disabled={Boolean(busy)}>
                        <Send className="h-3.5 w-3.5" /> Send all {weekPending} days with changes
                    </Button>
                </div>
            ) : null}

            {error ? <Banner tone="danger" className="mt-3">{error}</Banner> : null}
            {notice ? <Banner tone="success" className="mt-3">{notice}</Banner> : null}
            {!board && !error ? (
                <div className="mt-8 flex justify-center">
                    <Spinner />
                </div>
            ) : null}

            {board && draft && selected ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="min-w-0 space-y-3">
                        {/* Day header */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h2 className="text-xl font-semibold tracking-tight">{dayLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
                                <span className={cn('mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[status.tone])}>
                                    {edited ? 'Unsaved changes' : status.label}
                                    {serverDay?.published_at && !edited ? ` · v${serverDay.version}` : ''}
                                </span>
                            </div>
                            {!pastDay ? (
                                <div className="flex flex-wrap gap-2">
                                    <Button type="button" size="sm" variant="outline" onClick={() => setCopyOpen(true)} disabled={Boolean(busy)}>
                                        <Copy className="h-3.5 w-3.5" /> Copy / template
                                    </Button>
                                    {serverDay && !serverDay.version ? (
                                        <Button type="button" size="sm" variant="outline" onClick={discard} disabled={Boolean(busy)}>
                                            <Trash2 className="h-3.5 w-3.5" /> Clear
                                        </Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        {pastDay ? <Banner tone="info">Past days are read-only.</Banner> : null}

                        {issues.length ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm" role="status">
                                <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-900">
                                    <AlertTriangle className="h-4 w-4" /> Check before sending
                                </p>
                                <ul className="space-y-1">
                                    {issues.map((i, n) => (
                                        <li key={n} className={i.level === 'block' ? 'text-red-800' : 'text-amber-900'}>
                                            {i.text}
                                            {i.fix ? (
                                                <button
                                                    type="button"
                                                    className="ml-2 font-semibold underline-offset-2 hover:underline"
                                                    onClick={() =>
                                                        update((d) => {
                                                            const c = d.sites.find((x) => x.key === i.fix.site).crew.find((x) => x.employee_id === i.fix.id);
                                                            c.leave_override = true;
                                                            return d;
                                                        })
                                                    }
                                                >
                                                    Deploy anyway
                                                </button>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        {/* Sites */}
                        {draft.sites.map((s) => (
                            <SiteCard
                                key={s.key}
                                site={s}
                                places={places}
                                vehicles={board.vehicles}
                                workerName={workerName}
                                readOnly={pastDay}
                                day={selected}
                                onChange={(patch) => updateSite(s.key, patch)}
                                onRemove={() => update((d) => ({ ...d, sites: d.sites.filter((x) => x.key !== s.key) }))}
                                onAdd={() => setPicker(s.key)}
                                onCrew={(fn) =>
                                    update((d) => {
                                        const x = d.sites.find((y) => y.key === s.key);
                                        x.crew = fn(x.crew);
                                        if (x.team_lead && !x.crew.some((c) => c.employee_id === x.team_lead)) x.team_lead = '';
                                        if (x.driver_id && !x.crew.some((c) => c.employee_id === x.driver_id)) x.driver_id = '';
                                        return d;
                                    })
                                }
                            />
                        ))}

                        {!draft.sites.length ? (
                            <EmptyState icon={MapPin} title="Nothing planned for this day">
                                Add a site, or copy a day / template.
                            </EmptyState>
                        ) : null}

                        {!pastDay ? (
                            <Button type="button" variant="outline" className="w-full" onClick={() => update((d) => ({ ...d, sites: [...d.sites, emptySite()] }))}>
                                <Plus className="h-4 w-4" /> Add site
                            </Button>
                        ) : null}

                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">Notes for everyone this day</span>
                            <textarea
                                rows={2}
                                disabled={pastDay}
                                value={draft.notes}
                                onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))}
                                className="w-full rounded-lg border border-[var(--g-hairline)] bg-white p-2.5 text-sm"
                                placeholder="e.g. Toolbox meeting 7:45 at office"
                            />
                        </label>

                        {!pastDay ? (
                            <div className="sticky bottom-[calc(var(--g-tabbar-space,0px))] z-10 flex gap-2 rounded-2xl border border-[var(--g-hairline)] bg-white/95 p-2 shadow-[var(--g-shadow-2)] lg:bottom-3">
                                <Button type="button" variant="outline" className="flex-1" onClick={save} disabled={!edited || Boolean(busy)}>
                                    {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
                                </Button>
                                <Button
                                    type="button"
                                    className="flex-1"
                                    onClick={publish}
                                    disabled={blocked || Boolean(busy) || (!edited && !serverDay?.dirty) || !draft.sites.length}
                                >
                                    {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    {serverDay?.version ? 'Send changes' : 'Publish'}
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    {/* Desktop: who is free */}
                    <aside className="hidden lg:block">
                        <div className="sticky top-20 rounded-2xl border border-[var(--g-hairline)] bg-white p-3">
                            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                                <Users className="h-4 w-4" /> Not deployed ({workers.filter((w) => !assignedIds.has(w.employee_id)).length})
                            </p>
                            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto text-sm">
                                {workers
                                    .filter((w) => !assignedIds.has(w.employee_id))
                                    .map((w) => (
                                        <li key={w.employee_id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                                            <span className="min-w-0 truncate">
                                                {w.name} <span className="text-slate-400">{w.employee_id}</span>
                                            </span>
                                            {onLeave(w.employee_id) ? <span className="shrink-0 text-xs text-amber-700">leave</span> : null}
                                        </li>
                                    ))}
                            </ul>
                        </div>
                    </aside>
                </div>
            ) : null}

            <CrewPicker
                open={Boolean(picker)}
                site={draft?.sites.find((s) => s.key === picker)}
                sites={draft?.sites || []}
                places={placeById}
                workers={workers}
                onLeave={onLeave}
                onClose={() => setPicker(null)}
                onDone={(ids) => {
                    update((d) => {
                        const s = d.sites.find((x) => x.key === picker);
                        const have = new Set(s.crew.map((c) => c.employee_id));
                        ids.filter((id) => !have.has(id)).forEach((id) =>
                            s.crew.push({ employee_id: id, start_time: s.start_time, end_time: s.end_time, end_plus: s.end_plus || 0, leave_override: false }),
                        );
                        return d;
                    });
                    setPicker(null);
                }}
            />

            <CopyDialog
                open={copyOpen}
                day={selected}
                templates={board?.templates || []}
                hasPlan={Boolean(serverDay?.sites?.length)}
                onClose={() => setCopyOpen(false)}
                onDone={async (msg) => {
                    setCopyOpen(false);
                    await load(weekStart, selected);
                    if (msg) setNotice(msg);
                }}
            />
        </HubPage>
    );
}

function SiteCard({ site, places, vehicles, workerName, readOnly, day, onChange, onRemove, onAdd, onCrew }) {
    const [editing, setEditing] = useState(null);
    const night = (site.end_plus || 0) > 0;
    const endDate = addDays(day, site.end_plus || 0);
    const setShift = (kind) => {
        if (kind === 'night' && !night) onChange({ start_time: '20:00', end_time: '06:00', end_plus: 1 });
        if (kind === 'day' && night) onChange({ start_time: '08:00', end_time: '17:00', end_plus: 0 });
    };
    const setEndDate = (value) => {
        if (!value) return;
        const diff = Math.round((parseDay(value) - parseDay(day)) / 864e5);
        if (diff < 0 || diff > 2) {
            toast.error('A shift can end on the planned day, or up to 2 days after it.');
            return;
        }
        onChange({ end_plus: diff });
    };
    return (
        <section className="rounded-2xl border border-[var(--g-hairline)] bg-white p-3 sm:p-4">
            <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Site</span>
                    <select className={field} value={site.place_id} disabled={readOnly} onChange={(e) => onChange({ place_id: e.target.value })}>
                        <option value="">Choose a site…</option>
                        {places.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="w-[6.5rem]">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">From</span>
                    <input type="time" className={field} value={site.start_time} disabled={readOnly} onChange={(e) => onChange({ start_time: e.target.value })} />
                </label>
                <label className="w-[6.5rem]">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">To</span>
                    <input type="time" className={field} value={site.end_time} disabled={readOnly} onChange={(e) => onChange({ end_time: e.target.value })} />
                </label>
                {!readOnly ? (
                    <button type="button" onClick={onRemove} aria-label="Remove site" className="g-btn g-btn--ghost !min-h-10 !px-2 text-red-700">
                        <Trash2 className="h-4 w-4" />
                    </button>
                ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-3">
                <div role="radiogroup" aria-label="Shift type" className="inline-flex rounded-xl bg-slate-100 p-1">
                    {[
                        ['day', 'Day shift', Sun],
                        ['night', 'Night shift', Moon],
                    ].map(([k, l, Icon]) => (
                        <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={(k === 'night') === night}
                            disabled={readOnly}
                            onClick={() => setShift(k)}
                            className={cn('flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold', (k === 'night') === night ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600')}
                        >
                            <Icon className="h-4 w-4" /> {l}
                        </button>
                    ))}
                </div>
                <label className="w-[11rem]">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ends on</span>
                    <DateInput value={endDate} onChange={setEndDate} disabled={readOnly} inputClassName="!h-10 !rounded-lg !text-sm" aria-label="Shift end date" />
                </label>
                <p className="pb-2 text-xs text-slate-500">
                    {dayLabel(day)} {site.start_time} → {dayLabel(endDate)} {site.end_time}
                    {night ? ' · ends after midnight' : ''}
                </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
                {site.crew.map((c) => {
                    const custom = ownTimes(site, c);
                    return (
                        <span
                            key={c.employee_id}
                            className={cn(
                                'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-sm',
                                c.employee_id === site.team_lead ? 'border-[var(--g-brand)]/40 bg-[var(--g-brand-soft)]' : 'border-[var(--g-hairline)] bg-slate-50',
                            )}
                        >
                            {c.seen_at ? <Eye className="h-3.5 w-3.5 text-emerald-600" aria-label="Seen" /> : null}
                            <button type="button" className="truncate text-left" disabled={readOnly} onClick={() => setEditing(c.employee_id)}>
                                {workerName(c.employee_id)}
                                {custom ? <span className="ml-1 text-xs text-slate-500">{c.start_time}–{c.end_time}{(c.end_plus || 0) > 0 ? ` (+${c.end_plus})` : ''}</span> : null}
                                {c.employee_id === site.team_lead ? <span className="ml-1 text-xs font-semibold text-[var(--g-brand-text)]">lead</span> : null}
                                {c.employee_id === site.driver_id ? <Car className="ml-1 inline h-3.5 w-3.5" aria-label="driver" /> : null}
                            </button>
                            {!readOnly ? (
                                <button type="button" aria-label={`Remove ${workerName(c.employee_id)}`} onClick={() => onCrew((crew) => crew.filter((x) => x.employee_id !== c.employee_id))}>
                                    <X className="h-3.5 w-3.5 text-slate-500" />
                                </button>
                            ) : null}
                        </span>
                    );
                })}
                {!readOnly ? (
                    <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--g-brand)]/50 px-3 py-1 text-sm font-semibold text-[var(--g-brand-text)]">
                        <UserPlus className="h-3.5 w-3.5" /> Add workers
                    </button>
                ) : null}
            </div>

            {editing ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-2 text-sm">
                    <span className="w-full font-semibold">{workerName(editing)}: own times</span>
                    {['start_time', 'end_time'].map((k) => (
                        <input
                            key={k}
                            type="time"
                            className={cn(field, 'w-[6.5rem]')}
                            value={site.crew.find((c) => c.employee_id === editing)?.[k] || ''}
                            onChange={(e) => onCrew((crew) => crew.map((c) => (c.employee_id === editing ? { ...c, [k]: e.target.value } : c)))}
                        />
                    ))}
                    <select
                        className={cn(field, 'w-[9rem]')}
                        aria-label="Ends"
                        value={site.crew.find((c) => c.employee_id === editing)?.end_plus || 0}
                        onChange={(e) => onCrew((crew) => crew.map((c) => (c.employee_id === editing ? { ...c, end_plus: Number(e.target.value) } : c)))}
                    >
                        <option value={0}>Ends same day</option>
                        <option value={1}>Ends next day</option>
                        <option value={2}>Ends in 2 days</option>
                    </select>
                    <Button type="button" size="sm" variant="outline" onClick={() => onCrew((crew) => crew.map((c) => (c.employee_id === editing ? { ...c, start_time: site.start_time, end_time: site.end_time, end_plus: site.end_plus || 0 } : c)))}>
                        Same as site
                    </Button>
                    <Button type="button" size="sm" onClick={() => setEditing(null)}>
                        <Check className="h-3.5 w-3.5" /> Done
                    </Button>
                </div>
            ) : null}

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label>
                    <span className="mb-1 block text-xs text-slate-500">Team lead</span>
                    <select className={field} disabled={readOnly} value={site.team_lead} onChange={(e) => onChange({ team_lead: e.target.value })}>
                        <option value="">—</option>
                        {site.crew.map((c) => (
                            <option key={c.employee_id} value={c.employee_id}>
                                {workerName(c.employee_id)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span className="mb-1 block text-xs text-slate-500">Vehicle</span>
                    <select className={field} disabled={readOnly} value={site.vehicle_id} onChange={(e) => onChange({ vehicle_id: e.target.value })}>
                        <option value="">—</option>
                        {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                                {v.number}
                                {v.description ? ` · ${v.description}` : ''}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span className="mb-1 block text-xs text-slate-500">Driver</span>
                    <select className={field} disabled={readOnly || !site.vehicle_id} value={site.driver_id} onChange={(e) => onChange({ driver_id: e.target.value })}>
                        <option value="">—</option>
                        {site.crew.map((c) => (
                            <option key={c.employee_id} value={c.employee_id}>
                                {workerName(c.employee_id)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span className="mb-1 block text-xs text-slate-500">Job ref (LCB / Pole ID / JSR)</span>
                    <input className={field} disabled={readOnly} value={site.job_ref} onChange={(e) => onChange({ job_ref: e.target.value })} />
                </label>
                <label className="sm:col-span-2 lg:col-span-4">
                    <span className="mb-1 block text-xs text-slate-500">Notes for this site</span>
                    <input className={field} disabled={readOnly} value={site.notes} placeholder="e.g. Bring ladder · meet at gate B" onChange={(e) => onChange({ notes: e.target.value })} />
                </label>
            </div>
        </section>
    );
}

function CrewPicker({ open, site, sites, places, workers, onLeave, onClose, onDone }) {
    const [query, setQuery] = useState('');
    const [picked, setPicked] = useState([]);
    useEffect(() => {
        if (open) {
            setQuery('');
            setPicked([]);
        }
    }, [open]);
    if (!site) return null;
    const mine = { start: site.start_time, end: site.end_time, endPlus: site.end_plus || 0 };
    const elsewhere = (id) =>
        sites
            .filter((s) => s.key !== site.key)
            .flatMap((s) => s.crew.filter((c) => c.employee_id === id).map((c) => ({ place: places[s.place_id]?.name || 'another site', t: span(s, c) })));
    const inSite = new Set(site.crew.map((c) => c.employee_id));
    const q = query.trim().toLowerCase();
    const list = workers.filter((w) => !inSite.has(w.employee_id) && (!q || `${w.name} ${w.employee_id} ${w.designation || ''}`.toLowerCase().includes(q)));

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add workers</DialogTitle>
                    <DialogDescription>
                        {places[site.place_id]?.name || 'Site'} · {site.start_time}–{site.end_time}
                        {endSuffix(site.end_plus)}
                    </DialogDescription>
                </DialogHeader>
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or ID" className="h-11 w-full rounded-xl border border-[var(--g-hairline)] pl-9 pr-3 text-base sm:text-sm" />
                </div>
                <ul className="max-h-[50vh] divide-y divide-[var(--g-hairline)] overflow-y-auto rounded-xl border border-[var(--g-hairline)]">
                    {list.map((w) => {
                        const leave = onLeave(w.employee_id);
                        const other = elsewhere(w.employee_id);
                        const clash = other.some((o) => overlaps(o.t, mine));
                        const on = picked.includes(w.employee_id);
                        return (
                            <li key={w.employee_id}>
                                <label className={cn('flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2', clash && 'opacity-50')}>
                                    <input
                                        type="checkbox"
                                        className="h-5 w-5 accent-[var(--g-brand)]"
                                        checked={on}
                                        disabled={clash}
                                        onChange={() => setPicked((p) => (on ? p.filter((x) => x !== w.employee_id) : [...p, w.employee_id]))}
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{w.name}</span>
                                        <span className="block truncate text-xs text-slate-500">
                                            {w.employee_id}
                                            {w.designation ? ` · ${w.designation}` : ''}
                                            {other.length ? ` · also ${other.map((o) => `${o.place} ${o.t.start}–${o.t.end}${endSuffix(o.t.endPlus)}`).join(', ')}` : ''}
                                        </span>
                                    </span>
                                    {leave ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">On leave</span> : null}
                                    {clash ? <span className="shrink-0 text-xs text-red-700">time clash</span> : null}
                                </label>
                            </li>
                        );
                    })}
                    {!list.length ? <li className="p-4 text-center text-sm text-slate-500">No one matches.</li> : null}
                </ul>
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={() => onDone(picked)} disabled={!picked.length}>
                        Add {picked.length || ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CopyDialog({ open, day, templates, hasPlan, onClose, onDone }) {
    const [from, setFrom] = useState('');
    const [template, setTemplate] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (open && day) {
            setFrom(addDays(day, -1));
            setTemplate('');
            setName('');
            setError('');
        }
    }, [open, day]);
    const run = async (fn, msg) => {
        setBusy(true);
        setError('');
        try {
            await fn();
            await onDone(msg);
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Copy or template</DialogTitle>
                    <DialogDescription>Crew who are on leave or have left on {day ? dayLabel(day) : ''} are skipped when copying.</DialogDescription>
                </DialogHeader>
                {hasPlan ? <Banner tone="info">This day already has a plan. Clear it first to copy into it.</Banner> : null}
                <div className="space-y-2">
                    <p className="text-sm font-semibold">Copy another day</p>
                    <div className="flex gap-2">
                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
                        <Button type="button" variant="outline" disabled={busy || hasPlan || !from} onClick={() => run(() => deploymentApi.copyDay(from, day), `Copied from ${dayLabel(from)} (draft — check and publish).`)}>
                            <CalendarDays className="h-4 w-4" /> Copy
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    <p className="text-sm font-semibold">Use a template</p>
                    <div className="flex gap-2">
                        <select className={field} value={template} onChange={(e) => setTemplate(e.target.value)}>
                            <option value="">Choose…</option>
                            {templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                        <Button type="button" variant="outline" disabled={busy || hasPlan || !template} onClick={() => run(() => deploymentApi.applyTemplate(template, day), 'Template applied (draft — check and publish).')}>
                            Apply
                        </Button>
                        {template ? (
                            <Button type="button" variant="ghost" aria-label="Delete template" disabled={busy} onClick={() => run(() => deploymentApi.deleteTemplate(template), 'Template deleted.')}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        ) : null}
                    </div>
                </div>
                {hasPlan ? (
                    <div className="space-y-2">
                        <p className="text-sm font-semibold">Save this day as a template</p>
                        <div className="flex gap-2">
                            <input className={field} placeholder="e.g. Normal weekday" value={name} onChange={(e) => setName(e.target.value)} />
                            <Button type="button" variant="outline" disabled={busy || !name.trim()} onClick={() => run(() => deploymentApi.saveTemplate(name, day), `Saved template “${name.trim()}”.`)}>
                                Save
                            </Button>
                        </div>
                    </div>
                ) : null}
                {error ? <Banner tone="danger">{error}</Banner> : null}
            </DialogContent>
        </Dialog>
    );
}
