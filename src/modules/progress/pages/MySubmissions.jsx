import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Trash2, ShieldCheck, Camera, Save } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/ui/layout';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { WorkerNativeNav } from '@/modules/progress/components/MyAccountPanel';
import { cn } from '@/modules/progress/lib/utils';
import { formatDate } from '@/modules/progress/lib/dates';
import { packageHeading, DEFAULT_SECTION_LABEL } from '@/modules/progress/lib/sectionLabel';
import { reviewAttribution } from '@/modules/progress/lib/reviewLabel';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { listMyPackages, listActiveSites, getMyPackagesHeadTimestamp, deleteMyPackage, setMyPackageDetails, submitMyPackage } from '@/modules/progress/lib/packages';
import { Textarea } from '@/ui/textarea';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/ui/select';
import SuggestInput from '@/modules/progress/components/SuggestInput';
import { listPackageSuggestions } from '@/modules/progress/lib/packageSuggestions';
import { groupSiteOptions, listSiteOptions, optionsForSite } from '@/modules/progress/lib/siteOptions';
import { packageVerifyHref } from '@/modules/progress/lib/packagePhotoVerify';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import WorkerSubmissionPhotos from '@/modules/progress/components/WorkerSubmissionPhotos';
import PackageProgressBar from '@/modules/progress/components/PackageProgressBar';
import NotificationBell from '@/modules/progress/components/NotificationBell';
import { useHeartbeat } from '@/modules/progress/hooks/useHeartbeat';
import { useNotifications } from '@/modules/progress/hooks/useNotifications';
import { isNativeApp } from '@/core/platform';
import AuthChecking from '@/ui/AuthChecking';

const STATUS_STYLES = {
    pending: 'bg-amber-50 text-amber-800 border-amber-200',
    saved: 'bg-slate-100 text-slate-700 border-slate-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    declined: 'bg-red-50 text-red-700 border-red-200',
};

function StageBadge({ label, active }) {
    return (
        <span
            className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                active ? 'border-brand/40 bg-brand-muted text-brand' : 'border-border bg-slate-50 text-slate-400'
            )}
        >
            {label}
        </span>
    );
}

export default function MySubmissions() {
    const session = useRoleGuard('worker');
    const navigate = useNavigate();
    const native = isNativeApp();
    const [packages, setPackages] = useState(null);
    const [loadError, setLoadError] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [submittingId, setSubmittingId] = useState(null);
    const [suggestions, setSuggestions] = useState({ description: [], street: [] });
    const [optionGroups, setOptionGroups] = useState({});
    const [sites, setSites] = useState([]);
    const inbox = useNotifications(session ? 'worker' : null);
    const { markRead } = inbox;
    // Notification taps arrive as ?package=<id>: scroll to that package and flash it.
    const [searchParams, setSearchParams] = useSearchParams();
    const focusId = searchParams.get('package');
    useEffect(() => {
        if (!focusId || !packages?.length) return undefined;
        const el = document.getElementById(`pkg-${focusId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('g-focus-flash');
        }
        const t = window.setTimeout(() => {
            el?.classList.remove('g-focus-flash');
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('package');
                return next;
            }, { replace: true });
        }, 2200);
        return () => window.clearTimeout(t);
    }, [focusId, packages, setSearchParams]);

    const refresh = () => {
        listMyPackages()
            .then((rows) => {
                setLoadError(false);
                setPackages(rows);
            })
            .catch(() => {
                setPackages([]);
                setLoadError(true);
            });
    };

    useEffect(() => {
        if (!session) return;
        refresh();
        markRead().catch(() => {});
        listPackageSuggestions()
            .then(setSuggestions)
            .catch(() => setSuggestions({ description: [], street: [] }));
        listSiteOptions()
            .then((rows) => setOptionGroups(groupSiteOptions(rows)))
            .catch(() => setOptionGroups({}));
        listActiveSites()
            .then(setSites)
            .catch(() => setSites([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    // Picks up an approve/decline from staff (or a since-added stage) without a manual refresh.
    useHeartbeat({
        enabled: !!session,
        intervalMs: 5000,
        paused: !!deletingId || !!submittingId,
        queryFn: getMyPackagesHeadTimestamp,
        onChange: refresh,
    });

    const handleDelete = async (pkg) => {
        const label = packageHeading(pkg);
        if (!window.confirm(`Permanently delete this package (${label}) and all its photos? This cannot be undone.`)) {
            return;
        }
        setDeletingId(pkg.id);
        try {
            await deleteMyPackage(pkg.id);
            toast.success('Package deleted');
            setPackages((rows) => (rows || []).filter((row) => row.id !== pkg.id));
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not delete package'));
            refresh();
        } finally {
            setDeletingId(null);
        }
    };

    const handleSubmitToAdmin = async (pkg) => {
        setSubmittingId(pkg.id);
        try {
            await submitMyPackage(pkg.id);
            toast.success('Sent to Admin/Manager');
            setPackages((rows) =>
                (rows || []).map((row) =>
                    row.id === pkg.id
                        ? { ...row, submitted_to_staff: true, approval_status: 'pending', decline_reason: null }
                        : row
                )
            );
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not submit to Admin'));
            refresh();
        } finally {
            setSubmittingId(null);
        }
    };

    if (session === undefined) return <AuthChecking />;
    if (!session) return <AuthChecking />;

    return (
        <>
        <AppShell
            tabBar={native}
            header={
                <PageHeader
                    title="My Submissions"
                    backTo={"/progress/home"}
                    actions={<NotificationBell role="worker" inbox={inbox} />}
                />
            }
            maxWidth="4xl"
        >
            {packages === null ? (
                <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
            ) : loadError ? (
                <Card className="border-dashed py-16 text-center">
                    <p className="text-sm font-medium text-slate-900">Could not load submissions</p>
                    <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
                    <Button className="mt-5" variant="outline" onClick={refresh}>
                        Retry
                    </Button>
                </Card>
            ) : packages.length === 0 ? (
                <Card className="border-dashed py-16 text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-muted">
                        <Camera className="h-6 w-6 text-brand" />
                    </div>
                    <p className="text-sm font-medium text-slate-900">No submissions yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Take site photos, save with OK, then Submit to Admin.
                    </p>
                    <Button className="mt-5" onClick={() => navigate("/progress/submit")}>
                        Submit photos
                    </Button>
                </Card>
            ) : (
                <div className="space-y-3">
                    {packages.map((p) => {
                        const hasCompletion = Boolean(p.has_completion);
                        const sent = Boolean(p.submitted_to_staff);
                        const isDeclined = p.approval_status === 'declined';
                        const isApproved = p.approval_status === 'approved';
                        const isDraft = !sent && !isDeclined && !isApproved;
                        const isPendingStaff = sent && p.approval_status === 'pending';
                        const statusKey = isApproved ? 'approved' : isDeclined ? 'declined' : sent ? 'pending' : 'saved';
                        const canSubmit = hasCompletion && !isApproved && (isDraft || isDeclined);
                        const reviewLine = reviewAttribution(p);
                        return (
                            <Card
                                key={p.id}
                                id={`pkg-${p.id}`}
                                className={cn(
                                    'min-w-0 overflow-x-hidden p-4 shadow-xs',
                                    isDeclined && 'border-red-200',
                                    isDraft && !isDeclined && 'bg-status-incomplete/40 border-status-incomplete-border'
                                )}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="break-words font-semibold tracking-tight text-slate-900">
                                            {packageHeading(p)}
                                        </p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(p.package_date)}</p>
                                        {reviewLine && (
                                            <p className="mt-0.5 text-xs text-muted-foreground">{reviewLine}</p>
                                        )}
                                    </div>
                                    <span
                                        className={cn(
                                            'shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize',
                                            STATUS_STYLES[statusKey]
                                        )}
                                    >
                                        {statusKey}
                                    </span>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <StageBadge label="Before" active={p.has_before} />
                                    <StageBadge label="During" active={p.has_during} />
                                    <StageBadge label="After" active={p.has_after} />
                                    <StageBadge label="Completion" active={p.has_completion} />
                                </div>
                                <PackageProgressBar pkg={p} className="mt-3" />
                                <WorkerSubmissionPhotos
                                    packageId={p.id}
                                    canRemove={p.approval_status !== 'approved'}
                                    onChanged={refresh}
                                />
                                {isDraft && (
                                    <PackageNextStep
                                        native={native}
                                        hint={hasCompletion
                                            ? 'Saved here. Submit to Admin when it is ready.'
                                            : 'Take Completion photos and tap OK, then Submit to Admin.'}
                                        primary={canSubmit ? (
                                            <Button
                                                size={native ? 'default' : 'sm'}
                                                className="min-h-11 w-full min-w-0"
                                                disabled={submittingId === p.id}
                                                onClick={() => handleSubmitToAdmin(p)}
                                            >
                                                {submittingId === p.id ? (
                                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                                ) : null}
                                                Submit to Admin
                                            </Button>
                                        ) : (
                                            <StageButton
                                                native={native}
                                                primary
                                                onClick={() => navigate(`${"/progress/submit"}?continue=${p.id}&stage=completion`)}
                                            >
                                                Take Completion Photos
                                            </StageButton>
                                        )}
                                        moreLabel="Add or change photos"
                                        more={[
                                            { label: p.has_before ? 'Add more Before' : 'Add Before', stage: 'before' },
                                            { label: p.has_during ? 'Add more During' : 'Add During', stage: 'during' },
                                            { label: p.has_after ? 'Add more After' : 'Add After', stage: 'after' },
                                            ...(hasCompletion
                                                ? [{ label: 'Add more Completion', stage: 'completion' }]
                                                : []),
                                        ]}
                                        onStage={(stage) => navigate(`${"/progress/submit"}?continue=${p.id}&stage=${stage}`)}
                                    />
                                )}
                                {isPendingStaff && (
                                    <PackageNextStep
                                        native={native}
                                        hint="With Admin/Manager. You can still add Completion photos."
                                        primary={(
                                            <StageButton
                                                native={native}
                                                primary
                                                onClick={() => navigate(`${"/progress/submit"}?continue=${p.id}&stage=completion`)}
                                            >
                                                Add More Completion Photos
                                            </StageButton>
                                        )}
                                    />
                                )}
                                {isDeclined && (
                                    <PackageNextStep
                                        native={native}
                                        hint="OK saves replacement photos. Submit to Admin sends them again."
                                        notice={p.decline_reason}
                                        primary={canSubmit ? (
                                            <Button
                                                size={native ? 'default' : 'sm'}
                                                className="min-h-11 w-full min-w-0"
                                                disabled={submittingId === p.id}
                                                onClick={() => handleSubmitToAdmin(p)}
                                            >
                                                {submittingId === p.id ? (
                                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                                ) : null}
                                                Submit to Admin
                                            </Button>
                                        ) : (
                                            <StageButton
                                                native={native}
                                                primary
                                                onClick={() => navigate(`${"/progress/submit"}?resubmit=${p.id}&stage=completion`)}
                                            >
                                                {p.has_completion ? 'Add More Completion Photos' : 'Take Completion Photos'}
                                            </StageButton>
                                        )}
                                        moreLabel="Replace photos"
                                        more={[
                                            ...(p.has_before ? [{ label: 'Resubmit Before', stage: 'before' }] : []),
                                            ...(p.has_during ? [{ label: 'Resubmit During', stage: 'during' }] : []),
                                            ...(p.has_after ? [{ label: 'Resubmit After', stage: 'after' }] : []),
                                            ...(canSubmit
                                                ? [{
                                                    label: p.has_completion ? 'Add more Completion' : 'Take Completion Photos',
                                                    stage: 'completion',
                                                }]
                                                : []),
                                        ]}
                                        onStage={(stage) => navigate(`${"/progress/submit"}?resubmit=${p.id}&stage=${stage}`)}
                                    />
                                )}
                                {(isDraft || isDeclined) && (
                                    <PackageDetailsEditor
                                        pkg={p}
                                        native={native}
                                        suggestions={suggestions}
                                        optionGroups={optionGroups}
                                        sites={sites}
                                        onSaved={(next) => {
                                            setPackages((rows) =>
                                                (rows || []).map((row) => (row.id === p.id ? { ...row, ...next } : row))
                                            );
                                        }}
                                    />
                                )}
                                {!isDraft && !isDeclined && p.description && (
                                    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</span>
                                        <span className="mt-0.5 block">{p.description}</span>
                                    </p>
                                )}
                                <div className="mt-2 flex flex-col gap-1">
                                    {(p.has_before || p.has_during || p.has_after || p.has_completion) && (
                                        <Button
                                            size={native ? 'default' : 'sm'}
                                            variant="outline"
                                            className="min-h-11 w-full min-w-0 border-brand/35 bg-brand-muted/50 text-brand hover:bg-brand-muted hover:text-brand"
                                            onClick={() => navigate(packageVerifyHref(p, 'MySubmissions'))}
                                        >
                                            <ShieldCheck className="mr-1.5 h-4 w-4" />
                                            Verify photos
                                        </Button>
                                    )}
                                    {isDraft && (
                                        <Button
                                            size={native ? 'default' : 'sm'}
                                            variant="outline"
                                            className="min-h-11 w-full min-w-0 border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                                            disabled={deletingId === p.id}
                                            onClick={() => handleDelete(p)}
                                        >
                                            {deletingId === p.id ? (
                                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Trash2 className="mr-1.5 h-4 w-4" />
                                            )}
                                            Delete package
                                        </Button>
                                    )}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </AppShell>
        <WorkerNativeNav unread={inbox.unread} />
        </>
    );
}

function StageButton({ native, primary, onClick, children }) {
    return (
        <Button
            type="button"
            size={native ? 'default' : 'sm'}
            variant={primary ? undefined : 'outline'}
            className="min-h-11 w-full min-w-0"
            onClick={onClick}
        >
            {children}
        </Button>
    );
}

function PackageNextStep({ native, hint, notice, primary, moreLabel, more = [], onStage }) {
    return (
        <div className="mt-3 space-y-2">
            {notice ? (
                <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{notice}</p>
            ) : null}
            {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
            {primary}
            {more.length > 0 && (
                <details className="rounded-lg border border-border bg-slate-50 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium text-slate-600">
                        {moreLabel}
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                        {more.map((item) => (
                            <StageButton key={item.stage} native={native} onClick={() => onStage(item.stage)}>
                                {item.label}
                            </StageButton>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

function PackageDetailsEditor({ pkg, native, suggestions, optionGroups, sites, onSaved }) {
    const site = (sites || []).find((s) => s.id === pkg.site_id);
    const siteDefaultSection = site?.section_label || DEFAULT_SECTION_LABEL;
    const siteOptions = optionsForSite(optionGroups, pkg.site_id);
    const sectionChoices = [...new Set([
        pkg.section_label,
        siteDefaultSection,
        ...siteOptions.section.map((o) => o.value),
    ].filter(Boolean))];

    const [section, setSection] = useState(pkg.section_label || siteDefaultSection);
    const [street, setStreet] = useState(pkg.street_name || '');
    const [text, setText] = useState(pkg.description || '');
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setSection(pkg.section_label || siteDefaultSection);
        setStreet(pkg.street_name || '');
        setText(pkg.description || '');
    }, [pkg.id, pkg.description, pkg.street_name, pkg.section_label, siteDefaultSection]);

    const savedSection = String(pkg.section_label || siteDefaultSection).trim();
    const savedStreet = String(pkg.street_name || '').trim();
    const savedDesc = String(pkg.description || '').trim();
    const changed =
        section.trim() !== savedSection || street.trim() !== savedStreet || text.trim() !== savedDesc;

    const persist = async () => {
        if (!changed) {
            setOpen(false);
            return;
        }
        setSaving(true);
        try {
            const nextSection = section.trim() || siteDefaultSection;
            const nextStreet = street.trim();
            const nextDesc = text.trim();
            await setMyPackageDetails(pkg.id, {
                sectionLabel: nextSection,
                streetName: nextStreet,
                description: nextDesc,
            });
            onSaved?.({
                section_label: nextSection,
                street_name: nextStreet,
                description: nextDesc,
            });
            toast.success('Details saved');
            setOpen(false);
        } catch (e) {
            toast.error(friendlyDbError(e, '') || `Could not save details: ${e?.message || 'unknown error'}`);
        } finally {
            setSaving(false);
        }
    };

    const cancel = () => {
        setSection(pkg.section_label || siteDefaultSection);
        setStreet(pkg.street_name || '');
        setText(pkg.description || '');
        setOpen(false);
    };

    if (!open) {
        const summary = [pkg.section_label, pkg.street_name, pkg.description].filter(Boolean).join(' · ');
        return (
            <div className="mt-3">
                {summary ? (
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm text-slate-700">{summary}</p>
                ) : null}
                <button
                    type="button"
                    className="mt-1 min-h-11 text-left text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
                    onClick={() => setOpen(true)}
                >
                    {summary ? 'Edit street, section and description' : 'Add street, section and description'}
                </button>
            </div>
        );
    }

    return (
        <div className="mt-3 space-y-2">
            <div className="space-y-1.5">
                <Label htmlFor={`pkg-section-${pkg.id}`} className="text-xs">Section name</Label>
                {sectionChoices.length > 1 ? (
                    <Select value={sectionChoices.includes(section) ? section : siteDefaultSection} onValueChange={setSection} disabled={saving}>
                        <SelectTrigger id={`pkg-section-${pkg.id}`}>
                            <SelectValue placeholder="Choose a section name" />
                        </SelectTrigger>
                        <SelectContent>
                            {sectionChoices.map((value) => (
                                <SelectItem key={value} value={value}>{value}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <Input
                        id={`pkg-section-${pkg.id}`}
                        value={section}
                        maxLength={200}
                        disabled={saving}
                        onChange={(e) => setSection(e.target.value.slice(0, 200))}
                    />
                )}
            </div>
            <div className="space-y-1.5">
                <Label htmlFor={`pkg-street-${pkg.id}`} className="text-xs">Street name</Label>
                <SuggestInput
                    id={`pkg-street-${pkg.id}`}
                    value={street}
                    onChange={setStreet}
                    suggestions={suggestions?.street || []}
                    placeholder="Type the street, e.g. Phillip Street"
                    disabled={saving}
                    native={native}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor={`pkg-desc-${pkg.id}`} className="text-xs">
                    Package description (optional)
                </Label>
                <Textarea
                    id={`pkg-desc-${pkg.id}`}
                    value={text}
                    maxLength={1000}
                    rows={3}
                    placeholder="Work done, notes for Admin/Manager…"
                    disabled={saving}
                    onChange={(e) => setText(e.target.value.slice(0, 1000))}
                />
            </div>
            <div className="flex gap-2 pt-1">
                <Button type="button" size="sm" className="min-h-10 flex-1 sm:flex-none" disabled={saving || !changed} onClick={persist}>
                    {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                    {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" size="sm" variant="outline" className="min-h-10 flex-1 sm:flex-none" disabled={saving} onClick={cancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
