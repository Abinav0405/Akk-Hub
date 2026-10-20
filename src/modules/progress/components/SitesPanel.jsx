import { Fragment, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Pencil, Check, X, Trash2, Star } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/ui/dialog';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import { PortalPageHeader } from '@/ui/layout';
import { listAllSites, createSite, setSiteActive, updateSite, deleteSite } from '@/modules/progress/lib/sites';
import { SITE_OPTION_KINDS, addSiteOption, deleteSiteOption, groupSiteOptions, listSiteOptions, optionsForSite } from '@/modules/progress/lib/siteOptions';
import { DEFAULT_SECTION_LABEL } from '@/modules/progress/lib/sectionLabel';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { isNativeApp } from '@/core/platform';
import { cn } from '@/modules/progress/lib/utils';

/** All section names for a site: the default (sites.section_label) first, then the others. */
function siteSectionNames(site, optionGroups) {
    const main = site.section_label || DEFAULT_SECTION_LABEL;
    const extra = optionsForSite(optionGroups, site.id).section
        .map((o) => o.value)
        .filter((v) => v.toLowerCase() !== main.toLowerCase());
    return [main, ...extra];
}

/** Group "TR412C Internal Photos" under TR412C; otherwise under Other sites. */
function siteGroupKey(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length > 1 && /^[A-Za-z]{1,6}\d/i.test(parts[0])) return parts[0].toUpperCase();
    if (parts.length > 1 && /^[A-Z0-9._-]{3,}$/i.test(parts[0]) && /[0-9]/.test(parts[0])) {
        return parts[0].toUpperCase();
    }
    return 'Other sites';
}

function ActiveToggle({ active, disabled, onToggle }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            className="inline-flex items-center gap-2"
            aria-pressed={active}
        >
            <span
                className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
                    active ? 'bg-emerald-500' : 'bg-slate-300',
                    disabled && 'opacity-50'
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        active ? 'left-[1.375rem] -translate-x-full' : 'left-0.5'
                    )}
                />
            </span>
            <span className={cn('text-sm font-medium', active ? 'text-emerald-700' : 'text-slate-400')}>
                {active ? 'Active' : 'Hidden'}
            </span>
        </button>
    );
}

export default function SitesPanel({ embedded = false }) {
    const [sites, setSites] = useState(null);
    const [newName, setNewName] = useState('');
    const [newSection, setNewSection] = useState(DEFAULT_SECTION_LABEL);
    const [creating, setCreating] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState('');
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('active');
    const [optionGroups, setOptionGroups] = useState({});
    const [optionsOpenId, setOptionsOpenId] = useState(null);
    const native = isNativeApp();

    const filtered = useMemo(
        () =>
            (sites || []).filter((s) => {
                if (statusFilter === 'active' && !s.is_active) return false;
                if (statusFilter === 'hidden' && s.is_active) return false;
                return matchesQuery([s.name, ...siteSectionNames(s, optionGroups)], search);
            }),
        [sites, search, optionGroups, statusFilter]
    );
    const searchActive = Boolean(search.trim());

    const grouped = useMemo(() => {
        const map = new Map();
        filtered.forEach((s) => {
            const key = siteGroupKey(s.name);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(s);
        });
        return [...map.entries()].sort((a, b) => {
            if (a[0] === 'Other sites') return 1;
            if (b[0] === 'Other sites') return -1;
            return a[0].localeCompare(b[0]);
        });
    }, [filtered]);

    const refreshOptions = () => {
        listSiteOptions()
            .then((rows) => setOptionGroups(groupSiteOptions(rows)))
            .catch((e) => toast.error(e.message || 'Could not load site options'));
    };

    const refresh = () => {
        listAllSites().then(setSites).catch(() => {
            toast.error('Could not load sites');
            setSites([]);
        });
        refreshOptions();
    };

    useEffect(refresh, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        setCreating(true);
        try {
            await createSite(name, newSection);
            setNewName('');
            setNewSection(DEFAULT_SECTION_LABEL);
            setShowAdd(false);
            refresh();
        } catch (e2) {
            toast.error(e2.message || 'Could not add site');
        } finally {
            setCreating(false);
        }
    };

    const handleToggleActive = async (s) => {
        setBusy(true);
        try {
            await setSiteActive(s.id, !s.is_active);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update site'));
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (s) => {
        if (!window.confirm(`Delete site ${s.name}? Employees/technicians will not be able to pick it. Existing submissions stay in Packages.`)) {
            return;
        }
        setBusy(true);
        try {
            await deleteSite(s.id);
            toast.success(`Deleted ${s.name}`);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete site'));
        } finally {
            setBusy(false);
        }
    };

    const startEdit = (s) => {
        setEditingId(s.id);
        setEditingName(s.name);
    };

    const saveEdit = async (s) => {
        const name = editingName.trim();
        const section = s.section_label || DEFAULT_SECTION_LABEL;
        if (!name) {
            toast.error('Site name is required');
            return;
        }
        if (name === s.name) {
            setEditingId(null);
            return;
        }
        setBusy(true);
        try {
            await updateSite(s.id, name, section);
            setEditingId(null);
            refresh();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update site'));
        } finally {
            setBusy(false);
        }
    };

    const siteActions = (
        <>
            <Button
                type="button"
                variant="outline"
                className={cn('h-10 min-h-0', native && 'min-h-11')}
                onClick={() => {
                    document.getElementById('site-descriptions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
            >
                Descriptions &amp; street names
            </Button>
            <Button
                type="button"
                className={cn('h-10 min-h-0', native && 'min-h-11')}
                onClick={() => setShowAdd(true)}
            >
                <Plus className="mr-1.5 h-4 w-4" /> Add site
            </Button>
        </>
    );

    return (
        <div className="space-y-5">
            {embedded ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h3 className="text-base font-semibold text-slate-900">Sites</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Sites technicians pick when submitting photos. Section prefixes replace the default LCB label on packages.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">{siteActions}</div>
                </div>
            ) : (
                <PortalPageHeader
                    title="Sites"
                    description="Sites technicians pick when submitting photos. Section prefixes replace the default LCB label on packages."
                    actions={siteActions}
                />
            )}

            <div className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center">
                <SearchField
                    id="site-search"
                    value={search}
                    onChange={setSearch}
                    placeholder="Search site or section prefix"
                    native={native}
                    className="w-full sm:flex-1"
                />
                <select
                    aria-label="Filter sites by status"
                    className="h-10 rounded-lg border border-input bg-white px-3 text-sm text-slate-700 sm:w-40"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="active">Active sites</option>
                    <option value="hidden">Hidden sites</option>
                    <option value="all">All sites</option>
                </select>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-white">
                {sites === null ? (
                    <div className="flex items-center gap-2 px-4 py-10 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                ) : sites.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">No sites yet — add one to get started.</p>
                ) : filtered.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                        {searchActive ? 'No sites match this search.' : 'No sites in this filter.'}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[48rem] text-left text-sm">
                            <thead>
                                <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    <th className="py-2.5 pl-4 pr-3">Site</th>
                                    <th className="py-2.5 pr-3">Section prefixes</th>
                                    <th className="py-2.5 pr-3">Shown in app</th>
                                    <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {grouped.map(([group, list]) => (
                                    <Fragment key={group}>
                                        <tr className="bg-slate-50/90">
                                            <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-slate-700">
                                                {group}
                                                <span className="ml-1.5 font-normal text-muted-foreground">
                                                    · {list.length} site{list.length === 1 ? '' : 's'}
                                                </span>
                                            </td>
                                        </tr>
                                        {list.map((s) => {
                                            const sections = siteSectionNames(s, optionGroups);
                                            return (
                                                <Fragment key={s.id}>
                                                    <tr className="border-b border-border align-middle hover:bg-slate-50/60">
                                                        <td className="py-3 pl-4 pr-3">
                                                            {editingId === s.id ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <Input
                                                                        autoFocus
                                                                        value={editingName}
                                                                        onChange={(e) => setEditingName(e.target.value)}
                                                                        className="h-8 max-w-[220px]"
                                                                    />
                                                                    <Button size="sm" variant="outline" className="h-8 w-8 min-h-0 p-0" disabled={busy} aria-label="Save site" onClick={() => saveEdit(s)}>
                                                                        <Check className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button size="sm" variant="outline" className="h-8 w-8 min-h-0 p-0" aria-label="Cancel edit" onClick={() => setEditingId(null)}>
                                                                        <X className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            ) : (
                                                                <span className="font-medium text-slate-900">{s.name}</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 pr-3">
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                {sections.map((sec, i) => (
                                                                    <span
                                                                        key={`${s.id}-${sec}-${i}`}
                                                                        className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-white"
                                                                    >
                                                                        {sec}{i === 0 ? ' · default' : ''}
                                                                    </span>
                                                                ))}
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-slate-500 hover:text-slate-800"
                                                                    title="Manage section prefixes"
                                                                    aria-label="Add section prefix"
                                                                    onClick={() => setOptionsOpenId((id) => (id === s.id ? null : s.id))}
                                                                >
                                                                    <Plus className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 pr-3">
                                                            <ActiveToggle
                                                                active={Boolean(s.is_active)}
                                                                disabled={busy}
                                                                onToggle={() => handleToggleActive(s)}
                                                            />
                                                        </td>
                                                        <td className="py-3 pl-2 pr-4">
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 min-h-0 gap-1.5 px-2.5 text-xs"
                                                                    onClick={() => startEdit(s)}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                    Edit
                                                                </Button>
                                                                <MoreMenu
                                                                    items={[
                                                                        {
                                                                            label: optionsOpenId === s.id ? 'Hide section names' : 'Section names',
                                                                            onClick: () => setOptionsOpenId((id) => (id === s.id ? null : s.id)),
                                                                        },
                                                                        {
                                                                            label: 'Delete site',
                                                                            danger: true,
                                                                            disabled: busy,
                                                                            icon: <Trash2 className="h-4 w-4" />,
                                                                            onClick: () => handleDelete(s),
                                                                        },
                                                                    ]}
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {optionsOpenId === s.id ? (
                                                        <tr className="border-b border-border">
                                                            <td colSpan={4} className="bg-slate-50 px-4 py-3">
                                                                <SiteOptionsEditor
                                                                    site={s}
                                                                    groups={optionsForSite(optionGroups, s.id)}
                                                                    onChanged={refreshOptions}
                                                                    onSiteChanged={refresh}
                                                                />
                                                            </td>
                                                        </tr>
                                                    ) : null}
                                                </Fragment>
                                            );
                                        })}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Dialog open={showAdd} onOpenChange={(open) => !open && setShowAdd(false)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add site</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="new-site-name">Site name</Label>
                            <Input
                                id="new-site-name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g. Beach Road"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="new-site-section">Default section prefix</Label>
                            <Input
                                id="new-site-section"
                                value={newSection}
                                onChange={(e) => setNewSection(e.target.value)}
                                placeholder={DEFAULT_SECTION_LABEL}
                                required
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                            <Button type="submit" disabled={creating || !newName.trim() || !newSection.trim()}>
                                {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                                Add site
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** The three lists an employee/technician picks from for one site. */
function SiteOptionsEditor({ site, groups, onChanged, onSiteChanged }) {
    const [drafts, setDrafts] = useState({ section: '', description: '', street: '' });
    const [busyKind, setBusyKind] = useState('');
    const defaultSection = site.section_label || DEFAULT_SECTION_LABEL;
    // The default is stored on the site; the others in site_options. Shown as one list.
    const otherSections = (groups.section || []).filter((o) => o.value.toLowerCase() !== defaultSection.toLowerCase());

    const refreshAll = () => {
        onChanged();
        onSiteChanged?.();
    };

    /** Swap: `option` becomes the default, the old default joins the other names. */
    const makeDefault = async (option) => {
        setBusyKind('section');
        try {
            await updateSite(site.id, site.name, option.value);
            await addSiteOption(site.id, 'section', defaultSection);
            await deleteSiteOption(option.id);
            refreshAll();
        } catch (e) {
            toast.error(e.message || 'Could not change the default section name');
        } finally {
            setBusyKind('');
        }
    };

    /** Removing the default promotes the next name; a site always keeps one. */
    const removeDefault = async () => {
        const next = otherSections[0];
        if (!next) {
            toast.error('A site needs at least one section name — add another first.');
            return;
        }
        setBusyKind('section');
        try {
            await updateSite(site.id, site.name, next.value);
            await deleteSiteOption(next.id);
            refreshAll();
        } catch (e) {
            toast.error(e.message || 'Could not remove that');
        } finally {
            setBusyKind('');
        }
    };

    const add = async (kind) => {
        const value = String(drafts[kind] || '').trim();
        if (!value) return;
        if (kind === 'section' && value.toLowerCase() === defaultSection.toLowerCase()) {
            setDrafts((d) => ({ ...d, section: '' }));
            return;
        }
        setBusyKind(kind);
        try {
            await addSiteOption(site.id, kind, value);
            setDrafts((d) => ({ ...d, [kind]: '' }));
            onChanged();
        } catch (e) {
            toast.error(e.message || 'Could not add that');
        } finally {
            setBusyKind('');
        }
    };

    const remove = async (kind, option) => {
        setBusyKind(kind);
        try {
            await deleteSiteOption(option.id);
            onChanged();
        } catch (e) {
            toast.error(e.message || 'Could not remove that');
        } finally {
            setBusyKind('');
        }
    };

    return (
        <div className="grid gap-4 py-2">
            {SITE_OPTION_KINDS.map(({ kind, label, placeholder }) => {
                const list = kind === 'section' ? otherSections : (groups[kind] || []);
                return (
                    <div key={kind} className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
                        {kind === 'section' ? (
                            <p className="text-[11px] text-muted-foreground">
                                Employees/technicians pick one of these. The default is pre-selected — tap the star to make another the default.
                            </p>
                        ) : null}
                        <div className="flex flex-wrap gap-1.5">
                            {kind === 'section' ? (
                                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand/40 bg-brand-muted py-1 pl-2.5 pr-1 text-xs font-medium text-brand">
                                    <Star className="h-3 w-3 shrink-0 fill-current" aria-hidden />
                                    <span className="truncate">{defaultSection}</span>
                                    <span className="text-[10px] font-normal opacity-80">default</span>
                                    <button
                                        type="button"
                                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-red-50 hover:text-red-600"
                                        aria-label={`Remove ${defaultSection}`}
                                        disabled={busyKind === kind}
                                        onClick={removeDefault}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ) : null}
                            {list.length === 0 && kind !== 'section' ? (
                                <span className="text-xs text-muted-foreground">None yet.</span>
                            ) : list.map((option) => (
                                <span key={option.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-white py-1 pl-1 pr-1 text-xs">
                                    {kind === 'section' ? (
                                        <button
                                            type="button"
                                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                                            aria-label={`Make ${option.value} the default`}
                                            title="Make default"
                                            disabled={busyKind === kind}
                                            onClick={() => makeDefault(option)}
                                        >
                                            <Star className="h-3 w-3" />
                                        </button>
                                    ) : <span className="w-1.5" />}
                                    <span className="truncate">{option.value}</span>
                                    <button
                                        type="button"
                                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-red-50 hover:text-red-600"
                                        aria-label={`Remove ${option.value}`}
                                        disabled={busyKind === kind}
                                        onClick={() => remove(kind, option)}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <form
                            className="flex gap-1.5"
                            onSubmit={(e) => {
                                e.preventDefault();
                                add(kind);
                            }}
                        >
                            <Input
                                className="h-9"
                                value={drafts[kind]}
                                placeholder={placeholder}
                                onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
                            />
                            <Button type="submit" size="sm" disabled={busyKind === kind || !String(drafts[kind] || '').trim()}>
                                <Plus className="h-3.5 w-3.5" />
                            </Button>
                        </form>
                    </div>
                );
            })}
        </div>
    );
}
