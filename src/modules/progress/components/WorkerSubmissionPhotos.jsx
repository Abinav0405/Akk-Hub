import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { STAGES, STAGE_LABELS, PHOTO_ASPECT_RATIO } from '@/modules/progress/lib/config';
import { getMyPackageImages, getPhotoUrl, deleteMyPackageImage, updateMyImageCaption } from '@/modules/progress/lib/packages';
import { friendlyDbError } from '@/modules/progress/lib/networkError';
import { Button } from '@/ui/button';
import PhotoLightbox from '@/modules/progress/components/PhotoLightbox';

const SHORT_STAGE_LABELS = {
    before: 'Before',
    during: 'During',
    after: 'After',
    completion: 'Completion',
};

export default function WorkerSubmissionPhotos({ packageId, canRemove = false, onChanged }) {
    const hostRef = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '240px' }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={hostRef} className="mt-3 min-w-0">
            {visible ? (
                <WorkerSubmissionPhotosInner
                    packageId={packageId}
                    canRemove={canRemove}
                    onChanged={onChanged}
                />
            ) : (
                <div className="h-20 rounded-lg bg-slate-50" aria-hidden />
            )}
        </div>
    );
}

function WorkerSubmissionPhotosInner({ packageId, canRemove, onChanged }) {
    const [images, setImages] = useState(null);
    const [urls, setUrls] = useState({});
    const [previewId, setPreviewId] = useState(null);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [busy, setBusy] = useState(false);
    const refreshedRef = useRef(new Set());

    const refreshUrl = async (img) => {
        if (refreshedRef.current.has(img.id)) return;
        refreshedRef.current.add(img.id);
        try {
            const fresh = await getPhotoUrl(img.storage_path);
            setUrls((prev) => ({ ...prev, [img.id]: fresh }));
        } catch {
            /* ignore — thumbnail stays as-is until the next full reload */
        }
    };

    useEffect(() => {
        let cancelled = false;
        setError(false);
        setImages(null);
        setUrls({});
        refreshedRef.current = new Set();
        getMyPackageImages(packageId)
            .then(async (rows) => {
                if (cancelled) return;
                setImages(rows);
                const entries = await Promise.all(
                    rows.map(async (r) => [r.id, await getPhotoUrl(r.storage_path).catch(() => null)])
                );
                if (cancelled) return;
                setUrls(Object.fromEntries(entries));
            })
            .catch(() => {
                if (cancelled) return;
                setImages([]);
                setError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [packageId, reloadKey]);

    const byStage = useMemo(() => {
        const grouped = { before: [], during: [], after: [], completion: [] };
        (images || []).forEach((img) => grouped[img.stage]?.push(img));
        return grouped;
    }, [images]);

    const gallery = useMemo(
        () => STAGES.flatMap((stage) => byStage[stage] || []),
        [byStage]
    );

    const removeImage = async (img) => {
        setBusy(true);
        try {
            await deleteMyPackageImage(img.id, img.storage_path);
            setImages((prev) => (prev || []).filter((i) => i.id !== img.id));
            onChanged?.();
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not remove photo'));
            throw e;
        } finally {
            setBusy(false);
        }
    };

    const handleCaption = async (img, caption) => {
        const next = String(caption || '').trim();
        if (next === String(img.caption || '').trim()) return;
        try {
            await updateMyImageCaption(img.id, next);
            setImages((prev) => (prev || []).map((row) => (row.id === img.id ? { ...row, caption: next || null } : row)));
        } catch (e) {
            toast.error(friendlyDbError(e, 'Could not save caption'));
        }
    };

    const handleDeleteImage = async (img) => {
        if (!window.confirm('Remove this photo?')) return;
        try {
            await removeImage(img);
        } catch {
            /* toasted in removeImage */
        }
    };

    if (error) {
        return (
            <div className="rounded-lg border border-dashed border-border bg-slate-50 px-3 py-3 text-center">
                <p className="text-xs text-muted-foreground">Could not load photos.</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setReloadKey((n) => n + 1)}>
                    Retry
                </Button>
            </div>
        );
    }

    if (images === null) {
        return (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Loading photos…</span>
            </div>
        );
    }

    if (gallery.length === 0) {
        return (
            <p className="text-xs text-muted-foreground">No photos on this submission.</p>
        );
    }

    return (
        <>
            <div className="space-y-3">
                {STAGES.map((stage) => {
                    const rows = byStage[stage];
                    if (!rows.length) return null;
                    return (
                        <div key={stage}>
                            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {SHORT_STAGE_LABELS[stage] || STAGE_LABELS[stage]}
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                {rows.map((img) => (
                                    <div key={img.id} className="min-w-0 max-w-full overflow-x-hidden">
                                    <div
                                        className="relative overflow-hidden rounded-lg border border-border bg-slate-100"
                                        style={{ aspectRatio: PHOTO_ASPECT_RATIO }}
                                    >
                                        {urls[img.id] ? (
                                            <button
                                                type="button"
                                                onClick={() => setPreviewId(img.id)}
                                                className="h-full w-full cursor-zoom-in"
                                                aria-label={`Preview ${SHORT_STAGE_LABELS[stage] || stage} photo`}
                                            >
                                                <img
                                                    src={urls[img.id]}
                                                    alt=""
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
                                        {canRemove && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteImage(img);
                                                }}
                                                disabled={busy}
                                                className="absolute right-1 top-1 z-10 flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-black/60 text-white"
                                                aria-label="Remove photo"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>
                                    {canRemove ? (
                                        <WorkerCaptionInput
                                            value={img.caption}
                                            disabled={busy}
                                            onSave={(caption) => handleCaption(img, caption)}
                                        />
                                    ) : img.caption ? (
                                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{img.caption}</p>
                                    ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
            {previewId && (
                <PhotoLightbox
                    gallery={gallery}
                    urls={urls}
                    previewId={previewId}
                    onClose={() => setPreviewId(null)}
                    onImageError={refreshUrl}
                    onRemove={canRemove ? removeImage : undefined}
                />
            )}
        </>
    );
}

function WorkerCaptionInput({ value, onSave, disabled }) {
    const [text, setText] = useState(value || '');
    useEffect(() => {
        setText(value || '');
    }, [value]);
    return (
        <textarea
            value={text}
            maxLength={120}
            rows={2}
            placeholder="Caption (optional)"
            disabled={disabled}
            className="mt-1 min-h-11 w-full min-w-0 max-w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs leading-snug ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
