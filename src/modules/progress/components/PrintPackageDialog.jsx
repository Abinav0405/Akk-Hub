import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Printer, Share2 } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { getPackageImagesForViewer, noteExporterDownloads, packageExportMeta } from '@/modules/progress/lib/packageExport';
import { getSignedUrl } from '@/modules/progress/lib/staffPackages';
import { listDocumentTitles, recordDocumentTitleUse } from '@/modules/progress/lib/documentTitles';
import { formatDate } from '@/modules/progress/lib/dates';
import { buildPackageAutoTitle, buildPackagePdfPages, buildReportDocumentName, cleanExportFileName, fitPdfPhoto } from '@/modules/progress/lib/packagePdf';
import { buildPdfFromPages } from '@/modules/progress/lib/pdf';
import { useCanonicalPdf } from '@/modules/progress/lib/documentEndorsement';
import { brandingLogoDataUrl, brandingLogoUrl, getCompanyBranding } from '@/modules/progress/lib/branding';
import { blobUrlToDataUrl } from '@/modules/progress/lib/imageDataUrl';
import { cn } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';
import { PHOTO_ASPECT_RATIO } from '@/modules/progress/lib/config';
import { packageHeading, sectionIdFieldLabel } from '@/modules/progress/lib/sectionLabel';
import ExportFileNameField from '@/modules/progress/components/ExportFileNameField';

function LightPreview({ title, pkg, thumbs, branding }) {
    return (
        <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Page 1 preview
            </p>
            <div className="overflow-hidden rounded-xl border border-border bg-white p-3">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                    <img src={brandingLogoUrl(branding)} alt="" className="h-8 w-8 object-contain" />
                    <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">{branding?.company_name || 'AKK ENGINEERING PTE. LTD.'}</p>
                        <p className="text-[11px] font-semibold text-slate-900">Package</p>
                    </div>
                </div>
                {pkg.display_id && (
                    <p className="mt-2 text-[11px] font-semibold text-slate-600">{pkg.display_id}</p>
                )}
                <p className="mt-2 truncate text-sm font-semibold text-slate-900">{title}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Date</p>
                        <p className="font-medium text-slate-800">{formatDate(pkg.package_date)}</p>
                    </div>
                    <div>
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">Site</p>
                        <p className="font-medium text-slate-800">{pkg.site?.name || 'Deleted site'}</p>
                    </div>
                    <div>
                        <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                            {sectionIdFieldLabel(pkg.section_label)}
                        </p>
                        <p className="font-medium text-slate-800">{pkg.lcb_id}</p>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                    {(thumbs.length ? thumbs : ['', '', '', '']).slice(0, 4).map((src, i) => (
                        <div
                            key={src || `ph-${i}`}
                            className="overflow-hidden rounded-md bg-slate-100"
                            style={{ aspectRatio: PHOTO_ASPECT_RATIO }}
                        >
                            {src ? (
                                <img
                                    src={src}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    className="h-full w-full object-cover"
                                />
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function PrintPackageDialog({ pkg, onClose, onExported, asExporter = false }) {
    const native = isNativeApp();
    // Both start as description, section name, street name and stay editable.
    const autoTitle = useMemo(() => buildPackageAutoTitle(packageExportMeta(pkg)), [pkg]);
    const autoFileName = useMemo(() => buildReportDocumentName(packageExportMeta(pkg)), [pkg]);
    const [title, setTitle] = useState(autoTitle);
    const [fileName, setFileName] = useState(autoFileName);
    const [previewTitle, setPreviewTitle] = useState('');
    const [titleSuggestions, setTitleSuggestions] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState('');
    const [previewPhotos, setPreviewPhotos] = useState([]);
    const [branding, setBranding] = useState(null);

    useEffect(() => {
        listDocumentTitles({ asExporter }).then(setTitleSuggestions).catch(() => {});
        getCompanyBranding().then(setBranding).catch(() => {});
    }, [asExporter]);

    useEffect(() => {
        const t = setTimeout(() => setPreviewTitle(title.trim() || 'Document title'), 180);
        return () => clearTimeout(t);
    }, [title]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const images = await getPackageImagesForViewer(pkg.id, { asExporter });
                const first = images.slice(0, 4);
                const urls = await Promise.all(first.map((img) => getSignedUrl(img.storage_path).catch(() => null)));
                if (!cancelled) setPreviewPhotos(urls.filter(Boolean));
            } catch (e) {
                console.error('[PrintPackageDialog] preview photos failed:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [pkg.id, asExporter]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            toast.error('Enter a title for this document');
            return;
        }

        setGenerating(true);
        setProgress(native ? 'Loading photos…' : 'Preparing PDF…');
        try {
            const images = await getPackageImagesForViewer(pkg.id, { asExporter });
            if (images.length === 0) {
                toast.error('This package has no photos yet');
                return;
            }

            const brandingRow = await getCompanyBranding();
            const [logoSrc, ...rawResults] = await Promise.all([
                brandingLogoDataUrl(brandingRow),
                ...images.map(async (img) => {
                    try {
                        const url = await getSignedUrl(img.storage_path);
                        const dataUrl = await blobUrlToDataUrl(url);
                        return { stage: img.stage, dataUrl, caption: img.caption || '' };
                    } catch (e) {
                        console.warn('[PrintPackageDialog] skipping a photo that failed to load:', img.storage_path, e);
                        return null;
                    }
                }),
            ]);
            const dataUrls = rawResults.filter(Boolean);
            if (dataUrls.length < images.length) {
                toast.error(`${images.length - dataUrls.length} photo(s) could not be loaded and were skipped`);
            }

            const stagePhotos = { before: [], during: [], after: [], completion: [] };
            const fitted = await Promise.all(
                dataUrls.map(async (row) => ({
                    stage: row.stage,
                    dataUrl: await fitPdfPhoto(row.dataUrl),
                    caption: row.caption || '',
                }))
            );
            fitted.forEach((row) => {
                if (stagePhotos[row.stage]) stagePhotos[row.stage].push({ dataUrl: row.dataUrl, caption: row.caption });
            });

            const exportName = cleanExportFileName(fileName) || autoFileName;
            const pages = buildPackagePdfPages({
                title: trimmedTitle,
                displayId: pkg.display_id,
                packageDate: pkg.package_date,
                siteName: pkg.site?.name,
                lcbId: pkg.lcb_id,
                sectionLabel: pkg.section_label,
                workerName: pkg.worker?.display_name || 'Deleted employee/technician',
                logoSrc,
                companyName: brandingRow.company_name,
                companyAddress: brandingRow.company_address,
                documentChrome: brandingRow.document_chrome,
                stagePhotos,
                description: pkg.description,
            });
            setProgress(native ? 'Opening share sheet…' : 'Opening print dialog…');
            const result = await useCanonicalPdf({
                kind: 'package',
                documentId: pkg.id,
                buildPdfBlob: () => buildPdfFromPages(pages, undefined, (page, total) => {
                    setProgress(`Rendering page ${page} of ${total}…`);
                }, { title: exportName }),
                print: true,
                fileName: `${exportName}.pdf`,
            });
            if (result?.canceled) {
                toast.message('Print cancelled');
                return;
            }
            recordDocumentTitleUse(trimmedTitle, { asExporter }).catch(() => {});
            if (native) toast.success('PDF ready — pick Save, Drive, or a printer');
            await noteExporterDownloads([pkg.id], 'pdf', { asExporter });
            onExported?.();
            onClose();
        } catch (e2) {
            console.error('[PrintPackageDialog] PDF generation failed:', e2);
            toast.error(e2.message || 'Could not generate the PDF');
        } finally {
            setGenerating(false);
            setProgress('');
        }
    };

    const heading = useMemo(() => packageHeading(pkg), [pkg]);

    return (
        <Dialog open onOpenChange={(open) => !open && !generating && onClose()}>
            <DialogContent className="max-w-xl min-w-0 overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle>Print report</DialogTitle>
                    <DialogDescription>
                        {heading} · {formatDate(pkg.package_date)}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="doc-title">Document title</Label>
                        <Input
                            id="doc-title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. TR412C LCB Maintenance Report (Year 2)"
                            autoFocus={!native}
                            required
                            disabled={generating}
                        />
                        {titleSuggestions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {titleSuggestions.slice(0, 8).map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        type="button"
                                        disabled={generating}
                                        onClick={() => setTitle(suggestion)}
                                        className={cn(
                                            'max-w-full truncate rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                                            title === suggestion
                                                ? 'border-brand bg-brand-muted text-brand'
                                                : 'border-border bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                        )}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <ExportFileNameField
                        id="doc-file-name"
                        value={fileName}
                        onChange={setFileName}
                        autoValue={autoFileName}
                        extension=".pdf"
                        disabled={generating}
                        showReset={Boolean(autoTitle) && (title !== autoTitle || fileName !== autoFileName)}
                        onReset={() => {
                            setTitle(autoTitle);
                            setFileName(autoFileName);
                        }}
                    />
                    <LightPreview title={previewTitle || 'Document title'} pkg={pkg} thumbs={previewPhotos} branding={branding} />
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={generating}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={generating || !title.trim()}>
                            {generating ? (
                                <>
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {progress || 'Preparing PDF…'}
                                </>
                            ) : native ? (
                                <>
                                    <Share2 className="mr-1.5 h-4 w-4" /> Save / Print PDF
                                </>
                            ) : (
                                <>
                                    <Printer className="mr-1.5 h-4 w-4" /> Print
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
