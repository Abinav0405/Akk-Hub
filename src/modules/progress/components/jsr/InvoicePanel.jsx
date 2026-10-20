import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { formatDate } from '@/modules/progress/lib/dates';
import { listInvoices, getJsr, getClaim } from '@/modules/progress/lib/jsr';
import { StatusBadge, Money, exportInvoice } from '@/modules/progress/components/jsr/shared';

export default function InvoicePanel() {
  const [rows, setRows] = useState(null);

  const refresh = () => {
    listInvoices()
      .then(setRows)
      .catch((e) => {
        toast.error(e.message || 'Could not load invoices');
        setRows([]);
      });
  };

  useEffect(refresh, []);

  const download = async (row, format) => {
    try {
      const rec = row.entity_type === 'jsr' ? await getJsr(row.entity_id) : await getClaim(row.entity_id);
      await exportInvoice(row.entity_type, rec, format);
    } catch (e) {
      toast.error(e.message || 'Could not export invoice');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Invoices</h2>
        <p className="text-sm text-muted-foreground">Prepared from the client certified amount after payment certificate.</p>
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice no</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No invoices yet.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.invoice_no}</TableCell>
                <TableCell>{r.reference_no}</TableCell>
                <TableCell>{formatDate(r.invoice_date)}</TableCell>
                <TableCell><Money value={r.amount} /></TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => download(r, 'print')}>PDF</Button>
                  <Button size="sm" variant="ghost" onClick={() => download(r, 'excel')}>Excel</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
