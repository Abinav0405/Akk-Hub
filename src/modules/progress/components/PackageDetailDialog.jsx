import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, CalendarDays, ChevronDown, GripVertical, ImagePlus, Loader2, Lock, MapPin, Pencil, Plus, Save, ShieldCheck, Trash2, UserRound, XCircle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/ui/select';
import { supabaseProgress } from '@/core/supabase'
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { STAGES, STAGE_LABELS, PHOTO_ASPECT_RATIO, PHOTO_CAPTURE_MAX_WIDTH, MAX_PHOTOS_PER_STAGE } from '@/modules/progress/lib/config';
import { formatDate } from '@/modules/progress/lib/dates';
import { captureFrameToCanvas, canvasToJpegBlob, loadImageFromFile, drawVerificationMark } from '@/modules/progress/lib/canvasOverlay';
import { generateVerificationCode } from '@/modules/progress/lib/verificationCode';
import { sha256Hex, dHashFromCanvas } from '@/modules/progress/lib/photoHash';
import { isLikelyImageFile } from '@/modules/progress/lib/loadImage';
import { getCompanyBranding } from '@/modules/progress/lib/branding';
import { buildPackageAutoTitle, DEFAULT_SECTION_LABEL, packageTitle, sectionIdFieldLabel } from '@/modules/progress/lib/sectionLabel';
import { cn } from '@/modules/progress/lib/utils';
import { groupSiteOptions, listSiteOptions, optionsForSite } from '@/modules/progress/lib/siteOptions';
import { listPackageSuggestions } from '@/modules/progress/lib/packageSuggestions';
import SuggestInput from '@/modules/progress/components/SuggestInput';
import { reviewAttribution } from '@/modules/progress/lib/reviewLabel';
import PhotoLightbox from '@/modules/progress/components/PhotoLightbox';
import SortablePhotoGrid from '@/modules/progress/components/SortablePhotoGrid';
import CompletionSlider from '@/modules/progress/components/CompletionSlider';
import PackageProgressBar from '@/modules/progress/components/PackageProgressBar';
import {
    getSignedUrl,
    updatePackageMetadata,
    uploadStaffPhoto,
    addStaffImages,
    deletePackageImage,
    reorderPackageImages,
    setPackageCompletion,
    updateImageCaption,
} from '@/modules/progress/lib/staffPackages';
import { getPackageImagesForViewer } from '@/modules/progress/lib/packageExport';
import { packageVerifyHref } from '@/modules/progress/lib/packagePhotoVerify';
import DocumentAuditTrail from '@/modules/progress/components/DocumentAuditTrail';

export default function PackageDetailDialog({
    pkg,
    isAdmin,
    // Admin always; a manager only when Admin granted "delete individual photos".
    canDeletePhotos = isAdmin,
    // Shown to a manager who has no delete button, so it is clear why.
    photoDeleteNote = null,
    sites,
    onClose,
    onChanged,
    readOnly = false,
    asExporter = false,
}) {
    const navigate = useNavigate();
    const fromPage = asExporter ? 'ExporterDashboard' : isAdmin ? 'AdminDashboard' : 'ManagerDashboard';
    const [images, setImages] = useState(null);
    const [urls, setUrls] = useState({});
    const [editing, setEditing] = useState(false);
    const [siteId, setSiteId] = useState(pkg.site?.id || '');
    const [lcbId, setLcbId] = useState(pkg.lcb_id || '');
    const [packageDate, setPackageDate] = useState(pkg.package_date || '');
    const [completionPct, setCompletionPct] = useState(pkg.completion_pct == null ? null : Number(pkg.completion_pct));
    const [description, setDescription] = useState(pkg.description || '');
    // Name parts: section name (e.g. LCB, Pole) and street name, picked or typed.
    const [sectionName, setSectionName] = useState(pkg.section_label || '');
    const [streetName, setStreetName] = useState(pkg.street_name || '');
    const [optionGroups, setOptionGroups] = useState({});
    const [streetSuggestions, setStreetSuggestions] = useState([]);
    const [busy, setBusy] = useState(false);
    const [previewId, setPreviewId] = useState(null);
    const fileInputs = useRef({});
    // Caps a signed-URL retry to once per image, so a genuinely offline network
    // can't retrigger onError -> getSignedUrl in a tight loop.
    const refreshedRef = useRef(new Set());
    // Photo order the user has dragged but not saved yet: stage -> image ids in that order.
    const [orderDraft, setOrderDraft] = useState({});
    const [savingOrder, setSavingOrder] = useState(false);

    const loadImages = () => {
        refreshedRef.current = new Set();
        getPackageImagesForViewer(pkg.id, { asExporter })
            .then(async (rows) => {
                setImages(rows);
                const entries = await Promise.all(
                    rows.map(async (r) => [r.id, await getSignedUrl(r.storage_path).catch(() => null)])
                );
                setUrls(Object.fromEntries(entries));
            })
            .catch(() => toast.error('Could not load images'));
    };

    const refreshUrl = async (img) => {
        if (refreshedRef.current.has(img.id)) return;
        refreshedRef.current.add(img.id);
        try {
            const fresh = await getSignedUrl(img.storage_path);
            setUrls((prev) => ({ ...prev, [img.id]: fresh }));
        } catch {
            /* ignore — thumbnail stays as-is until the next full reload */
        }
    };

    useEffect(() => {
        loadImages();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pkg.id, asExporter]);

    // What the server has, per stage.
    const serverByStage = useMemo(() => {
        const grouped = { before: [], during: [], after: [], completion: [] };
        (images || []).forEach((img) => grouped[img.stage]?.push(img));
        return grouped;
    }, [images]);

    // What is shown: the server order with any unsaved drag order laid over it. A photo the
    // draft doesn't know (just added) goes last; one it lists that is gone is ignored.
    const byStage = useMemo(() => {
        const grouped = {};
        Object.keys(serverByStage).forEach((stage) => {
            const server = serverByStage[stage];
            const draft = orderDraft[stage];
            if (!draft) {
                grouped[stage] = server;
                return;
            }
            const rank = new Map(draft.map((id, i) => [id, i]));
            grouped[stage] = server
                .map((img, i) => ({ img, key: rank.has(img.id) ? rank.get(img.id) : draft.length + i }))
                .sort((a, b) => a.key - b.key)
                .map((entry) => entry.img);
        });
        return grouped;
    }, [serverByStage, orderDraft]);

    const dirtyStages = STAGES.filter((stage) =>
        byStage[stage].some((img, i) => img.id !== serverByStage[stage][i]?.id)
    );

    const editingSite = sites.find((s) => s.id === siteId);

    useEffect(() => {
        if (!editing) return;
        listSiteOptions()
            .then((rows) => setOptionGroups(groupSiteOptions(rows)))
            .catch(() => setOptionGroups({}));
        listPackageSuggestions()
            .then((lists) => setStreetSuggestions(lists.street || []))
            .catch(() => setStreetSuggestions([]));
    }, [editing]);

    const siteOptions = optionsForSite(optionGroups, siteId);
    const siteDefaultSection = editingSite?.section_label || DEFAULT_SECTION_LABEL;
    const sectionSuggestions = [...new Set([siteDefaultSection, ...siteOptions.section.map((o) => o.value)])];

    const changeSite = (nextId) => {
        setSiteId(nextId);
        // Section names belong to a site; start the new one on its default.
        const next = sites.find((s) => s.id === nextId);
        if (nextId !== siteId) setSectionName(next?.section_label || DEFAULT_SECTION_LABEL);
    };

    const afterLocked = Boolean(pkg.has_after);
    const canAddStage = (stage) => {
        if (busy || byStage[stage].length >= MAX_PHOTOS_PER_STAGE) return false;
        if (afterLocked && (stage === 'before' || stage === 'during')) return false;
        return true;
    };

    const gallery = useMemo(
        () => STAGES.flatMap((stage) => byStage[stage] || []),
        [byStage]
    );

    const handleSaveMetadata = async () => {
        setBusy(true);
        try {
            const nextSection = sectionName.trim();
            const nextStreet = streetName.trim();
            await updatePackageMetadata(pkg.id, {
                siteId,
                lcbId,
                packageDate,
                description,
                // Only sent when changed, so an older database still saves the rest.
                sectionLabel: nextSection && nextSection !== (pkg.section_label || '') ? nextSection : null,
                streetName: nextStreet !== (pkg.street_name || '') ? nextStreet : null,
            });
            if (completionPct !== (pkg.completion_pct == null ? null : Number(pkg.completion_pct))) {
                await setPackageCompletion(pkg.id, completionPct);
            }
            toast.success('Package details updated');
            setEditing(false);
            onChanged();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not update details'));
        } finally {
            setBusy(false);
        }
    };

    const handleCaption = async (img, caption) => {
        const next = String(caption || '').trim();
        if (next === String(img.caption || '').trim()) return;
        try {
            await updateImageCaption(img.id, next, pkg.id);
            setImages((prev) => (prev || []).map((row) => (row.id === img.id ? { ...row, caption: next || null } : row)));
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not save caption'));
        }
    };

    // A drag finished: keep the new order as an unsaved draft. Nothing is sent to the
    // server until the user taps "Save changes".
    const reorderStage = (stage, nextImages) => {
        setOrderDraft((prev) => ({ ...prev, [stage]: nextImages.map((img) => img.id) }));
    };

    const discardPhotoOrder = () => setOrderDraft({});

    const savePhotoOrder = async () => {
        if (savingOrder || dirtyStages.length === 0) return;
        setSavingOrder(true);
        try {
            for (const stage of dirtyStages) {
                const next = byStage[stage];
                await reorderPackageImages(pkg.id, stage, next.map((img) => img.id));
                setImages((prev) => [
                    ...(prev || []).filter((img) => img.stage !== stage),
                    ...next.map((img, i) => ({ ...img, sort_order: i })),
                ]);
                setOrderDraft((prev) => {
                    const rest = { ...prev };
                    delete rest[stage];
                    return rest;
                });
            }
            toast.success('Photo order saved');
            onChanged();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not save the new photo order'));
            // The photo list may have changed underneath us; reload it. The unsaved order is kept.
            loadImages();
        } finally {
            setSavingOrder(false);
        }
    };

    // Closing with an unsaved order asks first. Returns whether the dialog closed.
    const requestClose = () => {
        if (dirtyStages.length > 0 && !window.confirm('You have unsaved photo order changes. Leave without saving?')) {
            return false;
        }
        onClose();
        return true;
    };

    const handleAddPhotos = async (stage, fileList) => {
        if (pkg.has_after && (stage === 'before' || stage === 'during')) {
            toast.error('Cannot add Before or During photos after After has been submitted');
            return;
        }
        const files = Array.from(fileList || []).filter((f) => isLikelyImageFile(f));
        if (files.length === 0) return;
        const room = MAX_PHOTOS_PER_STAGE - byStage[stage].length;
        if (room <= 0) {
            toast.error(`Maximum ${MAX_PHOTOS_PER_STAGE} photos per stage`);
            return;
        }
        const accepted = files.slice(0, room);
        if (files.length > accepted.length) {
            toast.error(`Only adding ${accepted.length} — maximum 12 photos per stage`);
        }
        setBusy(true);
        const items = [];
        try {
            for (const file of accepted) {
                const img = await loadImageFromFile(file);
                const canvas = await captureFrameToCanvas(img, PHOTO_ASPECT_RATIO, PHOTO_CAPTURE_MAX_WIDTH, null, false);
                const verificationCode = generateVerificationCode();
                const branding = await getCompanyBranding().catch(() => null);
                drawVerificationMark(canvas.getContext('2d'), canvas.width, canvas.height, verificationCode, branding);
                const blob = await canvasToJpegBlob(canvas);
                const sha256 = await sha256Hex(blob);
                const phash = dHashFromCanvas(canvas);
                const jpeg = new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, {
                    type: 'image/jpeg',
                });
                const storagePath = await uploadStaffPhoto(pkg.id, stage, jpeg);
                items.push({ storagePath, verificationCode, sha256, phash });
            }
            await addStaffImages(pkg.id, stage, items);
            toast.success(`Added ${accepted.length} photo${accepted.length === 1 ? '' : 's'} to ${STAGE_LABELS[stage]}`);
            loadImages();
            onChanged();
        } catch (e) {
            if (items.length) {
                await supabaseProgress.storage.from('progress-photos').remove(items.map((i) => i.storagePath)).catch(() => {});
            }
            toast.error(friendlyDbError(e, 'Upload failed'));
        } finally {
            setBusy(false);
        }
    };

    const removeImage = async (img) => {
        setBusy(true);
        try {
            await deletePackageImage(img.id, img.storage_path, pkg.id);
            setImages((prev) => prev.filter((i) => i.id !== img.id));
            onChanged();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not remove photo'));
            throw e;
        } finally {
            setBusy(false);
        }
    };

    const handleDeleteImage = async (img) => {
        if (!window.confirm('Remove this photo permanently?')) return;
        try {
            await removeImage(img);
        } catch {
            /* toasted in removeImage */
        }
    };

    const siteName = pkg.site?.name || pkg.site_name || 'Deleted site';
    const title = packageTitle(pkg) || siteName;
    const sectionLabelShown = pkg.section_label || DEFAULT_SECTION_LABEL;
    // What the title will read after saving — so it is clear what each field changes.
    const draftTitle = buildPackageAutoTitle({
        description,
        sectionLabel: sectionName.trim() || siteDefaultSection,
        lcbId,
        streetName,
        siteName: editingSite?.name || siteName,
    });
    const status = pkg.approval_status || 'pending';
    const statusClass = {
        pending: 'border-blue-200 bg-blue-50 text-blue-800',
        approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        declined: 'border-red-200 bg-red-50 text-red-700',
    }[status] || 'border-border bg-slate-50 text-slate-600';
    const reviewLine = !asExporter ? reviewAttribution(pkg) : null;

    const cancelEdit = () => {
        setSiteId(pkg.site?.id || '');
        setLcbId(pkg.lcb_id || '');
        setPackageDate(pkg.package_date || '');
        setDescription(pkg.description || '');
        setSectionName(pkg.section_label || '');
        setStreetName(pkg.street_name || '');
        setCompletionPct(pkg.completion_pct == null ? null : Number(pkg.completion_pct));
        setEditing(false);
    };

    return (
        <>
        <Dialog open modal={!previewId} onOpenChange={(open) => !open && !previewId && requestClose()}>
            <DialogContent
                className="max-w-3xl"
                onEscapeKeyDown={(e) => {
                    if (previewId) {
                        e.preventDefault();
                        setPreviewId(null);
                    }
                }}
            >
                {/* Header: what this package is */}
                <DialogHeader className="space-y-2 pr-8 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                        {pkg.display_id ? (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-600">{pkg.display_id}</span>
                        ) : null}
                        <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize', statusClass)}>{status}</span>
                        {!asExporter && pkg.approval_status === 'approved' && pkg.sent_to_export ? (
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                                Sent to export
                            </span>
                        ) : null}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                            {formatDate(pkg.package_date)}
                        </span>
                    </div>
                    <DialogTitle className="break-words text-lg leading-snug">{title}</DialogTitle>
                    <p className="flex items-center gap-1 text-sm text-slate-600">
                        <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0 break-words">{siteName}</span>
                    </p>
                </DialogHeader>

                <div className="space-y-5">
                    {pkg.approval_status === 'declined' && pkg.decline_reason ? (
                        <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            <div><span className="font-semibold">Declined:</span> {pkg.decline_reason}</div>
                        </div>
                    ) : null}

                    {/* Details — read, or edit in place */}
                    <section className="rounded-xl border border-border">
                        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                            <h3 className="text-sm font-semibold text-slate-900">{editing ? 'Edit details' : 'Details'}</h3>
                            {!readOnly && !editing ? (
                                <Button size="sm" variant="outline" className="h-8 min-h-0" onClick={() => setEditing(true)}>
                                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit details
                                </Button>
                            ) : null}
                        </div>

                        {editing ? (
                            <div className="space-y-5 p-4">
                                <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title will read</span>
                                    <p className="mt-0.5 break-words font-semibold text-slate-900">{draftTitle || '—'}</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">Made from the description, section and street name below.</p>
                                </div>

                                <fieldset className="space-y-3" disabled={busy}>
                                    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">What was done</legend>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="pkg-description">Description</Label>
                                        <Textarea
                                            id="pkg-description"
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                                            placeholder="e.g. Accident pole replacement"
                                            rows={2}
                                            maxLength={1000}
                                        />
                                        <p className="text-xs text-muted-foreground">The first line is used in the title.</p>
                                    </div>
                                </fieldset>

                                <fieldset className="space-y-3" disabled={busy}>
                                    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Where</legend>
                                    <div className="space-y-1.5">
                                        <Label>Site</Label>
                                        <Select value={siteId} onValueChange={changeSite}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {sites.map((s) => (
                                                    <SelectItem key={s.id} value={s.id}>
                                                        {s.name}{s.is_active === false ? ' (inactive)' : ''}
                                                    </SelectItem>
                                                ))}
                                                {siteId && !sites.some((s) => s.id === siteId) && (
                                                    <SelectItem value={siteId}>{siteName}</SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pkg-section-name">Section name</Label>
                                            <Input
                                                id="pkg-section-name"
                                                list="pkg-section-name-options"
                                                value={sectionName}
                                                onChange={(e) => setSectionName(e.target.value.slice(0, 200))}
                                                placeholder={siteDefaultSection}
                                            />
                                            <datalist id="pkg-section-name-options">
                                                {sectionSuggestions.map((value) => <option key={value} value={value} />)}
                                            </datalist>
                                            <p className="text-xs text-muted-foreground">e.g. LCB, Pole, Details</p>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pkg-section-id">{sectionIdFieldLabel(sectionName.trim() || siteDefaultSection)}</Label>
                                            <Input id="pkg-section-id" value={lcbId} onChange={(e) => setLcbId(e.target.value)} placeholder="e.g. 69 or LP 40" />
                                            <p className="text-xs text-muted-foreground">The number or details for that section.</p>
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="pkg-street-name">Street name</Label>
                                        <SuggestInput
                                            id="pkg-street-name"
                                            value={streetName}
                                            onChange={setStreetName}
                                            suggestions={streetSuggestions}
                                            placeholder="Optional — type to search"
                                            disabled={busy}
                                        />
                                    </div>
                                </fieldset>

                                <fieldset className="space-y-3" disabled={busy}>
                                    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">When &amp; progress</legend>
                                    <div className="space-y-1.5 sm:max-w-xs">
                                        <Label htmlFor="pkg-date">Date</Label>
                                        <Input id="pkg-date" type="date" lang="en-SG" value={packageDate} onChange={(e) => setPackageDate(e.target.value)} />
                                    </div>
                                    <CompletionSlider value={completionPct} onChange={setCompletionPct} disabled={busy} />
                                </fieldset>

                                <div className="sticky -bottom-6 -mx-4 -mb-4 flex gap-2 rounded-b-xl border-t border-border bg-white px-4 py-3 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.12)]">
                                    <Button onClick={handleSaveMetadata} disabled={busy} className="flex-1 sm:flex-none">
                                        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                                        Save details
                                    </Button>
                                    <Button variant="outline" onClick={cancelEdit} disabled={busy} className="flex-1 sm:flex-none">
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4 p-4">
                                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                                    <DetailItem label="Description" wide>
                                        {pkg.description ? <span className="whitespace-pre-wrap">{pkg.description}</span> : <Muted>Not set</Muted>}
                                    </DetailItem>
                                    <DetailItem label={sectionIdFieldLabel(sectionLabelShown)}>
                                        {pkg.lcb_id || <Muted>Not set</Muted>}
                                    </DetailItem>
                                    <DetailItem label="Street name">
                                        {pkg.street_name || <Muted>Not set</Muted>}
                                    </DetailItem>
                                    <DetailItem label="Site">{siteName}</DetailItem>
                                    <DetailItem label="Date">{formatDate(pkg.package_date)}</DetailItem>
                                    <DetailItem label="Employee / technician">
                                        <span className="inline-flex items-center gap-1">
                                            <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                                            {pkg.worker?.display_name || 'Deleted employee/technician'}
                                            {pkg.worker?.employee_code ? <span className="text-muted-foreground"> · {pkg.worker.employee_code}</span> : null}
                                        </span>
                                    </DetailItem>
                                    {reviewLine ? (
                                        <DetailItem label="Review">
                                            <span className="inline-flex items-center gap-1">
                                                {pkg.approval_status === 'declined'
                                                    ? <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden />
                                                    : <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />}
                                                {reviewLine}
                                            </span>
                                        </DetailItem>
                                    ) : null}
                                </dl>
                                <PackageProgressBar pkg={{ ...pkg, completion_pct: completionPct }} className="max-w-md" />
                            </div>
                        )}
                    </section>

                    {/* Photos */}
                    <section className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">Photos</h3>
                            {(pkg.has_before || pkg.has_during || pkg.has_after || pkg.has_completion) && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 min-h-0 border-brand/35 bg-brand-muted/50 text-brand hover:bg-brand-muted hover:text-brand"
                                    onClick={() => {
                                        if (!requestClose()) return;
                                        navigate(packageVerifyHref(pkg, fromPage));
                                    }}
                                >
                                    <ShieldCheck className="mr-1.5 h-4 w-4" /> Verify all photos
                                </Button>
                            )}
                        </div>
                        {!readOnly && (STAGES.some((s) => byStage[s].length > 1) || (photoDeleteNote && !canDeletePhotos && images?.length > 0)) ? (
                            <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                                {STAGES.some((s) => byStage[s].length > 1) ? (
                                    <p className="flex items-center gap-1.5">
                                        <GripVertical className="h-3.5 w-3.5 shrink-0" />
                                        Drag photos to reorder, then tap Save changes (on a phone, press and hold first). Tap a photo to view it.
                                    </p>
                                ) : null}
                                {photoDeleteNote && !canDeletePhotos && images?.length > 0 ? (
                                    <p className="flex items-center gap-1.5">
                                        <Trash2 className="h-3.5 w-3.5 shrink-0" />
                                        {photoDeleteNote}
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        {images === null ? (
                            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin" /> Loading photos…
                            </div>
                        ) : (
                            STAGES.map((stage) => {
                                const list = byStage[stage];
                                const locked = afterLocked && (stage === 'before' || stage === 'during');
                                const canAdd = !readOnly && !locked;
                                const addButton = (label, extra) => (
                                    <Button size="sm" variant="outline" disabled={!canAddStage(stage)} className={cn('h-8 min-h-0', extra)} asChild>
                                        <label className={canAddStage(stage) ? 'cursor-pointer' : 'cursor-not-allowed'}>
                                            <input
                                                ref={(el) => (fileInputs.current[stage] = el)}
                                                type="file"
                                                accept="image/*,.heic,.heif"
                                                multiple
                                                disabled={!canAddStage(stage)}
                                                className="sr-only"
                                                onChange={(e) => {
                                                    const files = Array.from(e.target.files || []);
                                                    e.target.value = '';
                                                    if (files.length) handleAddPhotos(stage, files);
                                                }}
                                            />
                                            <Plus className="mr-1.5 h-3.5 w-3.5" /> {label}
                                        </label>
                                    </Button>
                                );
                                return (
                                    <div key={stage} className="rounded-xl border border-border p-3">
                                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-sm font-semibold text-slate-900">{STAGE_LABELS[stage]}</h4>
                                                <span className={cn(
                                                    'rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                                                    list.length ? 'bg-brand-muted text-brand' : 'bg-slate-100 text-slate-500'
                                                )}>
                                                    {list.length} / {MAX_PHOTOS_PER_STAGE}
                                                </span>
                                            </div>
                                            {canAdd && list.length > 0 ? addButton('Add photos') : null}
                                            {!readOnly && locked ? (
                                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                                    <Lock className="h-3.5 w-3.5" aria-hidden /> Locked after After photos
                                                </span>
                                            ) : null}
                                        </div>
                                        {list.length === 0 ? (
                                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2">
                                                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <ImagePlus className="h-4 w-4 text-slate-400" aria-hidden />
                                                    No photos yet
                                                </p>
                                                {canAdd ? addButton('Add photos', 'bg-white') : null}
                                            </div>
                                        ) : (
                                            <SortablePhotoGrid
                                                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                                                items={list}
                                                disabled={readOnly || busy || savingOrder || list.length < 2}
                                                onReorder={(next) => reorderStage(stage, next)}
                                                renderItem={(img, _index, { handleProps }) => (
                                                    <>
                                                        <div
                                                            {...handleProps}
                                                            className="relative overflow-hidden rounded-lg border border-border bg-slate-100"
                                                            style={{ ...handleProps.style, aspectRatio: PHOTO_ASPECT_RATIO }}
                                                        >
                                                            {urls[img.id] ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setPreviewId(img.id)}
                                                                    className="h-full w-full cursor-zoom-in"
                                                                    aria-label={`Preview ${STAGE_LABELS[stage]} photo`}
                                                                >
                                                                    <img
                                                                        src={urls[img.id]}
                                                                        alt=""
                                                                        draggable={false}
                                                                        className="h-full w-full object-cover"
                                                                        loading="lazy"
                                                                        decoding="async"
                                                                        onError={() => refreshUrl(img)}
                                                                    />
                                                                </button>
                                                            ) : (
                                                                <div className="flex h-full items-center justify-center">
                                                                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                                                </div>
                                                            )}
                                                            {canDeletePhotos && !readOnly && (
                                                                <button
                                                                    type="button"
                                                                    data-no-drag
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteImage(img);
                                                                    }}
                                                                    disabled={busy}
                                                                    className="absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-red-600 shadow-md ring-1 ring-black/10 hover:bg-red-50 disabled:opacity-50"
                                                                    aria-label="Remove photo"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        {!readOnly ? (
                                                            <PhotoCaptionInput
                                                                value={img.caption}
                                                                disabled={busy}
                                                                onSave={(caption) => handleCaption(img, caption)}
                                                            />
                                                        ) : img.caption ? (
                                                            <p className="mt-1 truncate text-[11px] text-muted-foreground">{img.caption}</p>
                                                        ) : null}
                                                    </>
                                                )}
                                            />
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </section>

                    {!readOnly && dirtyStages.length > 0 && (
                        <div className="sticky -bottom-6 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-white p-3 shadow-lg">
                            <p className="text-sm font-medium text-slate-800">Photo order changed</p>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={discardPhotoOrder} disabled={savingOrder}>
                                    Discard
                                </Button>
                                <Button type="button" size="sm" onClick={savePhotoOrder} disabled={savingOrder}>
                                    {savingOrder ? (
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="mr-1.5 h-4 w-4" />
                                    )}
                                    Save changes
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* History — out of the way until needed */}
                    {!asExporter ? (
                        <details className="group rounded-xl border border-border">
                            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-semibold text-slate-900">
                                History
                                <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                            </summary>
                            <div className="border-t border-border px-4 pb-4">
                                <DocumentAuditTrail kind="package" documentId={pkg.id} />
                            </div>
                        </details>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
            {previewId && (
                <PhotoLightbox
                    gallery={gallery}
                    urls={urls}
                    previewId={previewId}
                    onClose={() => setPreviewId(null)}
                    onImageError={refreshUrl}
                    onRemove={canDeletePhotos && !readOnly ? removeImage : undefined}
                />
            )}
        </>
    );
}

function PhotoCaptionInput({ value, onSave, disabled }) {
    const [text, setText] = useState(value || '');
    useEffect(() => {
        setText(value || '');
    }, [value]);
    return (
        <Input
            value={text}
            maxLength={120}
            placeholder="Caption (optional)"
            disabled={disabled}
            className="mt-1 min-h-11 text-xs"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onSave(text)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                }
            }}
        />
    );
}

function DetailItem({ label, wide = false, children }) {
    return (
        <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words font-medium text-slate-900">{children}</dd>
        </div>
    );
}

function Muted({ children }) {
    return <span className="font-normal text-muted-foreground">{children}</span>;
}
