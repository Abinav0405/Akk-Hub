import { toast } from 'sonner';
import { formatDate, formatDateTime } from '@/modules/progress/lib/dates';
import { cn } from '@/modules/progress/lib/utils';
import { clientAdjustment, fmtSignedMoney, jsrStatusBadgeClass, jsrStatusLabel, fmtMoney } from '@/modules/progress/lib/jsrStatus';
import { hasCertifiedAmount, roundMoney } from '@/modules/progress/lib/jsr';
import {
  commercialWorkflow,
  exporterGetClaim,
  exporterGetJsr,
  getClaim,
  getJsr,
  loadLinkedPhotosForExport,
  runPool,
} from '@/modules/progress/lib/jsr';
import { downloadJsrPdf, downloadClaimPdf, downloadInvoicePdf } from '@/modules/progress/lib/jsrPdf';
import { downloadJsrExcel, downloadClaimExcel, downloadInvoiceExcel } from '@/modules/progress/lib/jsrExcel';
import { CLAIM_PDF_PHOTO_FIT, JSR_PDF_PHOTO_FIT } from '@/modules/progress/lib/packagePdf';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';

export function StatusBadge({ status, kind }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', jsrStatusBadgeClass(status))}>
      {jsrStatusLabel(status, kind)}
    </span>
  );
}

export function Money({ value }) {
  return <span className="tabular-nums">$ {fmtMoney(value)}</span>;
}

/**
 * An amount that may have been changed by Export Only. Shows the certified figure, with the
 * originally submitted one struck through beneath it, so a list never keeps quoting the old
 * price after the client has certified a different one. With no (or an equal) certified
 * figure it is just the plain amount.
 */
export function CertifiedMoney({ submitted, certified, className }) {
  const original = roundMoney(submitted);
  const decided = hasCertifiedAmount(certified);
  const final = decided ? roundMoney(certified) : original;
  if (!decided || Math.abs(final - original) < 0.005) {
    return <span className={cn('tabular-nums', className)}>$ {fmtMoney(final)}</span>;
  }
  return (
    <span className={cn('inline-flex flex-col leading-tight', className)} title={`Submitted $ ${fmtMoney(original)} · certified $ ${fmtMoney(final)}`}>
      <span className="tabular-nums">$ {fmtMoney(final)}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground line-through">$ {fmtMoney(original)}</span>
    </span>
  );
}

export function LineCertificationTable({ rows, showRate = false }) {
  const list = rows || [];
  const hasLines = list.some((row) => hasCertifiedAmount(row.certifiedAmount));
  if (!hasLines) return null;
  const submitted = roundMoney(list.reduce((sum, row) => sum + (Number(row.originalAmount) || 0), 0));
  const certified = roundMoney(list.reduce((sum, row) => sum + (Number(hasCertifiedAmount(row.certifiedAmount) ? row.certifiedAmount : row.originalAmount) || 0), 0));
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Certified line prices</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Description</TableHead>
            {showRate ? <TableHead>Original qty</TableHead> : null}
            {showRate ? <TableHead>Certified qty</TableHead> : null}
            {showRate ? <TableHead>Original rate</TableHead> : null}
            {showRate ? <TableHead>Certified rate</TableHead> : null}
            <TableHead>Original amount</TableHead>
            <TableHead>Certified amount</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((row) => {
            const certifiedAmount = hasCertifiedAmount(row.certifiedAmount) ? Number(row.certifiedAmount) : null;
            const change = certifiedAmount == null ? null : clientAdjustment(row.originalAmount, certifiedAmount);
            return (
              <TableRow key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell>{row.detail || '—'}</TableCell>
                {showRate ? <TableCell>{row.originalQty ?? '—'}</TableCell> : null}
                {showRate ? <TableCell>{hasCertifiedAmount(row.certifiedQty) ? Number(row.certifiedQty) : '—'}</TableCell> : null}
                {showRate ? <TableCell><Money value={row.originalRate} /></TableCell> : null}
                {showRate ? <TableCell>{hasCertifiedAmount(row.certifiedRate) ? <Money value={row.certifiedRate} /> : '—'}</TableCell> : null}
                <TableCell><Money value={row.originalAmount} /></TableCell>
                <TableCell>{certifiedAmount == null ? '—' : <Money value={certifiedAmount} />}</TableCell>
                <TableCell className={cn(change?.delta > 0 && 'text-emerald-700', change?.delta < 0 && 'text-red-700')}>
                  {change == null ? '—' : `$ ${fmtSignedMoney(change.delta)}`}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-right text-sm">
        Submitted <Money value={submitted} /> · Certified <Money value={certified} />
        {clientAdjustment(submitted, certified).amount ? (
          <> · {clientAdjustment(submitted, certified).label} <Money value={clientAdjustment(submitted, certified).amount} /></>
        ) : ' · No change'}
      </p>
    </div>
  );
}

/** The server logs the internal step as "Approved (internal)"; it is a review, not an approval. */
function historyActionLabel(action) {
  return String(action || '').replace(/^Approved \(internal\)$/, 'Reviewed (internal)');
}

export function HistoryTable({ history }) {
  if (!history?.length) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-semibold">History / audit trail</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="whitespace-nowrap text-xs">{formatDateTime(h.at, { seconds: false })}</TableCell>
              <TableCell className="text-xs">{h.actor_name}</TableCell>
              <TableCell className="text-xs font-medium">{historyActionLabel(h.action)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{h.details || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export async function runWorkflow(kind, id, action, payload, onDone) {
  try {
    await commercialWorkflow(kind, id, action, payload);
    toast.success('Updated');
    onDone?.();
  } catch (e) {
    toast.error(e.message || 'Could not update');
  }
}

/** JSR Excel photos: 3× the PDF cell size at high JPEG quality. */
const EXCEL_PHOTO_FIT = { scale: 3, quality: 0.92 };

export async function exportRecord(kind, id, format, { asExporter = false, record } = {}) {
  const isPdf = format !== 'excel';
  const toastId = toast.loading(isPdf ? 'Building PDF…' : 'Building Excel…');
  const report = (msg) => toast.loading(msg, { id: toastId });
  try {
    if (kind === 'jsr') {
      const rec = record?.id === id ? record : asExporter ? await exporterGetJsr(id) : await getJsr(id);
      const photos = await loadLinkedPhotosForExport('jsr', id, {
        asExporter,
        // Excel shows each photo larger and without the PDF's compression budget: sharper copy.
        fit: isPdf ? JSR_PDF_PHOTO_FIT : EXCEL_PHOTO_FIT,
        onProgress: (done, total) => report(`Loading photos ${done} of ${total}…`),
      });
      if (format === 'excel') await downloadJsrExcel(rec, photos);
      else {
        await downloadJsrPdf(rec, photos, {
          print: format === 'print',
          onProgress: (page, total) => report(`Building PDF… page ${page} of ${total}`),
        });
      }
    } else if (kind === 'claim') {
      const rec = record?.id === id ? record : asExporter ? await exporterGetClaim(id) : await getClaim(id);
      const nested = [];
      const photosByJsrId = {};
      if (rec.include_jsr_details) {
        const rows = rec.jsrs || [];
        const loaded = await runPool(rows, 3, async (row, index) => {
          report(`Loading JSR ${index + 1} of ${rows.length}…`);
          try {
            const full = asExporter ? await exporterGetJsr(row.id) : await getJsr(row.id);
            let photos = [];
            if (rec.include_photos) {
              photos = await loadLinkedPhotosForExport('jsr', row.id, {
                asExporter,
                fit: CLAIM_PDF_PHOTO_FIT,
              });
            }
            return { full, photos };
          } catch {
            return {
              full: {
                ...row,
                items: [],
                company: rec.company,
                contract: rec.contract,
                site: { name: row.site_name },
              },
              photos: [],
            };
          }
        });
        loaded.forEach(({ full, photos }) => {
          nested.push(full);
          if (photos?.length) photosByJsrId[full.id] = photos;
        });
      }
      if (format === 'excel') await downloadClaimExcel(rec, nested);
      else {
        await downloadClaimPdf(rec, nested, photosByJsrId, {
          print: format === 'print',
          onProgress: (page, total) => report(`Building PDF… page ${page} of ${total}`),
        });
      }
    } else {
      const rec = record?.id === id
        ? record
        : asExporter
          ? await exporterGetJsr(id).catch(() => null)
          : await getJsr(id).catch(() => null);
      if (!rec) {
        toast.dismiss(toastId);
        return;
      }
      if (format === 'excel') await downloadInvoiceExcel('jsr', rec);
      else {
        await downloadInvoicePdf('jsr', rec, {
          print: format === 'print',
          onProgress: (page, total) => report(`Building PDF… page ${page} of ${total}`),
        });
      }
    }
    toast.success(format === 'print' ? 'Opening print dialog…' : format === 'excel' ? 'Excel ready' : 'PDF ready', {
      id: toastId,
    });
  } catch (e) {
    toast.error(e.message || 'Could not export', { id: toastId });
  }
}

export async function exportInvoice(kind, record, format) {
  try {
    if (format === 'excel') await downloadInvoiceExcel(kind, record);
    else await downloadInvoicePdf(kind, record, { print: format === 'print' });
  } catch (e) {
    toast.error(e.message || 'Could not export invoice');
  }
}

export { formatDate, fmtMoney };
