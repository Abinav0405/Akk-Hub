/**
 * Admin → Sites: ONE list of places. Each place can be used by Attendance, Materials and/or Site
 * work; only the details each area needs are shown and edited. Backed by core.admin_list_places /
 * admin_save_place / admin_merge_places (one backend only).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Camera, Clock, GitMerge, MapPin, Pencil, Plus, Search, TriangleAlert } from 'lucide-react';
import { HubPage } from '@/ui/PortalShell';
import { Banner, EmptyState, Field, Heading, Spinner } from '@/ui/hub/primitives';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { paths } from '@/app/paths';

const ProgressSitesPanel = lazy(() => import('@/modules/progress/components/ProgressSitesPanel'));

const AREAS = [
    { key: 'attendance', label: 'Attendance', icon: Clock, hint: 'Clock in/out location and QR code' },
    { key: 'materials', label: 'Materials', icon: Boxes, hint: 'Shown in the material request site list' },
    { key: 'progress', label: 'Site work', icon: Camera, hint: 'Photo packages, JSR and section prefixes' },
];

const STOP = new Set(['and', 'the', 'of', 'at', 'site', 'sites', 'akk']);
const tokens = (name) =>
    String(name || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && !STOP.has(t));

/** Pairs of places that look like the same site (shared name words) and don't overlap in areas. */
function similarPairs(places) {
    const out = [];
    for (let i = 0; i < places.length; i += 1) {
        for (let j = i + 1; j < places.length; j += 1) {
            const a = places[i];
            const b = places[j];
            if (AREAS.some(({ key }) => a[key] && b[key])) continue;
            const ta = new Set(tokens(a.name));
            const tb = new Set(tokens(b.name));
            const shared = [...ta].filter((t) => tb.has(t)).length;
            if (shared >= 2 && shared >= Math.min(ta.size, tb.size) * 0.6) out.push([a, b]);
        }
    }
    return out;
}

function usage(place, key) {
    const a = place[key];
    if (!a) return null;
    if (key === 'attendance') return `${a.shifts} shifts`;
    if (key === 'materials') return `${a.requests} requests`;
    return `${a.packages} packages · ${a.jsrs} JSRs`;
}

function AreaChips({ place }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {AREAS.map(({ key, label, icon: Icon }) => {
                const on = Boolean(place[key]);
                const inactive = on && place[key].is_active === false;
                return (
                    <span
                        key={key}
                        title={on ? `${label}${inactive ? ' (inactive)' : ''}: ${usage(place, key)}` : `Not used in ${label}`}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                            on && !inactive
                                ? 'border-[var(--g-brand)]/25 bg-[var(--g-brand-soft)] text-[var(--g-brand-text)]'
                                : 'border-[var(--g-hairline)] bg-slate-50 text-[var(--g-faint)]'
                        }`}
                    >
                        <Icon className="h-3 w-3" aria-hidden />
                        {label}
                        {inactive ? ' · off' : ''}
                    </span>
                );
            })}
        </div>
    );
}

function Switch({ on, onChange, label, disabled }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!on)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--g-brand)]' : 'bg-slate-300'}`}
        >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
        </button>
    );
}

function toForm(place) {
    return {
        id: place?.id || null,
        name: place?.name || '',
        attendance: {
            on: Boolean(place?.attendance && place.attendance.is_active !== false),
            latitude: place?.attendance?.latitude ?? '',
            longitude: place?.attendance?.longitude ?? '',
            qr_token: place?.attendance?.qr_token ?? '',
        },
        materials: { on: Boolean(place?.materials && place.materials.is_active !== false) },
        progress: {
            on: Boolean(place?.progress && place.progress.is_active !== false),
            section_label: place?.progress?.section_label ?? '',
        },
    };
}

function EditDialog({ place, open, onClose, onSaved }) {
    const [form, setForm] = useState(() => toForm(place));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [prefixes, setPrefixes] = useState(false);

    useEffect(() => {
        if (open) {
            setForm(toForm(place));
            setError('');
        } else {
            setPrefixes(false);
        }
    }, [open, place]);

    const set = (area, patch) => setForm((f) => ({ ...f, [area]: { ...f[area], ...patch } }));
    const anyOn = AREAS.some(({ key }) => form[key].on);
    const turningOff = AREAS.filter(({ key }) => place?.[key] && !form[key].on);

    const save = async () => {
        setSaving(true);
        setError('');
        const { error: e } = await supabaseCore.rpc('admin_save_place', {
            p_id: form.id,
            p_name: form.name,
            p_areas: { attendance: form.attendance, materials: form.materials, progress: form.progress },
        });
        setSaving(false);
        if (e) setError(e.message || 'Could not save.');
        else onSaved();
    };

    return (
        <>
            <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
                <DialogContent className="max-w-xl overflow-x-hidden">
                    <DialogHeader>
                        <DialogTitle>{form.id ? 'Edit site' : 'Add site'}</DialogTitle>
                        <DialogDescription>One site, shared by every area that uses it.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[65vh] min-w-0 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
                        <Field id="site-name" label="Site name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                        {AREAS.map(({ key, label, icon: Icon, hint }) => (
                            <section key={key} className="min-w-0 rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface)] p-3">
                                <div className="flex items-center gap-3">
                                    <Icon className="h-4 w-4 shrink-0 text-[var(--g-brand)]" aria-hidden />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-[var(--g-ink)]">{label}</p>
                                        <p className="text-xs text-[var(--g-muted)]">{hint}</p>
                                    </div>
                                    <Switch on={form[key].on} onChange={(v) => set(key, { on: v })} label={`Used in ${label}`} />
                                </div>
                                {form[key].on && key === 'attendance' ? (
                                    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                                        <Field id="site-lat" label="Latitude" inputMode="decimal" value={form.attendance.latitude} onChange={(e) => set('attendance', { latitude: e.target.value })} />
                                        <Field id="site-lng" label="Longitude" inputMode="decimal" value={form.attendance.longitude} onChange={(e) => set('attendance', { longitude: e.target.value })} />
                                        <Field
                                            id="site-qr"
                                            label="QR code text"
                                            className="sm:col-span-2"
                                            hint={form.id && place?.attendance ? 'Changing it means reprinting the site QR.' : 'Leave empty to create one automatically.'}
                                            value={form.attendance.qr_token}
                                            onChange={(e) => set('attendance', { qr_token: e.target.value })}
                                        />
                                    </div>
                                ) : null}
                                {form[key].on && key === 'progress' ? (
                                    <div className="mt-3 flex min-w-0 flex-col gap-3">
                                        <Field id="site-label" label="Default section label" placeholder="LCB" value={form.progress.section_label} onChange={(e) => set('progress', { section_label: e.target.value })} />
                                        {place?.progress ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-auto min-h-10 w-full whitespace-normal border-[var(--g-brand)]/35 bg-[var(--g-brand-soft)] px-3 py-2.5 text-[var(--g-brand-text)] shadow-none hover:border-[var(--g-brand)]/50 hover:bg-[var(--g-brand-muted)] hover:text-[var(--g-brand-text)]"
                                                onClick={() => setPrefixes(true)}
                                            >
                                                Section prefixes &amp; street names
                                            </Button>
                                        ) : (
                                            <p className="text-xs text-[var(--g-muted)]">Save first to add section prefixes and street names.</p>
                                        )}
                                    </div>
                                ) : null}
                            </section>
                        ))}
                        {turningOff.length ? (
                            <Banner tone="info">
                                Turning off {turningOff.map((a) => a.label).join(', ')}: records already made there stay (history keeps this site&apos;s name); the site just stops
                                being offered for new entries.
                            </Banner>
                        ) : null}
                        {!anyOn && form.id ? <Banner tone="warning">Used nowhere — saving removes this site if it has no records.</Banner> : null}
                        {error ? <Banner tone="danger">{error}</Banner> : null}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={save} disabled={saving || !form.name.trim() || (!form.id && !anyOn)}>
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={prefixes} onOpenChange={setPrefixes}>
                <DialogContent className="max-w-4xl overflow-x-hidden">
                    <DialogHeader>
                        <DialogTitle>Section prefixes &amp; street names</DialogTitle>
                        <DialogDescription>Find {form.name || 'the site'} in the list to edit its prefixes and street names.</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[70vh] min-w-0 overflow-x-hidden overflow-y-auto">
                        <Suspense fallback={<Spinner />}>{prefixes ? <ProgressSitesPanel /> : null}</Suspense>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setPrefixes(false)}>
                            Done
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function MergeDialog({ place, places, seed, open, onClose, onSaved }) {
    const [other, setOther] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (open) {
            setOther(seed || '');
            setError('');
        }
    }, [open, seed]);
    const choices = places.filter((p) => p.id !== place?.id);
    const target = choices.find((p) => p.id === other);

    const merge = async () => {
        setSaving(true);
        setError('');
        const { error: e } = await supabaseCore.rpc('admin_merge_places', { p_keep: place.id, p_remove: other });
        setSaving(false);
        if (e) setError(e.message || 'Could not merge.');
        else onSaved();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Merge into “{place?.name}”</DialogTitle>
                    <DialogDescription>
                        Pick the duplicate. Everything recorded for it — shifts, requests, photo packages — moves to “{place?.name}”, and the duplicate disappears.
                        Where both have the same kind of details, “{place?.name}” keeps its own.
                    </DialogDescription>
                </DialogHeader>
                <label className="block text-sm font-medium" htmlFor="merge-other">
                    Duplicate site
                </label>
                <select id="merge-other" value={other} onChange={(e) => setOther(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-white px-3 text-base sm:text-sm">
                    <option value="">Choose a site…</option>
                    {choices.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </select>
                {target ? (
                    <div className="rounded-xl bg-slate-50 p-3 text-sm">
                        <p className="mb-1.5 font-semibold">{target.name} will be merged in:</p>
                        <AreaChips place={target} />
                    </div>
                ) : null}
                {error ? <Banner tone="danger">{error}</Banner> : null}
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={merge} disabled={!other || saving}>
                        {saving ? 'Merging…' : 'Merge sites'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default function SitesPage() {
    const [places, setPlaces] = useState(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState(null); // place | {} (new) | null
    const [merging, setMerging] = useState(null);
    const [mergeSeed, setMergeSeed] = useState(null);

    const load = useCallback(async () => {
        if (!UNIFIED) return;
        const { data, error: e } = await supabaseCore.rpc('admin_list_places');
        if (e) setError(e.message || 'Could not load sites.');
        else {
            setError('');
            setPlaces(data || []);
        }
    }, []);
    useEffect(() => {
        load();
    }, [load]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (places || []).filter((p) => !q || p.name.toLowerCase().includes(q));
    }, [places, query]);
    const pairs = useMemo(() => (places ? similarPairs(places) : []), [places]);

    const done = () => {
        setEditing(null);
        setMerging(null);
        setMergeSeed(null);
        load();
    };

    return (
        <HubPage title="Sites" backTo={paths.hubs.admin}>
            <Heading
                title="Sites"
                lede="One list for every place. Tick the areas that use a site; each area keeps only the details it needs."
                actions={
                    <Button type="button" onClick={() => setEditing({})} disabled={!places}>
                        <Plus className="h-4 w-4" aria-hidden /> Add site
                    </Button>
                }
            />
            {!UNIFIED ? <Banner tone="warning">Sites are merged only on the one-backend setup (set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</Banner> : null}
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {pairs.length ? (
                <Banner tone="warning" className="mt-3">
                    <p className="flex items-center gap-1.5 font-semibold">
                        <TriangleAlert className="h-4 w-4" aria-hidden /> These look like the same place
                    </p>
                    <ul className="mt-1 space-y-1">
                        {pairs.slice(0, 5).map(([a, b]) => (
                            <li key={a.id + b.id} className="flex flex-wrap items-center gap-2 text-sm">
                                <span>
                                    “{a.name}” and “{b.name}”
                                </span>
                                <button
                                    type="button"
                                    className="font-semibold text-[var(--g-brand-text)] underline-offset-2 hover:underline"
                                    onClick={() => {
                                        setMergeSeed(b.id);
                                        setMerging(a);
                                    }}
                                >
                                    Merge
                                </button>
                            </li>
                        ))}
                    </ul>
                </Banner>
            ) : null}

            <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--g-faint)]" aria-hidden />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search sites"
                    aria-label="Search sites"
                    className="h-11 w-full rounded-xl border border-input bg-white pl-9 pr-3 text-base sm:text-sm"
                />
            </div>

            {!places && !error ? (
                <div className="mt-6 flex justify-center">
                    <Spinner />
                </div>
            ) : null}
            {places && !shown.length ? <EmptyState icon={MapPin} title="No sites found" /> : null}

            <ul className="mt-4 divide-y divide-[var(--g-hairline)] overflow-hidden rounded-2xl border border-[var(--g-hairline)] bg-white">
                {shown.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-[var(--g-ink)]">{p.name}</p>
                            <p className="mt-0.5 text-xs text-[var(--g-muted)]">
                                {AREAS.map(({ key }) => usage(p, key)).filter(Boolean).join(' · ') || 'Not used yet'}
                                {p.attendance && p.attendance.latitude == null ? ' · no location set' : ''}
                            </p>
                        </div>
                        <AreaChips place={p} />
                        <div className="flex shrink-0 gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(p)}>
                                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setMerging(p)} aria-label={`Merge a duplicate into ${p.name}`}>
                                <GitMerge className="h-3.5 w-3.5" aria-hidden /> Merge
                            </Button>
                        </div>
                    </li>
                ))}
            </ul>

            <EditDialog place={editing && editing.id ? editing : null} open={Boolean(editing)} onClose={() => setEditing(null)} onSaved={done} />
            <MergeDialog
                seed={mergeSeed}
                place={merging}
                places={places || []}
                open={Boolean(merging)}
                onClose={() => {
                    setMerging(null);
                    setMergeSeed(null);
                }}
                onSaved={done}
            />
        </HubPage>
    );
}
