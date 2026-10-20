import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import {
  clientCanRespond,
  clientResponseIsFinal,
  clientAdjustment,
  clientResponseLabel,
  fmtMoney,
  fmtSignedMoney,
} from '@/modules/progress/lib/jsrStatus';
import { exporterGetJsr, exporterRespond, exporterStartReview, hasCertifiedAmount, loadLinkedPhotosForExport, roundMoney, runPool, uploadClientAttachment } from '@/modules/progress/lib/jsr';
import { CLAIM_PDF_PHOTO_FIT, JSR_PDF_PHOTO_FIT } from '@/modules/progress/lib/packagePdf';
import { buildClaimPdfBlob, buildJsrPdfBlob } from '@/modules/progress/lib/jsrPdf';
import { commercialDocumentKind } from '@/modules/progress/lib/documentAudit';
import EndorsementDialog from '@/modules/progress/components/EndorsementDialog';
import { getStoredExporterName } from '@/core/auth/progress/exporterSession';
import { Money } from '@/modules/progress/components/jsr/shared';

function seedLines(kind, record) {
  if (kind === 'jsr') {
    return (record?.items || []).map((it) => {
      const qty = Number(it.qty) || 0;
      const rate = Number(it.rate) || 0;
      const amount = Number(it.amount) || 0;
      return {
        id: it.id,
        code: it.code || '',
        description: it.description || '',
        unit: it.unit || '',
        qty,
        rate,
        amount,
        certified_qty: hasCertifiedAmount(it.certified_qty) ? Number(it.certified_qty) : qty,
        certified_rate: hasCertifiedAmount(it.certified_rate) ? Number(it.certified_rate) : rate,
        certified_amount: hasCertifiedAmount(it.certified_amount) ? Number(it.certified_amount) : amount,
      };
    });
  }
  return (record?.jsrs || []).map((row) => {
    const amount = Number(row.total) || 0;
    const certified = hasCertifiedAmount(row.certified_amount) ? Number(row.certified_amount) : amount;
    return {
      id: row.id,
      code: row.jsr_no || '',
      description: [row.wo_ref, row.site_name].filter(Boolean).join(' · '),
      unit: '',
      qty: 1,
      rate: amount,
      amount,
      certified_qty: 1,
      certified_rate: certified,
      certified_amount: certified,
    };
  });
}

export default function ClientReviewDialog({ open, kind, record, onClose, onDone }) {
  const submitted = kind === 'jsr' ? Number(record?.total) || 0 : Number(record?.this_month_total) || 0;
  const locked = Boolean(record && clientResponseIsFinal(record.status));
  const [response, setResponse] = useState(record?.client_response || 'approved');
  const [amount, setAmount] = useState(record?.client_certified_amount ?? submitted);
  const [reason, setReason] = useState(record?.client_reason || '');
  const [comments, setComments] = useState(record?.client_comments || '');
  const [files, setFiles] = useState([]);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  useEffect(() => {
    if (!open || !record) return;
    if (clientCanRespond(record.status)) {
      exporterStartReview(kind, record.id).catch(() => {});
    }
    setResponse(record.client_response || 'approved');
    setAmount(record.client_certified_amount ?? submitted);
    setReason(record.client_reason || '');
    setComments(record.client_comments || '');
    setLines(seedLines(kind, record));
    setFiles([]);
  }, [open, kind, record?.id, record?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const certifiedTotal = useMemo(() => {
    if (!lines.length) return roundMoney(amount);
    return roundMoney(lines.reduce((sum, line) => sum + (Number(line.certified_amount) || 0), 0));
  }, [lines, amount]);
  // The client can raise a price (addition) as well as lower it (deduction).
  const adjustment = useMemo(() => clientAdjustment(submitted, certifiedTotal), [submitted, certifiedTotal]);

  const onResp = (v) => {
    if (locked) return;
    if (v === 'rejected') {
      setAmount(0);
      setLines((prev) => prev.map((line) => ({ ...line, certified_rate: 0, certified_amount: 0 })));
    } else if (response === 'rejected') {
      setAmount(submitted);
      setLines(seedLines(kind, record));
    }
    setResponse(v);
  };

  // Quantity, unit price and amount are each the client's own figure — changing one
  // never rewrites the others. Kept as typed (so "12." can be finished) and read as numbers.
  const setLineField = (id, field, value) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  };

  const pricedRecord = () => {
    const certified = response === 'rejected' ? 0 : certifiedTotal;
    if (kind === 'jsr') {
      const items = (record.items || []).map((it) => {
        const line = lines.find((row) => row.id === it.id);
        return line
          ? {
            ...it,
            certified_qty: Number(line.certified_qty) || 0,
            certified_rate: roundMoney(line.certified_rate),
            certified_amount: roundMoney(line.certified_amount),
          }
          : it;
      });
      return {
        ...record,
        items,
        client_response: response,
        client_submitted_amount: submitted,
        client_certified_amount: certified,
      };
    }
    const jsrs = (record.jsrs || []).map((row) => {
      const line = lines.find((item) => item.id === row.id);
      return line ? { ...row, certified_amount: roundMoney(line.certified_amount) } : row;
    });
    return {
      ...record,
      jsrs,
      client_response: response,
      client_submitted_amount: submitted,
      client_certified_amount: certified,
    };
  };

  const submit = async () => {
    if (locked || !clientCanRespond(record?.status)) {
      toast.error('A response has already been submitted for this record');
      return;
    }
    if (response !== 'reply' && !(Number(lines.length ? certifiedTotal : amount) >= 0)) {
      toast.error('Enter the certified amount');
      return;
    }
    const badLine = response !== 'reply' && lines.find((line) => (
      [line.certified_qty, line.certified_rate, line.certified_amount].some((v) => String(v).trim() === '' || !(Number(v) >= 0))
    ));
    if (badLine) {
      toast.error(`${badLine.code || 'A line'}: enter a quantity, unit price and amount of 0 or more`);
      return;
    }
    if ((response === 'rejected' || response === 'partial') && !reason.trim()) {
      toast.error('A reason is required for rejection or partial certification');
      return;
    }
    if (response === 'reply' && !comments.trim() && !files.length) {
      toast.error('Add a comment or attachment for your reply');
      return;
    }
    if (response !== 'reply') {
      setSignOpen(true);
      return;
    }
    await commitResponse();
  };

  /** Sends the response. Throws on failure (the signing dialog then undoes the signature). */
  const sendResponse = async () => {
    if (locked || !clientCanRespond(record?.status)) {
      throw new Error('A response has already been submitted for this record');
    }
    const attachments = [];
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 2 MB and was skipped`);
        continue;
      }
      attachments.push(await uploadClientAttachment(record.id, file));
    }
    const certified = response === 'rejected' ? 0 : certifiedTotal;
    await exporterRespond(kind, record.id, {
      response,
      certified_amount: response === 'reply' ? null : certified,
      reason: reason.trim(),
      comments: comments.trim(),
      attachments,
      lines: response === 'reply' ? [] : lines.map((line) => ({
        id: line.id,
        ...(kind === 'jsr' ? { certified_qty: Number(line.certified_qty) || 0 } : {}),
        certified_rate: roundMoney(line.certified_rate),
        certified_amount: roundMoney(line.certified_amount),
      })),
    });
    toast.success('Response sent');
  };

  const commitResponse = async () => {
    setBusy(true);
    try {
      await sendResponse();
      onDone?.();
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not submit response');
    } finally {
      setBusy(false);
    }
  };

  const buildPdfBlob = async () => {
    const priced = pricedRecord();
    if (kind === 'jsr') {
      const photos = await loadLinkedPhotosForExport('jsr', record.id, {
        asExporter: true,
        fit: JSR_PDF_PHOTO_FIT,
      });
      return buildJsrPdfBlob(priced, photos);
    }
    const nested = [];
    const photosByJsrId = {};
    if (record.include_jsr_details) {
      const rows = record.jsrs || [];
      const loaded = await runPool(rows, 3, async (row) => {
        try {
          const full = await exporterGetJsr(row.id);
          const photos = record.include_photos
            ? await loadLinkedPhotosForExport('jsr', row.id, { asExporter: true, fit: CLAIM_PDF_PHOTO_FIT })
            : [];
          return { full, photos };
        } catch {
          return { full: { ...row, items: [], company: record.company, contract: record.contract }, photos: [] };
        }
      });
      loaded.forEach(({ full, photos }) => {
        nested.push(full);
        if (photos?.length) photosByJsrId[full.id] = photos;
      });
    }
    return buildClaimPdfBlob(priced, nested, photosByJsrId);
  };

  if (!record) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Review {kind === 'jsr' ? record.jsr_no : record.claim_no}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Submitted amount: <Money value={submitted} />
        </p>
        {locked ? (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-semibold">Response already submitted</p>
            <p>
              <span className="text-muted-foreground">Decision:</span>{' '}
              {clientResponseLabel(record.client_response)}
            </p>
            {record.client_certified_amount != null ? (
              <p>
                <span className="text-muted-foreground">Certified amount:</span>{' '}
                <Money value={record.client_certified_amount} />
              </p>
            ) : null}
            {record.client_reason ? (
              <p>
                <span className="text-muted-foreground">Reason:</span> {record.client_reason}
              </p>
            ) : null}
            {record.client_comments ? (
              <p>
                <span className="text-muted-foreground">Comments:</span> {record.client_comments}
              </p>
            ) : null}
            {record.client_responded_at ? (
              <p className="text-xs text-muted-foreground">
                Submitted {new Date(record.client_responded_at).toLocaleString()}
                {record.client_responded_by_name ? ` by ${record.client_responded_by_name}` : ''}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Response</Label>
              <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={response} onChange={(e) => onResp(e.target.value)}>
                <option value="approved">Approved</option>
                <option value="certified">Certified</option>
                <option value="partial">Revised (addition / deduction)</option>
                <option value="rejected">Rejected</option>
                <option value="reply">Reply / comment only</option>
              </select>
            </div>
            <div>
              <Label>Certified amount (S$)</Label>
              {lines.length ? (
                <p className="mt-2 text-sm font-semibold"><Money value={certifiedTotal} /></p>
              ) : (
                <Input className="mt-1" type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              )}
              <p className={`mt-1 text-xs ${adjustment.delta > 0 ? 'text-emerald-700' : adjustment.delta < 0 ? 'text-red-700' : 'text-muted-foreground'}`}>
                {adjustment.label}{adjustment.amount ? `: $ ${fmtMoney(adjustment.amount)}` : ''}
              </p>
            </div>
            {lines.length ? (
              <div className="sm:col-span-2 overflow-x-auto">
                <Label>{kind === 'jsr' ? 'Line prices' : 'JSR amounts'}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {kind === 'jsr'
                    ? 'Raise or lower the quantity, unit price or amount on any line — each one is kept exactly as you enter it. The certified total is the sum of the amounts; a higher total is an addition, a lower one a deduction.'
                    : 'Raise or lower the amount on any JSR. The certified total is the sum of those amounts; a higher total is an addition, a lower one a deduction.'}
                </p>
                <table className="mt-2 w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Item</th>
                      <th className="py-1 pr-2 font-medium">Description</th>
                      {kind === 'jsr' ? <th className="py-1 pr-2 font-medium">Qty</th> : null}
                      {kind === 'jsr' ? <th className="py-1 pr-2 font-medium">Unit price (S$)</th> : null}
                      <th className="py-1 pr-2 font-medium">Amount (S$)</th>
                      <th className="py-1 font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-b border-border/70 align-top">
                        <td className="py-2 pr-2">{line.code}</td>
                        <td className="py-2 pr-2">{line.description}</td>
                        {kind === 'jsr' ? (
                          <td className="py-2 pr-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min="0"
                              className="h-9 min-w-[4.5rem]"
                              aria-label={`Quantity for ${line.code}`}
                              value={line.certified_qty}
                              onChange={(e) => setLineField(line.id, 'certified_qty', e.target.value)}
                            />
                            <span className="mt-1 block text-[11px] text-muted-foreground">Was {line.qty} {line.unit}</span>
                          </td>
                        ) : null}
                        {kind === 'jsr' ? (
                          <td className="py-2 pr-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min="0"
                              className="h-9"
                              aria-label={`Unit price for ${line.code}`}
                              value={line.certified_rate}
                              onChange={(e) => setLineField(line.id, 'certified_rate', e.target.value)}
                            />
                            <span className="mt-1 block text-[11px] text-muted-foreground">Was {fmtMoney(line.rate)}</span>
                          </td>
                        ) : null}
                        <td className="py-2 pr-2">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            className="h-9"
                            inputMode="decimal"
                            aria-label={`Amount for ${line.code}`}
                            value={line.certified_amount}
                            onChange={(e) => setLineField(line.id, 'certified_amount', e.target.value)}
                          />
                          <span className="mt-1 block text-[11px] text-muted-foreground">Was {fmtMoney(line.amount)}</span>
                        </td>
                        {(() => {
                          const change = clientAdjustment(line.amount, line.certified_amount);
                          return (
                            <td className={`py-2 whitespace-nowrap ${change.delta > 0 ? 'text-emerald-700' : change.delta < 0 ? 'text-red-700' : ''}`}>
                              {fmtSignedMoney(change.delta)}
                              {change.delta ? <span className="block text-[11px] text-muted-foreground">{change.label}</span> : null}
                            </td>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Label>Reason for the change (addition / deduction) or rejection</Label>
              <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Comments / instructions</Label>
              <Textarea className="mt-1" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Attachments (payment cert, rejection letter…)</Label>
              <Input className="mt-1" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!locked ? (
            <Button disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Submit response'}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <EndorsementDialog
      open={signOpen}
      kind={commercialDocumentKind(kind)}
      documentId={record.id}
      companyId={record.company_id || record.company?.id}
      buildPdfBlob={buildPdfBlob}
      replaceExisting
      title="Sign or stamp before certifying"
      allowSkip={false}
      confirmLabel="Add and submit response"
      signerName={getStoredExporterName()}
      showSignerName={false}
      canRemoveExisting={false}
      onClose={() => setSignOpen(false)}
      onCommit={sendResponse}
      onDone={() => {
        setSignOpen(false);
        onDone?.();
        onClose?.();
      }}
    />
    </>
  );
}
