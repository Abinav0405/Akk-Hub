import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, Printer, Sheet } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { listDocumentTitles, recordDocumentTitleUse } from '@/modules/progress/lib/documentTitles';
import { formatDate } from '@/modules/progress/lib/dates';
import { buildPackageAutoTitle, buildReportDocumentName, buildPackagePdfPages, fitPdfPhoto, buildReportFileName } from '@/modules/progress/lib/packagePdf';
import { brandingLogoDataUrl, getCompanyBranding } from '@/modules/progress/lib/branding';
import { loadStagePhotos, packageExportMeta, noteExporterDownloads } from '@/modules/progress/lib/packageExport';
import { cn } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';
import { packageHeading } from '@/modules/progress/lib/sectionLabel';
import { getCanonicalPdfBlob, recordDocumentEventSafe } from '@/modules/progress/lib/documentEndorsement';

export default function MultiExportDialog({ packages, onClose, onExported, asExporter = false }) {
    const native = isNativeApp();
    const [format, setFormat] = useState('pdf');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    // Each package starts with its own auto title (description, section name, street name).
    const [titles, setTitles] = useState(() => Object.fromEntries(
        (packages || [])
            .map((p) => [p.id, buildPackageAutoTitle(packageExportMeta(p))])
            .filter(([, title]) => title)
    ));
    const [activeTitleId, setActiveTitleId] = useState(null);
    const [titleSuggestions, setTitleSuggestions] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState('');

    useEffect(() => {
        listDocumentTitles({ asExporter }).then(setTitleSuggestions).catch(() => {});
    }, [asExporter]);

    const selected = useMemo(
        () => packages.filter((p) => selectedIds.has(p.id)),
        [packages, selectedIds]
    );

    const allSelected = packages.length > 0 && selected.length === packages.length;
    const titlesReady = selected.length > 0 && selected.every((p) => String(titles[p.id] || '').trim());
    const activeTitlePkg = selected.find((p) => p.id === activeTitleId) || selected[0] || null;

    useEffect(() => {
        if (!selected.length) {
            if (activeTitleId != null) setActiveTitleId(null);
            return;
        }
        if (!selected.some((p) => p.id === activeTitleId)) {
            setActiveTitleId(selected[0].id);
        }
    }, [selected, activeTitleId]);

    const toggle = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else {
                next.add(id);
                setActiveTitleId(id);
            }
            return next;
        });
    };

    const toggleAll = () => {
        if (allSelected) setSelectedIds(new Set());
        else setSelectedIds(new Set(packages.map((p) => p.id)));
    };

    const applyTitleToAll = () => {
        const first = String(titles[selected[0]?.id] || '').trim();
        if (!first) {
            toast.error('Enter a title on the first selected package first');
            return;
        }
        setTitles((prev) => {
            const next = { ...prev };
            selected.forEach((p) => {
                next[p.id] = first;
            });
            return next;
        });
    };

    const handleDownload = async () => {
        if (!titlesReady) {
            toast.error('Select packages and enter a title for each one');
            return;
        }

        setGenerating(true);
        const files = [];
        const skipped = [];
        const usedTitles = [];
        const exportedIds = [];
        try {
            const branding = await getCompanyBranding();
            const logoSrc = await brandingLogoDataUrl(branding);
            const pdfMod = await import('@/modules/progress/lib/pdf');
            const { buildPackageWorkbookBlob } = format === 'excel' ? await import('@/modules/progress/lib/packageExcel') : {};
            const photoWarnings = [];

            for (let i = 0; i < selected.length; i += 1) {
                const pkg = selected[i];
                const title = String(titles[pkg.id] || '').trim();
                setProgress(`Preparing ${i + 1} of ${selected.length}…`);
                const { stagePhotos, loaded, total } = await loadStagePhotos(pkg.id, { asExporter });
                if (loaded === 0) {
                    skipped.push(packageHeading(pkg));
                    continue;
                }
                if (loaded < total) {
                    photoWarnings.push(`${packageHeading(pkg)}: ${total - loaded} photo(s) skipped`);
                }

                const nameMeta = packageExportMeta(pkg);

                if (format === 'pdf') {
                    const fitted = { before: [], during: [], after: [], completion: [] };
                    for (const stage of Object.keys(stagePhotos)) {
                        fitted[stage] = await Promise.all(stagePhotos[stage].map(async (item) => {
                            const src = typeof item === 'string' ? item : item.dataUrl;
                            const caption = typeof item === 'string' ? '' : item.caption;
                            return { dataUrl: await fitPdfPhoto(src), caption };
                        }));
                    }
                    const pages = buildPackagePdfPages({
                        title,
                        displayId: pkg.display_id,
                        packageDate: pkg.package_date,
                        siteName: nameMeta.siteName,
                        lcbId: pkg.lcb_id,
                        sectionLabel: pkg.section_label,
                        logoSrc,
                        companyName: branding.company_name,
                        companyAddress: branding.company_address,
                        documentChrome: branding.document_chrome,
                        stagePhotos: fitted,
                        description: pkg.description,
                    });
                    const blob = await getCanonicalPdfBlob({
                        kind: 'package',
                        documentId: pkg.id,
                        buildPdfBlob: () => pdfMod.buildPdfFromPages(pages, undefined, undefined, {
                            title: buildReportDocumentName(nameMeta),
                        }),
                    });
                    recordDocumentEventSafe({
                        kind: 'package',
                        documentId: pkg.id,
                        action: 'exported',
                        summary: 'Downloaded the stored PDF',
                    });
                    files.push({ blob, fileName: buildReportFileName(nameMeta) });
                } else {
                    const blob = await buildPackageWorkbookBlob({
                        title,
                        displayId: pkg.display_id,
                        packageDate: pkg.package_date,
                        siteName: nameMeta.siteName,
                        lcbId: pkg.lcb_id,
                        sectionLabel: pkg.section_label,
                        companyName: branding.company_name,
                        companyAddress: branding.company_address,
                        logoSrc,
                        stagePhotos,
                        description: pkg.description,
                    });
                    files.push({
                        blob,
                        fileName: `${buildReportDocumentName(nameMeta)}.xlsx`,
                    });
                }
                usedTitles.push(title);
                exportedIds.push(pkg.id);
            }

            if (skipped.length) {
                toast.message(`Skipped (no photos): ${skipped.join(', ')}`);
            }
            if (photoWarnings.length) {
                toast.error(photoWarnings.join(' · '));
            }
            if (files.length === 0) {
                toast.error('Nothing to download');
                return;
            }

            setProgress(native ? 'Opening share sheet…' : 'Downloading…');
            const result = await pdfMod.saveBlobs(files);
            if (result?.canceled) {
                toast.message('Export cancelled');
                return;
            }
            [...new Set(usedTitles)].forEach((t) => {
                recordDocumentTitleUse(t, { asExporter }).catch(() => {});
            });
            await noteExporterDownloads(exportedIds, format, { asExporter });
            onExported?.();
            toast.success(
                native
                    ? `${files.length} file${files.length === 1 ? '' : 's'} ready — pick Save or Drive`
                    : `Downloaded ${files.length} file${files.length === 1 ? '' : 's'}`
            );
            onClose();
        } catch (e) {
            console.error('[MultiExportDialog] export failed:', e);
            toast.error(e.message || 'Could not export the files');
        } finally {
            setGenerating(false);
            setProgress('');
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !generating && onClose()}>
            <DialogContent className="max-w-2xl min-w-0 overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle>Export multiple</DialogTitle>
                    <DialogDescription>
                        Choose PDF or Excel, pick from the packages currently shown, set a document title for each, then download every file separately. The browser may ask to allow multiple downloads.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-w-0 space-y-4">
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant={format === 'pdf' ? 'default' : 'outline'}
                            className={native ? 'min-h-11 flex-1' : 'flex-1'}
                            disabled={generating}
                            onClick={() => setFormat('pdf')}
                        >
                            <Printer className="mr-1.5 h-4 w-4" /> PDF
                        </Button>
                        <Button
                            type="button"
                            variant={format === 'excel' ? 'default' : 'outline'}
                            className={native ? 'min-h-11 flex-1' : 'flex-1'}
                            disabled={generating}
                            onClick={() => setFormat('excel')}
                        >
                            <Sheet className="mr-1.5 h-4 w-4" /> Excel
                        </Button>
                    </div>

                    <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-900">
                                Packages ({selected.length} of {packages.length})
                            </p>
                            <button
                                type="button"
                                className="text-xs font-medium text-brand hover:underline"
                                disabled={generating || packages.length === 0}
                                onClick={toggleAll}
                            >
                                {allSelected ? 'Clear all' : 'Select all'}
                            </button>
                        </div>
                        <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                            {packages.length === 0 ? (
                                <p className="px-2 py-3 text-xs text-muted-foreground">No packages in this list.</p>
                            ) : (
                                packages.map((pkg) => (
                                    <label
                                        key={pkg.id}
                                        className={cn(
                                            'flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50',
                                            native && 'min-h-11 items-center'
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={selectedIds.has(pkg.id)}
                                            disabled={generating}
                                            onChange={() => toggle(pkg.id)}
                                        />
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium text-slate-900">{packageHeading(pkg)}</span>
                                            <span className="text-xs text-muted-foreground">{formatDate(pkg.package_date)}</span>
                                        </span>
                                    </label>
                                ))
                            )}
                        </div>
                    </div>

                    {selected.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <Label>Document title for each file</Label>
                                {selected.length > 1 && (
                                    <button
                                        type="button"
                                        className="text-xs font-medium text-brand hover:underline"
                                        disabled={generating}
                                        onClick={applyTitleToAll}
                                    >
                                        Use first title for all
                                    </button>
                                )}
                            </div>
                            {titleSuggestions.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-[11px] text-muted-foreground">
                                        Suggestions apply to the highlighted title
                                        {activeTitlePkg ? ` · ${packageHeading(activeTitlePkg)}` : ''}
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {titleSuggestions.slice(0, 8).map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                disabled={generating || !activeTitlePkg}
                                                onClick={() => {
                                                    if (!activeTitlePkg) return;
                                                    setTitles((prev) => ({ ...prev, [activeTitlePkg.id]: suggestion }));
                                                }}
                                                className={cn(
                                                    'max-w-full truncate rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                                                    titles[activeTitlePkg?.id] === suggestion
                                                        ? 'border-brand bg-brand-muted text-brand'
                                                        : 'border-border bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                                )}
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                                {selected.map((pkg) => (
                                    <div key={pkg.id} className="space-y-1.5">
                                        <p className="truncate text-xs text-muted-foreground">
                                            {packageHeading(pkg)} · {formatDate(pkg.package_date)}
                                        </p>
                                        <Input
                                            value={titles[pkg.id] || ''}
                                            onChange={(e) => setTitles((prev) => ({ ...prev, [pkg.id]: e.target.value }))}
                                            onFocus={() => setActiveTitleId(pkg.id)}
                                            placeholder="Document title"
                                            disabled={generating}
                                            required
                                            className={cn(
                                                activeTitlePkg?.id === pkg.id && 'border-brand ring-2 ring-brand/30'
                                            )}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={generating}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={generating || !titlesReady} onClick={handleDownload}>
                        {generating ? (
                            <>
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {progress || 'Preparing…'}
                            </>
                        ) : (
                            <>
                                <Download className="mr-1.5 h-4 w-4" />
                                Download {selected.length || ''} {format === 'pdf' ? 'PDF' : 'Excel'} file
                                {selected.length === 1 ? '' : 's'}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
