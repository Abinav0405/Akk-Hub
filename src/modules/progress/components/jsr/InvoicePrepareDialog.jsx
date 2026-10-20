import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { todayIso } from '@/modules/progress/lib/dates';
import { commercialWorkflow } from '@/modules/progress/lib/jsr';

export default function InvoicePrepareDialog({ open, kind, record, onClose, onDone }) {
  const certified =
    record?.client_certified_amount != null
      ? Number(record.client_certified_amount)
      : kind === 'jsr'
        ? Number(record?.total) || 0
        : Number(record?.this_month_total) || 0;
  const refDefault =
    kind === 'jsr'
      ? `Job Service Report ${record?.jsr_no || ''}`
      : `Monthly progress claim ${record?.claim_no || ''}`;
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [amount, setAmount] = useState(certified);
  const [reference, setReference] = useState(refDefault);
  const [notes, setNotes] = useState('Invoice based on client certified amount.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !record) return;
    setInvoiceNo('');
    setInvoiceDate(todayIso());
    setAmount(certified);
    setReference(refDefault);
    setNotes('Invoice based on client certified amount.');
  }, [open, record?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!(Number(amount) >= 0)) {
      toast.error('Enter the invoice amount');
      return;
    }
    setBusy(true);
    try {
      await commercialWorkflow(kind, record.id, 'prepare_invoice', {
        invoice_no: invoiceNo.trim() || null,
        invoice_date: invoiceDate,
        amount: Number(amount),
        reference,
        notes,
      });
      toast.success('Invoice prepared');
      onDone?.();
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not prepare invoice');
    } finally {
      setBusy(false);
    }
  };

  if (!record) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prepare invoice</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Invoice no. (leave blank to auto-number)</Label>
            <Input className="mt-1" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </div>
          <div>
            <Label>Invoice date</Label>
            <Input className="mt-1" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div>
            <Label>Invoice amount (S$)</Label>
            <Input className="mt-1" type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Reference</Label>
            <Input className="mt-1" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save invoice'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
