import { useEffect, useMemo, useRef, useState } from 'react';
import { storageKey } from '@/core/storage';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Camera, Loader2, Paperclip, X } from 'lucide-react';
import { AppShell, PageHeader } from '@/ui/layout';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/ui/select';
import { Card } from '@/ui/card';
import CameraCapture from '@/modules/progress/components/CameraCapture';
import SuccessTick from '@/modules/progress/components/SuccessTick';
import CompletionSlider from '@/modules/progress/components/CompletionSlider';
import { cn, routeSearchParams } from '@/modules/progress/lib/utils';
import { formatDate, todayIso } from '@/modules/progress/lib/dates';
import { useRoleGuard } from '@/ui/useRoleGuard';
import { STAGES, STAGE_LABELS, STAGE_PICKER_LABELS, FINAL_STAGE_LABEL, MAX_PHOTOS_PER_STAGE, PHOTO_ASPECT_RATIO, PHOTO_CAPTURE_MAX_WIDTH, isStandaloneStage } from '@/modules/progress/lib/config';
import { Textarea } from '@/ui/textarea';
import { captureFrameToCanvas, canvasToJpegBlob, loadImageFromFile, drawVerificationMark } from '@/modules/progress/lib/canvasOverlay';
import { generateVerificationCode } from '@/modules/progress/lib/verificationCode';
import { sha256Hex, dHashFromCanvas } from '@/modules/progress/lib/photoHash';
import { isLikelyImageFile } from '@/modules/progress/lib/loadImage';
import { getCompanyBranding } from '@/modules/progress/lib/branding';
import { pushNativeBackHandler } from '@/core/nativeShell';
import { isAuthError, friendlyDbError } from '@/modules/progress/lib/networkError';
import { clearWorkerSession } from '@/core/auth/progress/workerSession';
import AuthChecking from '@/ui/AuthChecking';
import { isNativeApp } from '@/core/platform';
import { WorkerNativeNav } from '@/modules/progress/components/MyAccountPanel';
import { useNotifications } from '@/modules/progress/hooks/useNotifications';
import {
    listActiveSites,
    listLinkablePackages,
    listMyPackages,
    createPackage,
    uploadPackagePhoto,
    addPackageImages,
    getMyPackageImages,
    removeUploadedPhotos,
    setMyPackageCompletion,
    setMyPackageDescription,
    setMyPackageDetails,
    submitMyPackage,
} from '@/modules/progress/lib/packages';
import { groupSiteOptions, listSiteOptions, optionsForSite } from '@/modules/progress/lib/siteOptions';
import { listPackageSuggestions } from '@/modules/progress/lib/packageSuggestions';
import SuggestInput from '@/modules/progress/components/SuggestInput';
import {
    sectionIdFieldLabel,
    DEFAULT_SECTION_LABEL,
    packageHeading,
} from '@/modules/progress/lib/sectionLabel';

/** Uploaded attachments have no live capture metadata — crop to the shared aspect
 *  ratio for a consistent grid, but skip the overlay (no real GPS/time to burn in). */
async function processUploadedFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => isLikelyImageFile(f));
    const results = [];
    for (const file of files) {
        try {
            const img = await loadImageFromFile(file);
            const canvas = await captureFrameToCanvas(img, PHOTO_ASPECT_RATIO, PHOTO_CAPTURE_MAX_WIDTH, null, false);
            const verificationCode = generateVerificationCode();
            const branding = await getCompanyBranding().catch(() => null);
            drawVerificationMark(canvas.getContext('2d'), canvas.width, canvas.height, verificationCode, branding);
            const blob = await canvasToJpegBlob(canvas);
            const [sha256, url] = await Promise.all([sha256Hex(blob), Promise.resolve(URL.createObjectURL(blob))]);
            const phash = dHashFromCanvas(canvas);
            results.push({ blob, url, capturedAt: new Date().toISOString(), lat: null, lng: null, accuracy: null, address: null, caption: '', uploaded: true, verificationCode, sha256, phash });
        } catch (e) {
            console.error('[SubmitProgress] could not process uploaded file:', file.name, e);
            toast.error(`Could not add ${file.name}`);
        }
    }
    return results;
}

export default function SubmitProgress() {
    const session = useRoleGuard('worker');
    const navigate = useNavigate();
    const native = isNativeApp();
    const inbox = useNotifications(session ? 'worker' : null);
    const [routerParams] = useSearchParams();
    const params = useMemo(() => routeSearchParams(routerParams), [routerParams]);

    const [step, setStep] = useState('details');
    const [stage, setStage] = useState('before');
    const [sites, setSites] = useState([]);
    const [siteId, setSiteId] = useState('');
    const [lcbId, setLcbId] = useState('');
    // Picked from the lists Admin configured for the site (Sites → Options).
    const [optionGroups, setOptionGroups] = useState({});
    const [sectionChoice, setSectionChoice] = useState('');
    const [streetName, setStreetName] = useState('');
    const [descriptionChoice, setDescriptionChoice] = useState('');
    // Shared description / street list: typed freely, matching entries offered as you type.
    const [suggestions, setSuggestions] = useState({ description: [], street: [] });
    const [packageDate, setPackageDate] = useState(todayIso());
    const [linkablePackages, setLinkablePackages] = useState([]);
    const [linkedPackageId, setLinkedPackageId] = useState('');
    const [loadingLinkable, setLoadingLinkable] = useState(false);
    const [photos, setPhotos] = useState([]);
    const photosRef = useRef(photos);
    photosRef.current = photos;
    const [resubmitId, setResubmitId] = useState('');
    const [presetPackageId, setPresetPackageId] = useState('');
    const [createdPackageId, setCreatedPackageId] = useState('');
    const [completionPct, setCompletionPct] = useState(null);
    const [packageDescription, setPackageDescription] = useState('');
    const [savedPackageId, setSavedPackageId] = useState('');
    const [hasSavedCompletion, setHasSavedCompletion] = useState(false);
    const [packageAlreadySent, setPackageAlreadySent] = useState(false);
    const [packageDeclined, setPackageDeclined] = useState(false);
    const [sendingToAdmin, setSendingToAdmin] = useState(false);
    const [cameraMode, setCameraMode] = useState('fresh');
    const [cameraKey, setCameraKey] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [savingDetails, setSavingDetails] = useState(false);
    const [myPackages, setMyPackages] = useState([]);
    const submittingRef = useRef(false);
    const uploadInputRef = useRef(null);

    const handleUploadFiles = async (fileList) => {
        const room = MAX_PHOTOS_PER_STAGE - photos.length;
        if (room <= 0) {
            toast.error(`Maximum ${MAX_PHOTOS_PER_STAGE} photos per stage`);
            return;
        }
        setUploading(true);
        try {
            const processed = await processUploadedFiles(fileList);
            if (processed.length === 0) return;
            const accepted = processed.slice(0, room);
            if (processed.length > accepted.length) {
                toast.error(`Only added ${accepted.length} — maximum ${MAX_PHOTOS_PER_STAGE} photos per stage`);
                processed.slice(room).forEach((p) => URL.revokeObjectURL(p.url));
            }
            setPhotos((prev) => [...prev, ...accepted]);
            setStep('review');
        } finally {
            setUploading(false);
        }
    };

    useEffect(() => {
        if (!session) return;
        let cancelled = false;
        // Parallel load — was four fire-and-forget calls; keep parallel + surface site errors clearly.
        Promise.all([
            listActiveSites().then((rows) => {
                if (!cancelled) setSites(rows || []);
            }),
            listSiteOptions()
                .then((rows) => {
                    if (!cancelled) setOptionGroups(groupSiteOptions(rows));
                })
                .catch(() => {
                    if (!cancelled) setOptionGroups({});
                }),
            listPackageSuggestions()
                .then((s) => {
                    if (!cancelled) setSuggestions(s);
                })
                .catch(() => {
                    if (!cancelled) setSuggestions({ description: [], street: [] });
                }),
            listMyPackages()
                .then((rows) => {
                    if (!cancelled) setMyPackages(rows || []);
                })
                .catch(() => {
                    if (!cancelled) setMyPackages([]);
                }),
        ]).catch((err) => {
            console.error('[SubmitProgress] sites/bootstrap failed', err);
            toast.error(friendlyDbError(err) || 'Could not load sites list');
        });
        return () => {
            cancelled = true;
        };
    }, [session]);

    useEffect(() => {
        if (!session) return;
        const resubmitPid = params.get('resubmit');
        const continuePid = params.get('continue');
        const pid = resubmitPid || continuePid;
        const requestedStage = params.get('stage');
        if (!pid) return;
        if (resubmitPid) setResubmitId(resubmitPid);
        else setPresetPackageId(continuePid);
        if (requestedStage && STAGES.includes(requestedStage)) setStage(requestedStage);
        listMyPackages()
            .then((rows) => {
                const pkg = rows.find((p) => p.id === pid);
                if (!pkg) {
                    toast.error('That package could not be found');
                    return;
                }
                if (
                    pkg.submitted_to_staff
                    && pkg.approval_status !== 'declined'
                    && (requestedStage === 'before' || requestedStage === 'during')
                ) {
                    toast.error('Cannot add Before or During photos after this package has been submitted');
                    navigate("/progress/submissions", { replace: true });
                    return;
                }
                setHasSavedCompletion(Boolean(pkg.has_completion));
                setPackageAlreadySent(Boolean(pkg.submitted_to_staff));
                setPackageDeclined(pkg.approval_status === 'declined');
                if (pkg.site_id) setSiteId(pkg.site_id);
                setLcbId(pkg.lcb_id || '');
                setSectionChoice(pkg.section_label || '');
                setStreetName(pkg.street_name || '');
                setDescriptionChoice(pkg.description || '');
                setPackageDate(pkg.package_date || todayIso());
                setLinkedPackageId(pid);
                setCompletionPct(pkg.completion_pct == null ? null : Number(pkg.completion_pct));
                setPackageDescription(pkg.description || '');
            })
            .catch(() => toast.error('Could not load that package'));
    }, [session, params]);

    useEffect(() => {
        if (!session || (isStandaloneStage(stage) && stage !== 'completion')) {
            if (!resubmitId) setLinkedPackageId('');
            return;
        }
        setLoadingLinkable(true);
        listLinkablePackages(stage)
            .then((rows) => {
                setLinkablePackages(rows);
                setLinkedPackageId((current) => {
                    const wanted = resubmitId || presetPackageId;
                    if (wanted && rows.some((p) => p.id === wanted)) return wanted;
                    if (current && rows.some((p) => p.id === current)) return current;
                    return '';
                });
            })
            .catch(() => toast.error('Could not load your pending packages'))
            .finally(() => setLoadingLinkable(false));
    }, [session, stage, resubmitId, presetPackageId]);

    useEffect(() => {
        if (params.get('resubmit') || params.get('continue')) return;
        try {
            const raw = sessionStorage.getItem(storageKey('progress', 'spt_draftPackage'));
            if (!raw) return;
            const d = JSON.parse(raw);
            if (!d?.packageId) return;
            setCreatedPackageId(d.packageId);
            if (d.siteId) setSiteId(d.siteId);
            if (d.lcbId) setLcbId(d.lcbId);
            if (d.sectionLabel) setSectionChoice(d.sectionLabel);
            if (d.streetName) setStreetName(d.streetName);
            if (d.description) setDescriptionChoice(d.description);
            if (d.packageDate) setPackageDate(d.packageDate);
            if (d.stage && STAGES.includes(d.stage)) setStage(d.stage);
        } catch {
            /* ignore */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (step !== 'review' && step !== 'submitting') return undefined;
        return pushNativeBackHandler(() => {
            if (step === 'submitting') return true;
            setStep('details');
            return true;
        });
    }, [step]);

    // Browser back while the camera is open should close it, not leave the page.
    useEffect(() => {
        if (step !== 'camera') return undefined;
        if (!window.history.state?.sptCamera) {
            window.history.pushState({ sptCamera: true }, '');
        }
        const onPop = () => {
            setStep(photosRef.current.length > 0 ? 'review' : 'details');
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [step]);

    if (session === undefined) return <AuthChecking />;
    if (!session) return <AuthChecking />;

    const linkedPackage = linkablePackages.find((p) => p.id === linkedPackageId);
    const selectedSite = sites.find((s) => s.id === siteId);
    const linkingExisting = stage === 'completion' && !!linkedPackageId && !resubmitId && !presetPackageId;
    const standalone = isStandaloneStage(stage) && !linkingExisting;
    const effectiveSiteName = standalone
        ? selectedSite?.name
        : linkedPackage?.site_name;
    const effectiveLcbId = standalone ? lcbId : linkedPackage?.lcb_id;
    const siteOptions = optionsForSite(optionGroups, siteId);
    const siteDefaultSection = selectedSite?.section_label || DEFAULT_SECTION_LABEL;
    const sectionChoices = [...new Set([siteDefaultSection, ...siteOptions.section.map((o) => o.value)].filter(Boolean))];
    const effectiveSectionLabel = sectionChoice
        || (standalone ? siteDefaultSection : (linkedPackage?.section_label || siteDefaultSection || DEFAULT_SECTION_LABEL));

    const canOpenCamera = standalone
        ? !!siteId && !!packageDate && !!lcbId.trim()
        : !!linkedPackage;

    const submitPackageId = savedPackageId || resubmitId || presetPackageId || linkedPackageId || createdPackageId;
    // Lock section / street / description only after Submit to Admin (or while still with staff).
    // Draft / declined packages stay editable so workers can fix details before (re)sending.
    const awaitingStaff = packageAlreadySent && !packageDeclined;
    const detailsLocked = awaitingStaff;
    const packageIdentityLocked = !!resubmitId || !!presetPackageId;
    const canSubmitToStaff = Boolean(submitPackageId && hasSavedCompletion && !awaitingStaff);
    const detailsPackageId = resubmitId || presetPackageId || savedPackageId || createdPackageId || linkedPackageId || '';
    const canSaveDraftDetails = Boolean(detailsPackageId && !detailsLocked);
    const showLinkedDraftDetails = !standalone && Boolean(detailsPackageId);

    const persistDraftDetails = async (packageId) => {
        if (!packageId || awaitingStaff) return;
        await setMyPackageDetails(packageId, {
            sectionLabel: effectiveSectionLabel,
            streetName: streetName || '',
            description: descriptionChoice || packageDescription || '',
        });
    };

    const handleSaveDraftDetails = async () => {
        if (!canSaveDraftDetails || savingDetails) return;
        setSavingDetails(true);
        try {
            await persistDraftDetails(detailsPackageId);
            toast.success('Details saved');
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not save details'));
        } finally {
            setSavingDetails(false);
        }
    };

    const applyLinkedPackage = (pkg) => {
        if (!pkg) return;
        setHasSavedCompletion(Boolean(pkg.has_completion));
        setPackageAlreadySent(Boolean(pkg.submitted_to_staff));
        setPackageDeclined(pkg.approval_status === 'declined');
        if (pkg.site_id) setSiteId(pkg.site_id);
        setLcbId(pkg.lcb_id || '');
        setSectionChoice(pkg.section_label || '');
        setStreetName(pkg.street_name || '');
        setDescriptionChoice(pkg.description || '');
        setPackageDate(pkg.package_date || todayIso());
        setCompletionPct(pkg.completion_pct == null ? null : Number(pkg.completion_pct));
        setPackageDescription(pkg.description || '');
    };

    const handleCameraDone = (capturedPhotos) => {
        setPhotos(capturedPhotos);
        setCameraMode('fresh');
        setStep('review');
        if (window.history.state?.sptCamera) {
            window.history.replaceState({}, '');
        }
    };

    const handleCameraCancel = () => {
        if (window.history.state?.sptCamera) {
            window.history.back();
            return;
        }
        setStep(photosRef.current.length > 0 ? 'review' : 'details');
    };

    const handleSavePhotos = async () => {
        if (submittingRef.current || photos.length === 0) return;
        submittingRef.current = true;
        setStep('submitting');
        const uploadedPaths = [];
        let packageId = standalone
            ? (resubmitId || presetPackageId || createdPackageId)
            : linkedPackageId;
        try {
            if (standalone && !packageId) {
                packageId = await createPackage({
                    siteId,
                    lcbId: lcbId.trim(),
                    packageDate,
                    kind: stage === 'completion' ? 'completion' : 'service',
                });
                setCreatedPackageId(packageId);
                try {
                    sessionStorage.setItem(storageKey('progress', 'spt_draftPackage'),
                        JSON.stringify({
                            packageId,
                            siteId,
                            lcbId: lcbId.trim(),
                            packageDate,
                            stage,
                            sectionLabel: effectiveSectionLabel,
                            streetName,
                            description: descriptionChoice,
                        })
                    );
                } catch {
                    /* ignore */
                }
            }
            if (!packageId) throw new Error('No package selected');

            // Persist section / street / description while still a draft (before Submit to Admin),
            // including after Before photos are already saved.
            if (!awaitingStaff) {
                try {
                    await persistDraftDetails(packageId);
                } catch (e) {
                    console.warn('[SubmitProgress] could not save section / street / description:', e);
                }
            }

            if (!standalone) {
                const rows = await listLinkablePackages(stage);
                if (!rows.some((p) => p.id === packageId)) {
                    throw new Error('That package is no longer available to link. Pick another.');
                }
            }

            const uploaded = [];
            for (let i = 0; i < photos.length; i++) {
                const p = photos[i];
                if (p.storagePath) {
                    uploaded.push({ storagePath: p.storagePath, capturedAt: p.capturedAt, lat: p.lat, lng: p.lng, accuracy: p.accuracy, address: p.address, caption: p.caption, verificationCode: p.verificationCode, sha256: p.sha256, phash: p.phash });
                    continue;
                }
                const storagePath = await uploadPackagePhoto({ packageId, stage, blob: p.blob, index: i });
                uploadedPaths.push(storagePath);
                p.storagePath = storagePath;
                uploaded.push({ storagePath, capturedAt: p.capturedAt, lat: p.lat, lng: p.lng, accuracy: p.accuracy, address: p.address, caption: p.caption, verificationCode: p.verificationCode, sha256: p.sha256, phash: p.phash });
            }

            // On a retry (e.g. the previous attempt's addPackageImages actually committed
            // server-side but the client only saw a dropped/timed-out response), don't
            // reattach photos that are already recorded against this package + stage.
            let toAttach = uploaded;
            try {
                const existing = await getMyPackageImages(packageId);
                const existingPaths = new Set(existing.map((row) => row.storage_path));
                toAttach = uploaded.filter((p) => !existingPaths.has(p.storagePath));
            } catch {
                /* if this check fails, fall through and attempt the attach as normal */
            }
            if (toAttach.length > 0) {
                await addPackageImages({ packageId, stage, photos: toAttach });
            }
            if (completionPct != null) {
                try {
                    await setMyPackageCompletion(packageId, completionPct);
                } catch (e) {
                    console.warn('[SubmitProgress] could not save completion %:', e);
                }
            }
            if (stage === 'completion') {
                try {
                    await setMyPackageDescription(packageId, packageDescription);
                } catch (e) {
                    console.warn('[SubmitProgress] could not save description:', e);
                }
            }

            photos.forEach((p) => URL.revokeObjectURL(p.url));
            setSavedPackageId(packageId);
            if (stage === 'completion') setHasSavedCompletion(true);
            setCreatedPackageId('');
            try {
                sessionStorage.removeItem(storageKey('progress', 'spt_draftPackage'));
            } catch {
                /* ignore */
            }
            setStep('success');
        } catch (e) {
            console.error('[SubmitProgress] submit failed:', e);
            if (isAuthError(e)) {
                clearWorkerSession({ expired: true });
                navigate("/connect/progress", { replace: true });
                return;
            }
            if (uploadedPaths.length > 0 && packageId) {
                // Only remove files we can confirm were never attached — if
                // addPackageImages actually committed server-side and only the
                // client lost the response, these paths are now legitimately
                // referenced by the package and must not be deleted.
                try {
                    const existing = await getMyPackageImages(packageId);
                    const existingPaths = new Set(existing.map((row) => row.storage_path));
                    const orphaned = uploadedPaths.filter((p) => !existingPaths.has(p));
                    if (orphaned.length) await removeUploadedPhotos(orphaned);
                } catch {
                    /* best-effort cleanup only — never let this mask the real submit error */
                }
            }
            toast.error(friendlyDbError(e, 'Could not save photos — please try again'));
            setStep('review');
        } finally {
            submittingRef.current = false;
        }
    };

    const handleSendToAdmin = async (packageId) => {
        const id = packageId || savedPackageId;
        if (!id || sendingToAdmin) return;
        setSendingToAdmin(true);
        try {
            await submitMyPackage(id);
            setPackageAlreadySent(true);
            setPackageDeclined(false);
            toast.success('Sent to Admin/Manager');
            navigate("/progress/submissions");
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not submit to Admin'));
        } finally {
            setSendingToAdmin(false);
        }
    };

    if (step === 'success') {
        const successCanSubmit = Boolean(savedPackageId && hasSavedCompletion && !awaitingStaff);
        const successCanAddMore = Boolean(savedPackageId && (!awaitingStaff || stage === 'completion'));
        let successDescription = `${STAGE_LABELS[stage]} photos saved. OK does not send this package.`;
        if (stage === 'completion') {
            if (awaitingStaff) {
                successDescription = `More ${FINAL_STAGE_LABEL} photos saved. Still with Admin/Manager.`;
            } else if (packageDeclined) {
                successDescription = `${FINAL_STAGE_LABEL} saved. Submit to Admin when you want it reviewed again.`;
            } else {
                successDescription = `${FINAL_STAGE_LABEL} saved. Submit to Admin when you are ready.`;
            }
        }
        return (
            <>
            <AppShell tabBar={native} header={<PageHeader title="Saved" backTo={"/progress/submit"} />} maxWidth="md">
                <SuccessTick
                    title="Photos saved"
                    description={successDescription}
                />
                <div className="mt-4 flex flex-col gap-2">
                    {successCanSubmit && (
                        <Button
                            className="w-full min-h-11"
                            disabled={sendingToAdmin}
                            onClick={() => handleSendToAdmin(savedPackageId)}
                        >
                            {sendingToAdmin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Submit to Admin
                        </Button>
                    )}
                    {successCanAddMore && (
                        <Button
                            variant={successCanSubmit ? 'outline' : undefined}
                            className="w-full min-h-11"
                            onClick={() => navigate(`${"/progress/submit"}?continue=${savedPackageId}&stage=${stage}`)}
                        >
                            Add more photos
                        </Button>
                    )}
                    {!successCanSubmit && !successCanAddMore && (
                        <Button
                            className="w-full min-h-11"
                            onClick={() => navigate("/progress/submit")}
                        >
                            Back to Portal
                        </Button>
                    )}
                    <div className="flex flex-col gap-2">
                        {(successCanSubmit || successCanAddMore) && (
                            <Button
                                variant="outline"
                                className="w-full min-h-11"
                                onClick={() => navigate("/progress/submit")}
                            >
                                Back to Portal
                            </Button>
                        )}
                        <Button variant="outline" className="w-full min-h-11 border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800" onClick={() => navigate("/progress/submissions")}>
                            View my submissions
                        </Button>
                    </div>
                </div>
            </AppShell>
            <WorkerNativeNav unread={inbox.unread} />
            </>
        );
    }

    return (
        <>
            {step === 'camera' ? (
                <CameraCapture
                    key={cameraKey}
                    lcbId={effectiveLcbId}
                    sectionLabel={effectiveSectionLabel}
                    siteName={effectiveSiteName}
                    stage={stage}
                    active
                    initialPhotos={cameraMode === 'add-more' ? photos : []}
                    onDone={handleCameraDone}
                    onCancel={handleCameraCancel}
                />
            ) : (
        <>
        <AppShell
            tabBar={native}
            header={
                <PageHeader
                    title="Submit site photos"
                    description={native && session.display_name ? `Signed in as ${session.display_name}` : undefined}
                    backTo={"/progress/submit"}
                />
            }
            maxWidth="lg"
        >
            <div className="space-y-6">
                {resubmitId && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        Declined. You can edit section, street and description. OK saves new photos. Submit to Admin sends them again.
                    </p>
                )}
                {presetPackageId && !resubmitId && awaitingStaff && (
                    <p className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-800">
                        With Admin/Manager — package details are locked. You can still add Completion photos.
                    </p>
                )}
                {presetPackageId && !resubmitId && !awaitingStaff && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        Draft — you can edit section, street and description before Submit to Admin. Site, section ID and date stay as set.
                    </p>
                )}

                <div className="space-y-2">
                    <Label>Stage</Label>
                    <div className={cn('grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-4', native && 'p-1.5')}>
                        {STAGES.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => {
                                    if (s === stage) return;
                                    photos.forEach((p) => URL.revokeObjectURL(p.url));
                                    setPhotos([]);
                                    setCreatedPackageId('');
                                    // Manually picking a different stage means this is no longer
                                    // the resubmit/continue flow that brought us here — clear it so
                                    // the banner and locked fields don't misattribute to this stage.
                                    setResubmitId('');
                                    setPresetPackageId('');
                                    setLinkedPackageId('');
                                    setSavedPackageId('');
                                    setHasSavedCompletion(false);
                                    setPackageAlreadySent(false);
                                    setPackageDeclined(false);
                                    setStage(s);
                                }}
                                className={`min-h-11 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors ${
                                    native ? 'min-h-12 text-[15px]' : ''
                                } ${
                                    stage === s
                                        ? 'bg-white text-slate-900 shadow-xs'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                {STAGE_PICKER_LABELS[s] || s}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {stage === 'completion'
                            ? `OK saves Completion. Submit to Admin sends the package. Up to ${MAX_PHOTOS_PER_STAGE} photos.`
                            : 'OK saves this stage. Submit to Admin after Completion.'}
                    </p>
                </div>

                {stage === 'completion' && (
                    <Card className="p-5 space-y-3">
                        <Label>Submit an existing package</Label>
                        {loadingLinkable ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading your packages…
                            </div>
                        ) : linkablePackages.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No draft packages waiting to be sent. Start a new {FINAL_STAGE_LABEL.toLowerCase()} below, or add Before photos first.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {linkablePackages.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                            const next = p.id === linkedPackageId ? '' : p.id;
                                            setLinkedPackageId(next);
                                            if (next) applyLinkedPackage(myPackages.find((row) => row.id === p.id) || p);
                                        }}
                                        className={`w-full rounded-xl border p-3 text-left text-sm transition-colors ${
                                            native ? 'min-h-[4.25rem] p-4 text-[15px]' : ''
                                        } ${
                                            linkedPackageId === p.id
                                                ? 'border-brand bg-brand-muted'
                                                : 'border-border bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <p className="font-medium text-slate-900">{packageHeading(p)}</p>
                                        <p className="text-xs text-muted-foreground">{formatDate(p.package_date)}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>
                )}

                {standalone ? (
                    <Card className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="site">Site / Location</Label>
                            <Select
                                value={siteId}
                                onValueChange={(v) => {
                                    setSiteId(v);
                                    setCreatedPackageId('');
                                    setSectionChoice('');
                                    setStreetName('');
                                    setDescriptionChoice('');
                                    if (stage === 'completion') setLcbId('');
                                }}
                                disabled={packageIdentityLocked && !!siteId}
                            >
                                <SelectTrigger id="site">
                                    <SelectValue placeholder="Choose a site" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sites.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {sites.length === 0 && (
                                <p className="text-xs text-amber-600">
                                    No sites configured yet — ask an admin to add one first.
                                </p>
                            )}
                            {!!resubmitId && !siteId && (
                                <p className="text-xs text-amber-600">
                                    The original site for this package is no longer available — pick a site to continue.
                                </p>
                            )}
                        </div>
                        {!!siteId && (
                            <div className="space-y-2">
                                <Label htmlFor="section-name">Section name</Label>
                                {sectionChoices.length > 1 ? (
                                    <Select
                                        value={sectionChoices.includes(effectiveSectionLabel) ? effectiveSectionLabel : siteDefaultSection}
                                        onValueChange={setSectionChoice}
                                        disabled={detailsLocked}
                                    >
                                        <SelectTrigger id="section-name">
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
                                        id="section-name"
                                        value={sectionChoice || siteDefaultSection}
                                        onChange={(e) => setSectionChoice(e.target.value.slice(0, 200))}
                                        placeholder={siteDefaultSection}
                                        disabled={detailsLocked}
                                    />
                                )}
                            </div>
                        )}
                        {(stage !== 'completion' || !!siteId) && (
                        <div className="space-y-2">
                            <Label htmlFor="lcbId">{sectionIdFieldLabel(effectiveSectionLabel)}</Label>
                            <Input
                                id="lcbId"
                                value={lcbId}
                                onChange={(e) => {
                                    setLcbId(e.target.value);
                                    setCreatedPackageId('');
                                }}
                                placeholder="e.g. 69"
                                disabled={packageIdentityLocked || (stage === 'completion' && !siteId)}
                            />
                        </div>
                        )}
                        {!!siteId && (
                            <div className="space-y-2">
                                <Label htmlFor="description-choice">Description</Label>
                                <SuggestInput
                                    id="description-choice"
                                    value={descriptionChoice}
                                    onChange={(v) => {
                                        setDescriptionChoice(v);
                                        setPackageDescription(v);
                                    }}
                                    suggestions={suggestions.description}
                                    placeholder="Type the work done, e.g. Accident pole replacement"
                                    disabled={detailsLocked}
                                    native={native}
                                />
                            </div>
                        )}
                        {!!siteId && (
                            <div className="space-y-2">
                                <Label htmlFor="street-name">Street name</Label>
                                <SuggestInput
                                    id="street-name"
                                    value={streetName}
                                    onChange={setStreetName}
                                    suggestions={suggestions.street}
                                    placeholder="Type the street, e.g. Phillip Street"
                                    disabled={detailsLocked}
                                    native={native}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Pick a match or type a new one. Photos still show their own GPS location.
                                </p>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="date">Date</Label>
                            <Input
                                id="date"
                                type="date"
                                lang="en-SG"
                                value={packageDate}
                                onChange={(e) => {
                                    setPackageDate(e.target.value);
                                    setCreatedPackageId('');
                                }}
                                disabled={packageIdentityLocked}
                            />
                        </div>
                        {canSaveDraftDetails && (
                            <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 w-full"
                                disabled={savingDetails}
                                onClick={handleSaveDraftDetails}
                            >
                                {savingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save details
                            </Button>
                        )}
                    </Card>
                ) : stage !== 'completion' ? (
                    <Card className="p-5 space-y-3">
                        <Label>Link to package</Label>
                        {loadingLinkable ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading your packages…
                            </div>
                        ) : linkablePackages.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No packages are waiting for a {STAGE_LABELS[stage]} submission yet. Submit a Before set first.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {linkablePackages.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                            setLinkedPackageId(p.id);
                                            applyLinkedPackage(myPackages.find((row) => row.id === p.id) || p);
                                        }}
                                        className={`w-full rounded-xl border p-3 text-left text-sm transition-colors ${
                                            native ? 'min-h-[4.25rem] p-4 text-[15px]' : ''
                                        } ${
                                            linkedPackageId === p.id
                                                ? 'border-brand bg-brand-muted'
                                                : 'border-border bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <p className="font-medium text-slate-900">{packageHeading(p)}</p>
                                        <p className="text-xs text-muted-foreground">{formatDate(p.package_date)}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>
                ) : null}

                {showLinkedDraftDetails && (
                    <Card className="p-5 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="linked-section-name">Section name</Label>
                            {sectionChoices.length > 1 ? (
                                <Select
                                    value={sectionChoices.includes(effectiveSectionLabel) ? effectiveSectionLabel : (sectionChoice || siteDefaultSection)}
                                    onValueChange={setSectionChoice}
                                    disabled={detailsLocked}
                                >
                                    <SelectTrigger id="linked-section-name">
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
                                    id="linked-section-name"
                                    value={sectionChoice || siteDefaultSection}
                                    onChange={(e) => setSectionChoice(e.target.value.slice(0, 200))}
                                    placeholder={siteDefaultSection}
                                    disabled={detailsLocked}
                                />
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="linked-description">Description</Label>
                            <SuggestInput
                                id="linked-description"
                                value={descriptionChoice}
                                onChange={(v) => {
                                    setDescriptionChoice(v);
                                    setPackageDescription(v);
                                }}
                                suggestions={suggestions.description}
                                placeholder="Type the work done, e.g. Accident pole replacement"
                                disabled={detailsLocked}
                                native={native}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="linked-street-name">Street name</Label>
                            <SuggestInput
                                id="linked-street-name"
                                value={streetName}
                                onChange={setStreetName}
                                suggestions={suggestions.street}
                                placeholder="Type the street, e.g. Phillip Street"
                                disabled={detailsLocked}
                                native={native}
                            />
                        </div>
                        {canSaveDraftDetails && (
                            <Button
                                type="button"
                                variant="outline"
                                className="min-h-11 w-full"
                                disabled={savingDetails}
                                onClick={handleSaveDraftDetails}
                            >
                                {savingDetails ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save details
                            </Button>
                        )}
                    </Card>
                )}

                <Card className="p-5">
                    <CompletionSlider value={completionPct} onChange={setCompletionPct} />
                </Card>

                {stage === 'completion' && !standalone && !showLinkedDraftDetails && (
                    <Card className="p-5 space-y-2">
                        <Label htmlFor="package-description">Package description (optional)</Label>
                        <Textarea
                            id="package-description"
                            value={packageDescription}
                            onChange={(e) => setPackageDescription(e.target.value.slice(0, 1000))}
                            placeholder="Work done, notes for Admin/Manager…"
                            rows={3}
                            maxLength={1000}
                        />
                        <p className="text-xs text-muted-foreground">
                            Optional. Saved with OK.
                        </p>
                    </Card>
                )}

                <div className="flex flex-col gap-2">
                    <Button
                        size="lg"
                        className={native ? 'h-14 w-full rounded-2xl text-[16px]' : 'w-full'}
                        disabled={!canOpenCamera}
                        onClick={() => {
                            if (photos.length > 0) {
                                setStep('review');
                                return;
                            }
                            setCameraMode('fresh');
                            setStep('camera');
                        }}
                    >
                        <Camera className="mr-2 h-5 w-5" />
                        {photos.length > 0 ? 'Review photos' : 'Capture Images'}
                    </Button>
                    <Button
                        variant="outline"
                        className="min-h-11 w-full border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800"
                        disabled={!canOpenCamera || uploading}
                        asChild
                    >
                        <label>
                            <input
                                ref={uploadInputRef}
                                type="file"
                                accept="image/*,.heic,.heif"
                                multiple
                                disabled={!canOpenCamera || uploading}
                                className="sr-only"
                                onChange={(e) => {
                                    const files = Array.from(e.target.files || []);
                                    e.target.value = '';
                                    if (files.length) handleUploadFiles(files);
                                }}
                            />
                            {uploading ? (
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            ) : (
                                <Paperclip className="mr-2 h-5 w-5" />
                            )}
                            Upload Attachment
                        </label>
                    </Button>
                </div>
                <p className="-mt-3 text-xs text-muted-foreground">
                    On site, use Capture so location and time are on the photo.
                </p>

                {canSubmitToStaff && (
                    <div className="space-y-2">
                        <Button
                            size="lg"
                            className={native ? 'h-14 w-full rounded-2xl text-[16px]' : 'w-full'}
                            disabled={sendingToAdmin}
                            onClick={() => handleSendToAdmin(submitPackageId)}
                        >
                            {sendingToAdmin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Submit to Admin
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            Completion is saved. This sends the package. OK only saves.
                        </p>
                    </div>
                )}
            </div>

            {step === 'review' && (
                <ReviewSheet
                    photos={photos}
                    onRemove={(i) => {
                        setPhotos((prev) => {
                            const removed = prev[i];
                            if (removed) URL.revokeObjectURL(removed.url);
                            return prev.filter((_, idx) => idx !== i);
                        });
                    }}
                    onRetakeAll={() => {
                        photos.forEach((p) => URL.revokeObjectURL(p.url));
                        setPhotos([]);
                        setCameraMode('fresh');
                        setCameraKey((k) => k + 1);
                        setStep('camera');
                    }}
                    onAddMore={() => {
                        if (photos.length >= MAX_PHOTOS_PER_STAGE) {
                            toast.error(`Maximum ${MAX_PHOTOS_PER_STAGE} photos per stage`);
                            return;
                        }
                        setCameraMode('add-more');
                        setCameraKey((k) => k + 1);
                        setStep('camera');
                    }}
                    onUploadMore={() => {
                        if (photos.length >= MAX_PHOTOS_PER_STAGE) {
                            toast.error(`Maximum ${MAX_PHOTOS_PER_STAGE} photos per stage`);
                            return;
                        }
                        uploadInputRef.current?.click();
                    }}
                    onCaption={(i, caption) => {
                        setPhotos((prev) => prev.map((p, idx) => (idx === i ? { ...p, caption } : p)));
                    }}
                    uploading={uploading}
                    onConfirm={handleSavePhotos}
                    onClose={() => setStep('details')}
                    isFinal={stage === 'completion'}
                    description={packageDescription}
                    onDescription={setPackageDescription}
                />
            )}

            {step === 'submitting' && (
                <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white/90">
                    <Loader2 className="h-8 w-8 animate-spin text-brand" />
                    <p className="text-sm text-slate-600">Uploading photos…</p>
                </div>
            )}
        </AppShell>
        <WorkerNativeNav unread={inbox.unread} />
        </>
            )}
        </>
    );
}

function ReviewSheet({ photos, onRemove, onRetakeAll, onAddMore, onUploadMore, onCaption, uploading, onConfirm, onClose, isFinal, description, onDescription }) {
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 pt-safe-header">
                <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100">
                    <X className="h-5 w-5" />
                </button>
                <div className="text-center">
                    <p className="text-sm font-semibold">Confirm photos</p>
                    <p className="text-[11px] text-muted-foreground">{photos.length} of {MAX_PHOTOS_PER_STAGE}</p>
                </div>
                <span className="w-9" />
            </div>

            <div className="flex-1 overflow-y-auto akk-scroll-y p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((p, i) => (
                        <div key={p.url} className="min-w-0 max-w-full space-y-1.5">
                            <div
                                className="relative overflow-hidden rounded-xl border border-border"
                                style={{ aspectRatio: PHOTO_ASPECT_RATIO }}
                            >
                                <img src={p.url} alt="" className="h-full w-full object-cover" />
                                {p.uploaded && (
                                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                                        Attachment
                                    </span>
                                )}
                                <button
                                    onClick={() => onRemove(i)}
                                    aria-label="Remove photo"
                                    className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <Input
                                value={p.caption || ''}
                                onChange={(e) => onCaption?.(i, e.target.value.slice(0, 200))}
                                placeholder="Caption (optional)"
                                className="h-11 min-h-11 w-full min-w-0 max-w-full text-xs"
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-3 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
                {isFinal && (
                    <div className="space-y-1.5">
                        <Label htmlFor="final-package-description">Package description (optional)</Label>
                        <Textarea
                            id="final-package-description"
                            value={description || ''}
                            onChange={(e) => onDescription?.(e.target.value.slice(0, 1000))}
                            placeholder="Work done, notes for Admin/Manager…"
                            rows={3}
                            maxLength={1000}
                        />
                    </div>
                )}
                <p className="text-xs text-muted-foreground">
                    {isFinal
                        ? 'OK saves these Completion photos. Submit to Admin sends the package.'
                        : 'OK saves these photos. Submit to Admin comes after Completion.'}
                </p>
                <div className="flex flex-col gap-2">
                <Button className="min-h-12 w-full" onClick={onConfirm} disabled={photos.length === 0 || uploading}>
                    OK
                </Button>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button variant="outline" className="min-h-11 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 hover:text-amber-950" onClick={onRetakeAll}>
                    Retake All
                </Button>
                <Button variant="outline" className="min-h-11 border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800" onClick={onAddMore} disabled={photos.length >= MAX_PHOTOS_PER_STAGE || uploading}>
                    Add More
                </Button>
                <Button variant="outline" className="min-h-11 border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800" onClick={onUploadMore} disabled={photos.length >= MAX_PHOTOS_PER_STAGE || uploading}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Upload'}
                </Button>
                </div>
                </div>
            </div>
        </div>
    );
}
