// TODO(claude): wire /account and /verify; provide @/ui/layout, AuthChecking, useRoleGuard; session helpers under @/core/*
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    ShieldCheck,
    ShieldAlert,
    ShieldQuestion,
    Upload,
    Loader2,
    ScanLine,
    Images,
    Fingerprint,
    CheckCircle2,
    RefreshCw,
} from 'lucide-react';
import { AppShell, PageHeader } from '@/ui/layout';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn, createPageUrl, routeSearchParams } from '@/modules/progress/lib/utils';
import { formatDate } from '@/modules/progress/lib/dates';
import { formatSectionRef, sectionIdFieldLabel } from '@/modules/progress/lib/sectionLabel';
import { STAGES, STAGE_PICKER_LABELS } from '@/modules/progress/lib/config';
import {
    lookupVerificationCode,
    classifyVerification,
    verifyImageBlob,
    fetchImageBlob,
    runPool,
    resetVerificationEngine,
    verifyConcurrency,
    MAX_UPLOAD_BYTES,
} from '@/modules/progress/lib/photoVerification';
import { normalizeVerificationCode, isVerificationCodeFormat } from '@/modules/progress/lib/verificationCode';
import { isLikelyImageFile } from '@/modules/progress/lib/loadImage';
import { isNativeApp } from '@/core/platform';
import {
    parsePackageId,
    parseFromPage,
    sanitizeVerifyLabel,
    listPackagePhotosForVerification,
} from '@/modules/progress/lib/packagePhotoVerify';

const STATUS_META = {
    pending: {
        tone: 'neutral',
        icon: Loader2,
        title: 'Checking this photo…',
        short: 'Checking',
        spin: true,
    },
    'exact-match': {
        tone: 'good',
        icon: ShieldCheck,
        title: 'Verified — authentic and unaltered',
        short: 'Verified',
        detail: 'This file is byte-for-byte identical to the original photo we issued.',
    },
    'content-match': {
        tone: 'good',
        icon: ShieldCheck,
        title: 'Verified — content matches our original',
        short: 'Verified',
        detail: 'The code is genuine and the visible content matches. The file isn’t byte-identical (often re-saved by a messaging app), but no substantial alteration was detected.',
    },
    'content-mismatch': {
        tone: 'warn',
        icon: ShieldAlert,
        title: 'Warning — content does not match our original',
        short: 'Mismatch',
        detail: 'The code is genuine, but this might be a compressed file, so this file’s content differs significantly from the original.',
    },
    'content-unknown': {
        tone: 'neutral',
        icon: ShieldQuestion,
        title: 'Code found — could not compare pixels',
        short: 'Code only',
        detail: 'This code matches a photo we issued, but we could not compare visible content: the original was stored without a perceptual fingerprint. SHA-256 of this file will not match after a messaging app re-saves it.',
    },
    'not-found': {
        tone: 'bad',
        icon: ShieldAlert,
        title: 'Not verified — no matching record',
        short: 'Not on file',
        detail: 'This code does not match any photo issued by AKK Engineering’s Site Progress Tracker. If the photo came through WhatsApp, the barcode may have been misread — type the printed code under the bars.',
    },
    'unclear-code': {
        tone: 'warn',
        icon: ShieldQuestion,
        title: "Couldn't read the barcode clearly — type the printed code",
        short: 'Unclear',
        detail: 'The barcode is too compressed or the scanners disagreed, so we did not guess a code. Type the short code printed under the bars (e.g. 7K9M-2XQ4).',
    },
    'no-code-detected': {
        tone: 'bad',
        icon: ShieldAlert,
        title: 'No verification code found',
        short: 'No code',
        detail: 'We couldn’t detect the barcode. Messaging apps like WhatsApp often blur it. If you can still read the printed code under the bars, enter it manually below.',
    },
    'scanner-unavailable': {
        tone: 'warn',
        icon: ShieldAlert,
        title: 'Verification engine failed to load',
        short: 'Engine error',
        detail: 'The barcode scanner could not start — often a stale page after an app update. Refresh this page and tap Retry.',
    },
    'decode-failed': {
        tone: 'bad',
        icon: ShieldAlert,
        title: 'Could not read this image',
        short: 'Unreadable',
        detail: 'The file did not decode as a usable photo (corrupt, blocked, or a thumbnail that is too small). Try the original JPEG.',
    },
    'code-only': {
        tone: 'neutral',
        icon: ShieldQuestion,
        title: 'Code found on record',
        short: 'Code only',
        detail: 'This code matches a photo we issued. Upload the actual photo file to also confirm its visible content hasn’t been altered.',
    },
    error: {
        tone: 'bad',
        icon: ShieldAlert,
        title: 'Could not check this photo',
        short: 'Error',
        detail: 'Try a different file, or check your connection and run the check again.',
    },
};

const TONE_BOX = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-900',
    neutral: 'border-border bg-slate-50 text-slate-800',
};

const TONE_ICON = {
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
    neutral: 'text-slate-500',
};

const TONE_PILL = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-800',
    neutral: 'border-border bg-white text-slate-600',
};

function RecordDetails({ record }) {
    const rows = [
        ['Site', record.site_name || 'Deleted site'],
        [sectionIdFieldLabel(record.section_label), formatSectionRef(record.section_label, record.lcb_id)],
        ['Date', formatDate(record.package_date)],
        ['Stage', record.stage ? record.stage[0].toUpperCase() + record.stage.slice(1) : '—'],
        ['Captured at', record.captured_at ? new Date(record.captured_at).toLocaleString() : 'Not recorded'],
        ['Location', record.captured_address || 'Not recorded'],
        ['Submitted by', record.worker_display_name || 'Deleted employee'],
    ];
    return (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map(([label, value]) => (
                <div key={label}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-medium text-navy">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function ResultCard({ item }) {
    const meta = STATUS_META[item.status] || STATUS_META.error;
    const Icon = meta.icon;
    const tone = meta.tone;
    return (
        <div className={cn('overflow-hidden rounded-2xl border', TONE_BOX[tone])}>
            <div className="flex gap-3 p-3 sm:p-4">
                <div className="relative h-[4.5rem] w-[6rem] shrink-0 overflow-hidden rounded-xl bg-white/80 ring-1 ring-black/5">
                    {item.previewUrl && item.status !== 'pending' ? (
                        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                        <div className="flex h-full items-center justify-center">
                            <ScanLine className="h-5 w-5 text-slate-400" />
                        </div>
                    )}
                    {item.status === 'pending' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/55">
                            <Loader2 className="h-5 w-5 animate-spin text-brand" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {item.stage && (
                            <span className="rounded-full border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                                {STAGE_PICKER_LABELS[item.stage] || item.stage}
                            </span>
                        )}
                        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', TONE_PILL[tone])}>
                            <Icon className={cn('h-3 w-3', meta.spin && 'animate-spin')} />
                            {meta.short}
                        </span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold leading-snug">{meta.title}</p>
                    {item.label && item.label !== item.detectedCode && (
                        <p className="mt-0.5 line-clamp-2 break-all text-xs text-slate-600">{item.label}</p>
                    )}
                    {item.detectedCode && item.status !== 'unclear-code' && (
                        <p className="mt-1 font-mono text-xs font-semibold tracking-wide">{item.detectedCode}</p>
                    )}
                    {item.error && <p className="mt-1 text-xs">{item.error}</p>}
                </div>
            </div>
            {(item.record || meta.detail) && item.status !== 'pending' && (
                <details className="border-t border-black/5 bg-white/40 px-4 py-2">
                    <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold">Details</summary>
                    {meta.detail && <p className="mt-2 text-sm leading-relaxed">{meta.detail}</p>}
                    {item.record && (
                        <div className="mt-3">
                            <RecordDetails record={item.record} />
                        </div>
                    )}
                </details>
            )}
        </div>
    );
}

function summarize(results) {
    return results.reduce(
        (acc, row) => {
            if (row.status === 'pending') acc.pending += 1;
            else if (row.status === 'exact-match' || row.status === 'content-match') acc.good += 1;
            else if (row.status === 'content-mismatch') acc.warn += 1;
            else if (row.status === 'unclear-code') acc.unclear += 1;
            else if (row.status === 'code-only' || row.status === 'content-unknown') acc.neutral += 1;
            else if (row.status === 'scanner-unavailable') acc.engine += 1;
            else acc.bad += 1;
            return acc;
        },
        { pending: 0, good: 0, warn: 0, bad: 0, neutral: 0, engine: 0, unclear: 0 }
    );
}

export default function PhotoVerification() {
    const [searchParams] = useSearchParams();
    const params = routeSearchParams(searchParams);
    const packageId = parsePackageId(params.get('package'));
    const fromPage = parseFromPage(params.get('from'));
    const packageLabel = sanitizeVerifyLabel(params.get('label'));
    const packageDate = params.get('date') || '';
    const native = isNativeApp();

    const fileInputRef = useRef(null);
    const objectUrlsRef = useRef([]);
    const runIdRef = useRef(0);
    const [codeInput, setCodeInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [results, setResults] = useState([]);
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);

    useEffect(() => () => {
        objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    }, []);

    const verifyItemList = useCallback(async (items, { replace, updateExisting } = {}) => {
        if (!items.length) return;
        const runId = ++runIdRef.current;
        const initial = items.map((item) => ({
            ...item,
            status: 'pending',
            error: undefined,
            detectedCode: undefined,
            record: undefined,
        }));
        setResults((prev) => {
            if (replace) return initial;
            if (updateExisting) {
                const byId = new Map(initial.map((row) => [row.id, row]));
                return prev.map((row) => (byId.has(row.id) ? { ...row, ...byId.get(row.id) } : row));
            }
            return [...prev, ...initial];
        });
        setBusy(true);
        setError('');
        let done = 0;
        const total = items.length;
        setProgress(`Checking 0 of ${total}…`);
        await runPool(items, verifyConcurrency(), async (item) => {
            if (runId !== runIdRef.current) return;
            let outcome;
            try {
                let blob = item.file;
                if (!blob) {
                    const imageUrl = item.verifyUrl || item.previewUrl;
                    if (!imageUrl) throw new Error('Photo could not be loaded');
                    blob = await fetchImageBlob(imageUrl);
                }
                if (blob.size > MAX_UPLOAD_BYTES) {
                    outcome = { status: 'error', error: 'Photo is larger than 25 MB.' };
                } else {
                    outcome = await verifyImageBlob(blob);
                }
            } catch (e) {
                console.error('[PhotoVerification] item failed:', e);
                outcome = { status: 'error', error: e.message || 'Could not read this photo.' };
            }
            if (runId !== runIdRef.current) return;
            done += 1;
            setProgress(`Checking ${done} of ${total}…`);
            setResults((prev) => prev.map((row) => (
                row.id === item.id
                    ? { ...row, error: undefined, detectedCode: undefined, record: undefined, ...outcome }
                    : row
            )));
        });
        if (runId === runIdRef.current) {
            setBusy(false);
            setProgress('');
        }
    }, []);

    useEffect(() => {
        if (!packageId) return undefined;
        let cancelled = false;
        (async () => {
            setBusy(true);
            setError('');
            setProgress('Loading package photos…');
            try {
                const photos = await listPackagePhotosForVerification(packageId);
                if (cancelled) return;
                if (!photos.length) {
                    setResults([]);
                    setError('This package has no photos to verify.');
                    setBusy(false);
                    setProgress('');
                    return;
                }
                await verifyItemList(photos, { replace: true });
            } catch (e) {
                if (cancelled) return;
                console.error('[PhotoVerification] package load failed:', e);
                setError('Could not load this package’s photos. Sign in first, or upload copies of the photos below.');
                setBusy(false);
                setProgress('');
            }
        })();
        return () => {
            cancelled = true;
            runIdRef.current += 1;
        };
    }, [packageId, verifyItemList]);

    const handleFiles = async (fileList) => {
        // Copy before callers reset <input value=""> — FileList is live and would go empty.
        const files = Array.from(fileList || []).filter(isLikelyImageFile);
        if (!files.length) {
            setError('Choose image files.');
            return;
        }
        const items = files.map((file, i) => {
            const previewUrl = URL.createObjectURL(file);
            objectUrlsRef.current.push(previewUrl);
            return {
                id: `upload-${Date.now()}-${i}-${file.name}`,
                file,
                previewUrl,
                label: file.name,
                source: 'upload',
            };
        });
        await verifyItemList(items, { replace: !packageId && results.length === 0 });
    };

    const retryable = results.filter((row) =>
        ['scanner-unavailable', 'decode-failed', 'error', 'no-code-detected', 'unclear-code'].includes(row.status)
    );
    const needsEngineRetry = results.some((row) => row.status === 'scanner-unavailable');

    const handleRetry = async () => {
        if (!retryable.length || busy) return;
        resetVerificationEngine();
        const items = retryable.map((row) => ({
            id: row.id,
            file: row.file,
            previewUrl: row.previewUrl,
            verifyUrl: row.verifyUrl,
            label: row.label,
            stage: row.stage,
            sort_order: row.sort_order,
            source: row.source,
        }));
        await verifyItemList(items, { replace: false, updateExisting: true });
    };

    const handleManualCheck = async (e) => {
        e.preventDefault();
        const code = normalizeVerificationCode(codeInput);
        if (!isVerificationCodeFormat(code)) {
            setError('Enter the full code shown on the photo (e.g. 7K9M-2XQ4).');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const record = await lookupVerificationCode(code);
            const outcome = classifyVerification({ code, record, hashes: null });
            setResults((prev) => [
                { id: `code-${code}-${Date.now()}`, label: code, ...outcome },
                ...prev,
            ]);
        } catch (err) {
            console.error('[PhotoVerification] check failed:', err);
            setError(err.message || 'Could not complete the check. Try again.');
        } finally {
            setBusy(false);
        }
    };

    const counts = useMemo(() => summarize(results), [results]);
    const finished = results.length > 0 && counts.pending === 0;
    const grouped = useMemo(() => {
        if (!results.some((row) => row.stage)) return null;
        const buckets = { before: [], during: [], after: [], completion: [], other: [] };
        results.forEach((row) => {
            if (buckets[row.stage]) buckets[row.stage].push(row);
            else buckets.other.push(row);
        });
        return buckets;
    }, [results]);

    return (
        <AppShell
            header={
                <PageHeader
                    title="Photo Verification"
                    description={packageId ? 'Checking every photo on this package against our records.' : 'Confirm site progress photos are authentic and unaltered.'}
                    backTo={createPageUrl(fromPage)}
                    variant="navy"
                />
            }
            maxWidth="4xl"
        >
            <div className="space-y-6">
                <section className="relative overflow-hidden rounded-2xl border border-border bg-navy-muted/50 px-5 py-6 sm:px-8 sm:py-7">
                    <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-border">
                            <ShieldCheck className="h-7 w-7 text-brand" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-navy">
                                {packageId ? 'Package check' : 'Public check · no login'}
                            </p>
                            <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy sm:text-2xl">
                                {packageId ? 'Verify every photo at once' : 'Verify site progress photos'}
                            </h2>
                            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                                {packageId
                                    ? 'Each stored photo is scanned for its verification mark and compared with the original fingerprint we saved when it was captured.'
                                    : 'Upload one photo or a whole set. We read the small barcode in the top-right corner and compare each file against AKK Engineering’s records.'}
                            </p>
                        </div>
                    </div>
                    <div className="relative mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {[
                            { icon: Images, label: 'Add photos', hint: packageId ? 'Loaded from this package' : 'One file or many together' },
                            { icon: ScanLine, label: 'Read the mark', hint: 'Barcode in the top-right corner' },
                            { icon: Fingerprint, label: 'Match records', hint: 'Exact file + visible content' },
                        ].map((step) => (
                            <div key={step.label} className="flex items-start gap-3 rounded-xl border border-border bg-white px-3.5 py-3">
                                <step.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-navy">{step.label}</p>
                                    <p className="text-xs text-muted-foreground">{step.hint}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {packageId && (
                    <Card className="border-brand/30 bg-brand-muted/40 p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-brand">Package</p>
                                <p className="mt-0.5 text-base font-semibold text-slate-900">
                                    {packageLabel || 'Site progress package'}
                                </p>
                                {packageDate && (
                                    <p className="text-sm text-muted-foreground">{formatDate(packageDate)}</p>
                                )}
                            </div>
                            {busy && (
                                <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                                    {progress || 'Working…'}
                                </span>
                            )}
                        </div>
                    </Card>
                )}

                <Card className="p-5 sm:p-6">
                    <div className="flex items-center gap-2">
                        <Upload className="h-4 w-4 text-brand" />
                        <Label htmlFor="photo-verification-files" className="text-sm font-semibold">
                            {packageId ? 'Or upload copies to compare' : 'Upload photos'}
                        </Label>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Select several files at once — they are all checked together. We look for the barcode in the top-right corner.
                    </p>
                    <div
                        onDragEnter={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!busy) setDragOver(true);
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!busy) setDragOver(true);
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.currentTarget.contains(e.relatedTarget)) return;
                            setDragOver(false);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOver(false);
                            if (!busy) handleFiles(e.dataTransfer.files);
                        }}
                        className={cn(
                            'relative mt-4 flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed py-10 text-center transition-colors focus-within:border-brand/60',
                            busy && 'opacity-60',
                            dragOver
                                ? 'border-brand bg-brand-muted'
                                : 'border-border bg-muted hover:border-brand/50 hover:bg-brand-muted'
                        )}
                    >
                        <input
                            id="photo-verification-files"
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            disabled={busy}
                            aria-label="Choose photos"
                            className="absolute inset-0 z-10 h-full w-full cursor-pointer text-[100px] opacity-0 disabled:pointer-events-none"
                            onChange={(e) => {
                                const files = Array.from(e.target.files || []);
                                e.target.value = '';
                                if (files.length) handleFiles(files);
                            }}
                        />
                        {busy && !packageId ? (
                            <div className="pointer-events-none flex flex-col items-center justify-center gap-2">
                                <Loader2 className="h-7 w-7 animate-spin text-brand" />
                                <span className="text-sm text-muted-foreground">{progress || 'Working…'}</span>
                            </div>
                        ) : (
                            <div className="pointer-events-none flex flex-col items-center justify-center gap-2">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-xs">
                                    <Images className="h-6 w-6 text-brand" />
                                </div>
                                <span className="text-sm font-semibold text-slate-800">
                                    {native ? 'Tap to choose photos' : 'Drop photos here or click to choose'}
                                </span>
                                <span className="text-xs text-muted-foreground">JPEG, PNG, or WebP · up to 25 MB each</span>
                            </div>
                        )}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="relative z-20 mt-1 min-h-11"
                            disabled={busy}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                        >
                            Choose photos
                        </Button>
                    </div>
                </Card>

                <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    Or check a code
                    <div className="h-px flex-1 bg-border" />
                </div>

                <Card className="p-5 sm:p-6">
                    <div className="flex items-center gap-2">
                        <ScanLine className="h-4 w-4 text-brand" />
                        <Label htmlFor="manual-code" className="text-sm font-semibold">Enter the code by hand</Label>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                        The short code printed under the barcode, e.g. <span className="font-mono">7K9M-2XQ4</span>. If WhatsApp (or another chat app) blurred the bars, type that printed code. This only checks the code against our records.
                    </p>
                    <form onSubmit={handleManualCheck} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                            id="manual-code"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value)}
                            placeholder="XXXX-XXXX"
                            className="font-mono uppercase tracking-widest"
                            disabled={busy}
                        />
                        <Button type="submit" disabled={busy || !codeInput.trim()} className="min-h-11 sm:shrink-0">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Check code'}
                        </Button>
                    </form>
                </Card>

                {error && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
                )}

                {results.length > 0 && (
                    <section className="space-y-4">
                        <div className={cn(
                            'rounded-2xl border px-4 py-3 sm:px-5',
                            finished && counts.bad === 0 && counts.warn === 0 && counts.engine === 0 && counts.unclear === 0
                                ? 'border-emerald-200 bg-emerald-50'
                                : finished && (counts.engine > 0 || counts.warn > 0 || counts.unclear > 0)
                                    ? 'border-amber-300 bg-amber-50'
                                    : finished && counts.bad > 0
                                        ? 'border-red-200 bg-red-50'
                                        : 'border-border bg-white'
                        )}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    {finished && counts.bad === 0 && counts.warn === 0 && counts.engine === 0 && counts.unclear === 0 ? (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                    ) : busy ? (
                                        <Loader2 className="h-5 w-5 animate-spin text-brand" />
                                    ) : (
                                        <ShieldCheck className="h-5 w-5 text-slate-500" />
                                    )}
                                    <p className="text-sm font-semibold text-slate-900">
                                        {finished && counts.bad === 0 && counts.warn === 0 && counts.engine === 0 && counts.unclear === 0
                                            ? `All ${results.length} photo${results.length === 1 ? '' : 's'} verified`
                                            : busy
                                                ? (progress || 'Checking photos…')
                                                : `${results.length} photo${results.length === 1 ? '' : 's'} checked`}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                                    {counts.good > 0 && (
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">{counts.good} verified</span>
                                    )}
                                    {counts.warn > 0 && (
                                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">{counts.warn} mismatch</span>
                                    )}
                                    {counts.unclear > 0 && (
                                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">{counts.unclear} unclear</span>
                                    )}
                                    {counts.engine > 0 && (
                                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">{counts.engine} engine error</span>
                                    )}
                                    {counts.bad > 0 && (
                                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-800">{counts.bad} failed</span>
                                    )}
                                    {counts.neutral > 0 && (
                                        <span className="rounded-full border border-border bg-slate-50 px-2 py-0.5 text-slate-600">{counts.neutral} code only</span>
                                    )}
                                    {counts.pending > 0 && (
                                        <span className="rounded-full border border-border bg-white px-2 py-0.5 text-slate-500">{counts.pending} checking</span>
                                    )}
                                    {finished && retryable.length > 0 && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="min-h-11 gap-1.5 px-3 text-xs"
                                            onClick={handleRetry}
                                            disabled={busy}
                                        >
                                            <RefreshCw className="h-3 w-3" />
                                            {needsEngineRetry ? 'Retry scanner' : 'Retry failed'}
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {needsEngineRetry && finished && (
                                <p className="mt-2 text-xs text-amber-900">
                                    The scanner did not load, so these photos were not marked as having no code. Refresh if Retry still fails.
                                </p>
                            )}
                        </div>

                        {grouped ? (
                            STAGES.filter((stage) => grouped[stage].length > 0).map((stage) => (
                                <div key={stage} className="space-y-2">
                                    <h3 className="text-sm font-semibold text-slate-900">
                                        {STAGE_PICKER_LABELS[stage]}
                                        <span className="ml-1.5 text-xs font-medium text-muted-foreground">{grouped[stage].length}</span>
                                    </h3>
                                    <div className={cn('grid grid-cols-1 gap-3', grouped[stage].length > 1 && 'lg:grid-cols-2')}>
                                        {grouped[stage].map((item) => (
                                            <ResultCard key={item.id} item={item} />
                                        ))}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className={cn('grid grid-cols-1 gap-3', results.length > 1 && 'lg:grid-cols-2')}>
                                {results.map((item) => (
                                    <ResultCard key={item.id} item={item} />
                                ))}
                            </div>
                        )}
                        {grouped?.other?.length > 0 && (
                            <div className={cn('grid grid-cols-1 gap-3', grouped.other.length > 1 && 'lg:grid-cols-2')}>
                                {grouped.other.map((item) => (
                                    <ResultCard key={item.id} item={item} />
                                ))}
                            </div>
                        )}
                    </section>
                )}

                <p className="text-center text-xs text-muted-foreground">
                    AKK Engineering Pte. Ltd. — Site Progress Tracker Photo Verification
                </p>
            </div>
        </AppShell>
    );
}
