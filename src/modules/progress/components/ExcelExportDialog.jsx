import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Share2, Sheet } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { getSignedUrl } from '@/modules/progress/lib/staffPackages';
import { getPackageImagesForViewer, noteExporterDownloads, packageExportMeta } from '@/modules/progress/lib/packageExport';
import { listDocumentTitles, recordDocumentTitleUse } from '@/modules/progress/lib/documentTitles';
import { formatDate } from '@/modules/progress/lib/dates';
import { buildPackageAutoTitle, buildReportDocumentName, cleanExportFileName } from '@/modules/progress/lib/packagePdf';
import ExportFileNameField from '@/modules/progress/components/ExportFileNameField';
import { brandingLogoDataUrl, getCompanyBranding } from '@/modules/progress/lib/branding';
import { blobUrlToDataUrl } from '@/modules/progress/lib/imageDataUrl';
import { cn } from '@/modules/progress/lib/utils';
import { isNativeApp } from '@/core/platform';
import { packageHeading } from '@/modules/progress/lib/sectionLabel';

export default function ExcelExportDialog({ pkg, onClose, onExported, asExporter = false }) {
    const native = isNativeApp();
    // Both start as description, section name, street name and stay editable.
    const autoTitle = useMemo(() => buildPackageAutoTitle(packageExportMeta(pkg)), [pkg]);
    const autoFileName = useMemo(() => buildReportDocumentName(packageExportMeta(pkg)), [pkg]);
    const [title, setTitle] = useState(autoTitle);
    const [fileName, setFileName] = useState(autoFileName);
    const [titleSuggestions, setTitleSuggestions] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState('');

    useEffect(() => {
        listDocumentTitles({ asExporter }).then(setTitleSuggestions).catch(() => {});
    }, [asExporter]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            toast.error('Enter a title for this document');
            return;
        }

        setGenerating(true);
        setProgress('Loading photos…');
        try {
            const images = await getPackageImagesForViewer(pkg.id, { asExporter });
            if (images.length === 0) {
                toast.error('This package has no photos yet');
                return;
            }

            const rawResults = await Promise.all(
                images.map(async (img) => {
                    try {
                        const url = await getSignedUrl(img.storage_path);
                        const dataUrl = await blobUrlToDataUrl(url);
                        return { stage: img.stage, dataUrl, caption: img.caption || '' };
                    } catch (e) {
                        console.warn('[ExcelExportDialog] skipping a photo that failed to load:', img.storage_path, e);
                        return null;
                    }
                })
            );
            const loaded = rawResults.filter(Boolean);
            if (loaded.length < images.length) {
                toast.error(`${images.length - loaded.length} photo(s) could not be loaded and were skipped`);
            }

            setProgress('Preparing workbook…');
            const stagePhotos = { before: [], during: [], after: [], completion: [] };
            loaded.forEach((row) => {
                if (stagePhotos[row.stage]) stagePhotos[row.stage].push({ dataUrl: row.dataUrl, caption: row.caption || '' });
            });

            const branding = await getCompanyBranding();
            const logoSrc = await brandingLogoDataUrl(branding);
            const { buildPackageWorkbookBlob } = await import('@/modules/progress/lib/packageExcel');
            const blob = await buildPackageWorkbookBlob({
                title: trimmedTitle,
                displayId: pkg.display_id,
                packageDate: pkg.package_date,
                siteName: pkg.site?.name || pkg.site_name,
                lcbId: pkg.lcb_id,
                sectionLabel: pkg.section_label,
                companyName: branding.company_name,
                companyAddress: branding.company_address,
                logoSrc,
                stagePhotos,
                description: pkg.description,
            });

            setProgress(native ? 'Opening share sheet…' : 'Downloading…');
            const { savePdfBlob } = await import('@/modules/progress/lib/pdf');
            const result = await savePdfBlob(blob, `${cleanExportFileName(fileName) || autoFileName}.xlsx`);
            if (result?.canceled) {
                toast.message('Export cancelled');
                return;
            }
            recordDocumentTitleUse(trimmedTitle, { asExporter }).catch(() => {});
            if (native) toast.success('Excel file ready — pick Save or Drive');
            await noteExporterDownloads([pkg.id], 'excel', { asExporter });
            onExported?.();
            onClose();
        } catch (e2) {
            console.error('[ExcelExportDialog] Excel export failed:', e2);
            toast.error(e2.message || 'Could not generate the Excel file');
        } finally {
            setGenerating(false);
            setProgress('');
        }
    };

    const heading = useMemo(() => packageHeading(pkg), [pkg]);

    return (
        <Dialog open onOpenChange={(open) => !open && !generating && onClose()}>
            <DialogContent className="max-w-lg min-w-0 overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle>Export to Excel</DialogTitle>
                    <DialogDescription>
                        {heading} · {formatDate(pkg.package_date)}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="excel-doc-title">Document title</Label>
                        <Input
                            id="excel-doc-title"
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
                        id="excel-file-name"
                        value={fileName}
                        onChange={setFileName}
                        autoValue={autoFileName}
                        extension=".xlsx"
                        disabled={generating}
                        showReset={Boolean(autoTitle) && (title !== autoTitle || fileName !== autoFileName)}
                        onReset={() => {
                            setTitle(autoTitle);
                            setFileName(autoFileName);
                        }}
                    />
                    <p className="text-xs text-muted-foreground">
                        Builds an .xlsx report with the site/section/date header and every photo embedded two-per-row by stage — the same layout as the original manual reports.
                    </p>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={generating}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={generating || !title.trim()}>
                            {generating ? (
                                <>
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {progress || 'Preparing…'}
                                </>
                            ) : native ? (
                                <>
                                    <Share2 className="mr-1.5 h-4 w-4" /> Save Excel file
                                </>
                            ) : (
                                <>
                                    <Sheet className="mr-1.5 h-4 w-4" /> Download Excel
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
