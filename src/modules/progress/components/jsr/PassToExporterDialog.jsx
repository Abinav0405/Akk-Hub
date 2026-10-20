import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { commercialWorkflow, defaultJsrSignoff, jsrExporterIds, jsrHasExporters, listStaffExporters, loadLinkedPhotosForExport } from '@/modules/progress/lib/jsr';
import { buildJsrPdfBlob } from '@/modules/progress/lib/jsrPdf';
import { JSR_PDF_PHOTO_FIT } from '@/modules/progress/lib/packagePdf';
import EndorsementDialog from '@/modules/progress/components/EndorsementDialog';
import SignoffFields from '@/modules/progress/components/jsr/SignoffFields';

const EMPTY_SIGNOFF = {
  submitted_by_name: '',
  submitted_by_company: '',
  checked_by_title: '',
  checked_by_name: '',
  checked_by_company: '',
};

function recordLabel(kind, record) {
  if (kind === 'claim') return record?.claim_no || 'this claim';
  return record?.jsr_no || 'this JSR';
}

export default function PassToExporterDialog({
  open,
  action = 'pass_to_client',
  kind = 'jsr',
  record,
  onClose,
  onDone,
  children,
  buildPdfBlob: buildPdfBlobProp,
}) {
  const [exporters, setExporters] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [signoff, setSignoff] = useState(EMPTY_SIGNOFF);
  const [busy, setBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const assigning = action === 'assign_exporter';
  const submittingInvoice = action === 'submit_invoice';
  const needsSignoff = !assigning && !submittingInvoice;
  const hadAssignment = jsrHasExporters(record);
  const label = recordLabel(kind, record);
  const endorsementKind = kind === 'claim' ? 'jsr_claim' : 'jsr';

  useEffect(() => {
    if (!open) return;
    setSelectedIds(jsrExporterIds(record));
    setSignoff(defaultJsrSignoff(record));
    listStaffExporters()
      .then(setExporters)
      .catch((e) => {
        toast.error(e.message || 'Could not load Export Only accounts');
        setExporters([]);
      });
  }, [open, record?.id]);

  const selectedRows = useMemo(() => {
    const list = exporters || [];
    return selectedIds
      .map((id) => list.find((row) => String(row.id) === String(id)))
      .filter(Boolean);
  }, [exporters, selectedIds]);

  const setField = (key, value) => setSignoff((prev) => ({ ...prev, [key]: value }));

  const toggleId = (id) => {
    const key = String(id);
    setSelectedIds((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const workflowPayload = () => {
    const base = {
      exporter_ids: selectedIds,
      exporter_id: selectedIds[0],
      exporter_names: selectedRows.map((row) => row.display_name),
    };
    if (submittingInvoice) return base;
    return {
      ...base,
      submitted_by_name: signoff.submitted_by_name,
      submitted_by_company: signoff.submitted_by_company,
      checked_by_title: signoff.checked_by_title,
      checked_by_name: signoff.checked_by_name,
      checked_by_company: signoff.checked_by_company,
    };
  };

  const successMessage = () => {
    if (assigning) return hadAssignment ? 'Export Only IDs updated' : 'Export Only IDs assigned';
    if (submittingInvoice) {
      return selectedIds.length === 1
        ? 'Invoice submitted to client'
        : `Invoice submitted to ${selectedIds.length} Export Only IDs`;
    }
    return selectedIds.length === 1 ? 'Passed to client' : `Passed to ${selectedIds.length} Export Only IDs`;
  };

  const commitWorkflow = async () => {
    setBusy(true);
    try {
      await commercialWorkflow(kind, record.id, action, workflowPayload());
      toast.success(successMessage());
      onDone?.();
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one Export Only ID');
      return;
    }
    if (needsSignoff) {
      setSignOpen(true);
      return;
    }
    await commitWorkflow();
  };

  /** Pass to client after the signature is saved. Throws on failure so the signature is undone. */
  const passAfterSigning = async () => {
    await commercialWorkflow(kind, record.id, action, workflowPayload());
    toast.success(successMessage());
  };

  const buildPdfBlob = async () => {
    if (buildPdfBlobProp) return buildPdfBlobProp({ ...record, ...signoff });
    const photos = await loadLinkedPhotosForExport(kind, record.id, {
      fit: kind === 'jsr' ? JSR_PDF_PHOTO_FIT : undefined,
    });
    return buildJsrPdfBlob({ ...record, ...signoff }, photos);
  };

  const helpText = (() => {
    if (assigning) {
      return `Choose one or more Export Only logins that can see ${label}. Only the IDs you tick receive it — other Export Only accounts will not see it.`;
    }
    if (submittingInvoice) {
      return `Invoice for ${label} will be visible only to the Export Only IDs you select. It is not sent to every client login.`;
    }
    return `${kind === 'claim' ? 'Claim' : 'JSR'} ${label} will be visible and certifiable only to the Export Only IDs you select. It is not sent to every client login.`;
  })();

  const title = (() => {
    if (assigning) return hadAssignment ? 'Change Export Only IDs' : 'Assign Export Only IDs';
    if (submittingInvoice) return 'Submit invoice to client';
    return 'Pass to client';
  })();

  const confirmLabel = (() => {
    if (assigning) return hadAssignment ? 'Change' : 'Assign';
    if (submittingInvoice) return 'Submit invoice';
    return 'Pass to client';
  })();

  if (!record) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{helpText}</p>
        <div>
          <Label>Export Only IDs</Label>
          {selectedRows.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
                  onClick={() => toggleId(row.id)}
                >
                  {row.display_name}
                  <span className="ml-1 text-muted-foreground">×</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-input">
            {(exporters || []).map((row) => {
              const checked = selectedIds.includes(String(row.id));
              return (
                <label
                  key={row.id}
                  className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleId(row.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{row.display_name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{row.id}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {exporters?.length === 0 ? (
            <p className="mt-2 text-sm text-amber-800">
              No active Export Only accounts. Add one under Export Only Logins first.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Select at least one. Confirming updates the assigned set only — it does not broadcast to every Export Only login.
            </p>
          )}
        </div>
        {needsSignoff || assigning ? <SignoffFields value={signoff} onChange={setField} /> : null}
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !selectedIds.length} onClick={save}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {needsSignoff ? (
      <EndorsementDialog
        open={signOpen}
        kind={endorsementKind}
        documentId={record.id}
        companyId={record.company_id || record.company?.id}
        buildPdfBlob={buildPdfBlob}
        replaceExisting
        title={kind === 'claim' ? 'Sign or stamp before passing the claim' : 'Sign or stamp before passing to the client'}
        allowSkip={false}
        confirmLabel="Add and pass to client"
        onCommit={passAfterSigning}
        onClose={() => setSignOpen(false)}
        onDone={() => {
          setSignOpen(false);
          onDone?.();
          onClose?.();
        }}
      />
    ) : null}
    </>
  );
}
