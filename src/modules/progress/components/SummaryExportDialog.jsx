import { useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { brandingLogoDataUrl, getCompanyBranding } from '@/modules/progress/lib/branding';
import { buildPackageSummaryPdfPages } from '@/modules/progress/lib/packagePdf';
import { noteExporterDownloads } from '@/modules/progress/lib/packageExport';
import { isNativeApp } from '@/core/platform';

export default function SummaryExportDialog({ packages, format, onClose, onExported, asExporter = false }) {
  const native = isNativeApp();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const isPdf = format === 'pdf';
  const count = packages?.length || 0;

  const handleDownload = async () => {
    if (!count) {
      toast.error('No packages in this list');
      return;
    }
    setGenerating(true);
    setProgress('Preparing summary…');
    try {
      const branding = await getCompanyBranding();
      const title = `Package summary (${count})`;
      let blob;
      let fileName;
      if (isPdf) {
        const logoSrc = await brandingLogoDataUrl(branding);
        const pages = buildPackageSummaryPdfPages({
          title,
          packages,
          logoSrc,
          companyName: branding.company_name,
          companyAddress: branding.company_address,
          documentChrome: branding.document_chrome,
        });
        const pdfMod = await import('@/modules/progress/lib/pdf');
        setProgress(native ? 'Rendering PDF…' : 'Rendering PDF…');
        blob = await pdfMod.buildPdfFromPages(pages);
        fileName = `PKG-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
      } else {
        const { buildPackageSummaryWorkbookBlob } = await import('@/modules/progress/lib/packageExcel');
        blob = await buildPackageSummaryWorkbookBlob({
          title,
          packages,
          companyName: branding.company_name,
          companyAddress: branding.company_address,
          logoSrc: await brandingLogoDataUrl(branding),
        });
        fileName = `PKG-summary-${new Date().toISOString().slice(0, 10)}.xlsx`;
      }

      setProgress(native ? 'Opening share sheet…' : 'Downloading…');
      const pdfMod = await import('@/modules/progress/lib/pdf');
      const result = await pdfMod.savePdfBlob(blob, fileName);
      if (result?.canceled) {
        toast.message('Export cancelled');
        return;
      }
      await noteExporterDownloads(packages.map((p) => p.id), isPdf ? 'pdf' : 'excel', { asExporter });
      onExported?.();
      toast.success(native ? 'Summary ready — pick Save or Drive' : 'Summary downloaded');
      onClose();
    } catch (e) {
      console.error('[SummaryExportDialog] failed:', e);
      toast.error(e.message || 'Could not export the summary');
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !generating && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export summary {isPdf ? 'PDF' : 'Excel'}</DialogTitle>
          <DialogDescription>
            One row per package in the current list — ID, site, date, status, completion %, photo counts, submitted by. Photos are not included.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-700">
          {count === 1 ? '1 package' : `${count} packages`} will be listed.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={generating}>
            Cancel
          </Button>
          <Button type="button" disabled={generating || count === 0} onClick={handleDownload}>
            {generating ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {progress || 'Preparing…'}
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-4 w-4" />
                Download summary
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
