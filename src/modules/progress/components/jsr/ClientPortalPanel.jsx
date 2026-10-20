import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import { formatDate } from '@/modules/progress/lib/dates';
import {
  exporterListJsrs,
  exporterListClaims,
  exporterListInvoices,
  exporterGetJsr,
  exporterGetClaim,
  exporterGetInvoice,
  signedAttachmentUrl,
} from '@/modules/progress/lib/jsr';
import { monthName, clientCanRespond, clientResponseLabel } from '@/modules/progress/lib/jsrStatus';
import { StatusBadge, Money, CertifiedMoney, exportRecord, exportInvoice } from '@/modules/progress/components/jsr/shared';
import WorkflowBar from '@/modules/progress/components/jsr/WorkflowBar';
import ClientReviewDialog from '@/modules/progress/components/jsr/ClientReviewDialog';

export default function ClientPortalPanel() {
  const [jsrs, setJsrs] = useState([]);
  const [claims, setClaims] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [review, setReview] = useState(null);

  const refresh = () => {
    Promise.all([exporterListJsrs(), exporterListClaims(), exporterListInvoices()])
      .then(([j, c, i]) => {
        setJsrs(j);
        setClaims(c);
        setInvoices(i);
      })
      .catch((e) => toast.error(e.message || 'Could not load client reports'));
  };

  useEffect(refresh, []);

  const filteredJsrs = useMemo(
    () => jsrs.filter((r) => matchesQuery([r.jsr_no, r.summary, r.first_package?.display_id, r.site_name, r.location, r.sc_work], search)),
    [jsrs, search]
  );

  const openJsr = async (id) => {
    try {
      setDetail({ kind: 'jsr', rec: await exporterGetJsr(id) });
    } catch (e) {
      toast.error(e.message || 'Could not open JSR');
    }
  };

  const openClaim = async (id) => {
    try {
      setDetail({ kind: 'claim', rec: await exporterGetClaim(id) });
    } catch (e) {
      toast.error(e.message || 'Could not open claim');
    }
  };

  const rec = detail?.rec;
  // Once Export Only has certified (not just replied), their own view shows the certified prices too.
  const priced = Boolean(rec?.client_response && rec.client_response !== 'reply');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Client Report Portal</h2>
        <p className="text-sm text-muted-foreground">Review JSRs and claims sent to you, then download or reply.</p>
      </div>
      <SearchField value={search} onChange={setSearch} placeholder="Search JSR no. / location" />

      <Card className="p-0">
        <h3 className="p-4 text-sm font-semibold">Job Service Reports ({filteredJsrs.length})</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>JSR No</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredJsrs.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No JSRs submitted for review yet.</TableCell></TableRow>
            ) : filteredJsrs.map((r) => (
              <TableRow key={r.id}>
<TableCell className="min-w-[12rem] max-w-[22rem]">
                  {/* First package's description + section (0077); the JSR location otherwise. */}
                  {r.summary || r.location ? (
                    <div className="line-clamp-2 break-words text-sm font-semibold text-slate-900" title={r.summary || r.location}>{r.summary || r.location}</div>
                  ) : null}
                  <div className={r.summary || r.location ? 'mt-0.5 text-xs font-medium text-muted-foreground' : 'font-medium'}>{r.jsr_no}</div>
                </TableCell>
                <TableCell>{r.site_name}</TableCell>
                <TableCell>{formatDate(r.jsr_date)}</TableCell>
                <TableCell><CertifiedMoney submitted={r.total} certified={r.client_certified_amount} /></TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell>
                  <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:justify-end">
                    {/* Review / respond is inside View, next to the full details. */}
                    <Button size="sm" className="w-full sm:w-auto" onClick={() => openJsr(r.id)}>View</Button>
                    <Button size="sm" variant="outline" className="w-full border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:text-blue-900 sm:w-auto" onClick={() => exportRecord('jsr', r.id, 'print', { asExporter: true })}>PDF</Button>
                    <Button size="sm" variant="outline" className="w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto" onClick={() => exportRecord('jsr', r.id, 'excel', { asExporter: true })}>Excel</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-0">
        <h3 className="p-4 text-sm font-semibold">Monthly progress claims ({claims.length})</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>This month</TableHead>
              <TableHead>Certified</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No claims submitted for review yet.</TableCell></TableRow>
            ) : claims.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.claim_no}</TableCell>
                <TableCell>{monthName(r.month)}</TableCell>
                <TableCell><Money value={r.this_month_total} /></TableCell>
                <TableCell>{r.client_certified_amount != null ? <Money value={r.client_certified_amount} /> : '—'}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell>
                  <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:justify-end">
                    {/* Review / respond is inside View, next to the full details. */}
                    <Button size="sm" className="w-full sm:w-auto" onClick={() => openClaim(r.id)}>View</Button>
                    <Button size="sm" variant="outline" className="w-full border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:text-blue-900 sm:w-auto" onClick={() => exportRecord('claim', r.id, 'print', { asExporter: true })}>PDF</Button>
                    <Button size="sm" variant="outline" className="w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto" onClick={() => exportRecord('claim', r.id, 'excel', { asExporter: true })}>Excel</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-0">
        <h3 className="p-4 text-sm font-semibold">Invoices ({invoices.length})</h3>
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
            {invoices.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No invoices yet.</TableCell></TableRow>
            ) : invoices.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.invoice_no}</TableCell>
                <TableCell>{r.reference_no}</TableCell>
                <TableCell>{formatDate(r.invoice_date)}</TableCell>
                <TableCell><Money value={r.amount} /></TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="whitespace-nowrap">
                  <Button size="sm" variant="outline" className="border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:text-blue-900" onClick={async () => {
                    const pack = await exporterGetInvoice(r.id);
                    await exportInvoice(pack.kind, { ...pack.record, invoice: pack.invoice }, 'print');
                  }}>PDF</Button>
                  <Button size="sm" variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900" onClick={async () => {
                    const pack = await exporterGetInvoice(r.id);
                    await exportInvoice(pack.kind, { ...pack.record, invoice: pack.invoice }, 'excel');
                  }}>Excel</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(detail)} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-4xl">
          {rec ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.kind === 'jsr' ? rec.jsr_no : rec.claim_no}</DialogTitle>
              </DialogHeader>
              <p className="text-sm"><StatusBadge status={rec.status} /></p>
              {detail.kind === 'jsr' ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rec.items || []).map((it, i) => (
                      <TableRow key={it.id || i}>
                        <TableCell>{it.code}</TableCell>
                        <TableCell>{it.description}</TableCell>
                        <TableCell><CertifiedMoney submitted={it.amount} certified={priced ? it.certified_amount : null} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>JSR</TableHead>
                      <TableHead>WO</TableHead>
                      <TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rec.jsrs || []).map((j) => (
                      <TableRow key={j.id}>
                        <TableCell>{j.jsr_no}</TableCell>
                        <TableCell>{j.wo_ref || '—'}</TableCell>
                        <TableCell><CertifiedMoney submitted={j.total} certified={priced ? j.certified_amount : null} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {(rec.attachments || []).map((a) => (
                <button key={a.id} type="button" className="mr-2 text-sm text-brand underline" onClick={async () => window.open(await signedAttachmentUrl(a.storage_path), '_blank')}>
                  {a.file_name}
                </button>
              ))}
              {rec.client_response && !clientCanRespond(rec.status) ? (
                <Card className="p-3 text-sm">
                  <div className="font-semibold">Your response</div>
                  <p>
                    {clientResponseLabel(rec.client_response)}
                    {rec.client_certified_amount != null ? <> · Certified <Money value={rec.client_certified_amount} /></> : null}
                  </p>
                  {rec.client_reason ? <p>Reason: {rec.client_reason}</p> : null}
                  {rec.client_comments ? <p>{rec.client_comments}</p> : null}
                </Card>
              ) : null}
              <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch sm:space-x-0">
                <WorkflowBar
                  kind={detail.kind}
                  record={rec}
                  role="exporter"
                  onClientReview={() => setReview({ kind: detail.kind, rec })}
                />
                <div className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row">
                  <Button size="sm" variant="outline" className="w-full border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:text-blue-900 sm:w-auto" onClick={() => exportRecord(detail.kind, rec.id, 'print', { asExporter: true, record: rec })}>PDF</Button>
                  <Button size="sm" variant="outline" className="w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto" onClick={() => exportRecord(detail.kind, rec.id, 'excel', { asExporter: true, record: rec })}>Excel</Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ClientReviewDialog
        open={Boolean(review)}
        kind={review?.kind}
        record={review?.rec}
        onClose={() => setReview(null)}
        onDone={() => {
          refresh();
          setDetail(null);
        }}
      />
    </div>
  );
}
