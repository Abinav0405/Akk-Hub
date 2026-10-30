import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Plus, Sheet } from 'lucide-react';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import { formatDate, todayIso } from '@/modules/progress/lib/dates';
import {
  commercialWorkflow,
  deleteClaim,
  getClaim,
  getJsr,
  listClaims,
  listClaimJsrs,
  formatContractOption,
  loadLinkedPhotosForExport,
  runPool,
  saveClaim,
  signedAttachmentUrl,
} from '@/modules/progress/lib/jsr';
import { buildClaimPdfBlob } from '@/modules/progress/lib/jsrPdf';
import { CLAIM_PDF_PHOTO_FIT } from '@/modules/progress/lib/packagePdf';
import { monthName } from '@/modules/progress/lib/jsrStatus';
import { jsrCan } from '@/modules/progress/lib/jsrPermissions';
import { StatusBadge, Money, CertifiedMoney, HistoryTable, LineCertificationTable, exportRecord, exportInvoice } from '@/modules/progress/components/jsr/shared';
import DocumentAuditTrail from '@/modules/progress/components/DocumentAuditTrail';
import WorkflowBar from '@/modules/progress/components/jsr/WorkflowBar';
import InvoicePrepareDialog from '@/modules/progress/components/jsr/InvoicePrepareDialog';
import PassToExporterDialog from '@/modules/progress/components/jsr/PassToExporterDialog';

function emptyDraft(lookups) {
  const companies = (lookups.companies || []).filter((c) => c.is_active !== false);
  const contracts = (lookups.contracts || []).filter((c) => c.is_active !== false);
  const company = companies[0];
  const contract = contracts.find((c) => c.company_id === company?.id) || contracts[0];
  return {
    company_id: company?.id || '',
    contract_id: contract?.id || '',
    month: todayIso().slice(0, 7),
    claim_date: todayIso(),
    pc_no: contract?.pc_no || 1,
    price: contract?.price || 0,
    prev_cert: contract?.prev_cert || 0,
    jsr_ids: [],
    include_jsr_details: true,
    include_photos: false,
  };
}

/**
 * `seedJsrId`: a JSR the client marked "Add to claim" — opens that contract's editable claim for
 * the JSR's month (or a new one) with the JSR ticked. `onSeedUsed` clears it in the parent.
 */
export default function ClaimPanel({ role, lookups, perms = {}, seedJsrId = null, onSeedUsed }) {
  const can = (key) => jsrCan(role, perms, key);
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null);
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [passAction, setPassAction] = useState('pass_to_client');

  const refresh = () => {
    listClaims()
      .then(setRows)
      .catch((e) => {
        toast.error(e.message || 'Could not load claims');
        setRows([]);
      });
  };

  useEffect(refresh, []);

  useEffect(() => {
    if (!seedJsrId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const jsr = await getJsr(seedJsrId);
        const month = String(jsr?.jsr_date || todayIso()).slice(0, 7);
        const claims = rows || (await listClaims());
        let target = null;
        // Same contract and month, still editable → add the JSR to that claim.
        for (const row of claims.filter((c) => c.month === month && ['draft', 'rejected'].includes(c.status))) {
          const rec = await getClaim(row.id);
          if (rec?.contract_id === jsr?.contract_id) {
            target = rec;
            break;
          }
        }
        if (cancelled) return;
        if (target && can('edit_claim')) {
          await openEdit(target.id);
          setDraft((d) => (d && !d.jsr_ids.includes(seedJsrId) ? { ...d, jsr_ids: [...d.jsr_ids, seedJsrId] } : d));
          toast.success(`Added to draft claim ${target.claim_no}. Save to keep it.`);
        } else if (can('create_claim')) {
          const ct = (lookups.contracts || []).find((c) => c.id === jsr?.contract_id);
          setEditId(null);
          setDraft({
            ...emptyDraft(lookups),
            company_id: jsr?.company_id || ct?.company_id || '',
            contract_id: jsr?.contract_id || '',
            month,
            pc_no: ct?.pc_no || 1,
            price: ct?.price || 0,
            prev_cert: ct?.prev_cert || 0,
            jsr_ids: [seedJsrId],
          });
          setDetail(null);
          setView('edit');
        } else {
          toast.error('You are not allowed to create claims');
        }
      } catch (e) {
        if (!cancelled) toast.error(e.message || 'Could not open a claim for that JSR');
      } finally {
        if (!cancelled) onSeedUsed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedJsrId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => (rows || []).filter((r) => matchesQuery([r.claim_no, r.month, r.contract_code, r.status], search)),
    [rows, search]
  );

  const openDetail = async (id) => {
    try {
      const rec = await getClaim(id);
      if (rec.client_response_submitted && !rec.client_ack_at) {
        commercialWorkflow('claim', id, 'ack', {}).catch(() => {});
      }
      setDetail(rec);
    } catch (e) {
      toast.error(e.message || 'Could not open claim');
    }
  };

  const openEdit = async (id) => {
    try {
      const rec = await getClaim(id);
      setEditId(id);
      setDraft({
        company_id: rec.company_id,
        contract_id: rec.contract_id,
        month: rec.month,
        claim_date: rec.claim_date,
        pc_no: rec.pc_no,
        price: rec.price,
        prev_cert: rec.prev_cert,
        jsr_ids: (rec.jsrs || []).map((j) => j.id),
        include_jsr_details: rec.include_jsr_details !== false,
        include_photos: Boolean(rec.include_photos),
      });
      setView('edit');
      setDetail(null);
    } catch (e) {
      toast.error(e.message || 'Could not open claim');
    }
  };

  const handleDelete = async (id, no) => {
    if (!window.confirm(`Delete claim ${no}? JSRs will be released so they can be included in another claim.`)) return;
    try {
      await deleteClaim(id);
      toast.success('Claim deleted');
      setDetail(null);
      refresh();
    } catch (e) {
      toast.error(e.message || 'Could not delete');
    }
  };

  if (view === 'edit') {
    return (
      <ClaimEditor
        lookups={lookups}
        draft={draft}
        setDraft={setDraft}
        editId={editId}
        canSubmit={can('submit_claim')}
        canSaveDraft={editId ? can('edit_claim') : can('create_claim')}
        onCancel={() => { setView('list'); setDraft(null); }}
        onSaved={() => { setView('list'); setDraft(null); refresh(); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Monthly progress claims</h2>
          <p className="text-sm text-muted-foreground">Group approved JSRs for one contract into this month’s claim.</p>
        </div>
        {can('create_claim') ? (
          <Button onClick={() => { setEditId(null); setDraft(emptyDraft(lookups)); setView('edit'); }}>
            <Plus className="mr-1.5 h-4 w-4" /> New monthly claim
          </Button>
        ) : null}
      </div>
      <SearchField value={search} onChange={setSearch} placeholder="Search claim no, month…" />
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead>JSRs</TableHead>
              <TableHead>This month</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">No claims yet.</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.claim_no}</TableCell>
                <TableCell>{monthName(r.month)}</TableCell>
                <TableCell>{r.contract_code} — {r.contract_desc}</TableCell>
                <TableCell>{r.jsr_count}</TableCell>
                <TableCell><CertifiedMoney submitted={r.this_month_total} certified={r.client_certified_amount} /></TableCell>
                <TableCell>
                  <StatusBadge kind="claim" status={r.status} />
                  {r.client_response_submitted && !r.client_ack_at ? <span className="ml-1 text-xs text-amber-700">Response</span> : null}
                </TableCell>
                <TableCell className="text-right">
                  <div className="ml-auto flex w-max max-w-full flex-wrap justify-end">
                    <div className="inline-flex shrink-0 flex-nowrap items-center justify-end gap-1">
                      <Button size="sm" className="h-8 min-h-0 shrink-0 px-3" onClick={() => openDetail(r.id)}>Open</Button>
                      <Button size="sm" variant="outline" title="Download PDF" className="h-7 min-h-0 shrink-0 gap-1 px-2 text-xs border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800" onClick={() => exportRecord('claim', r.id, 'print')}>
                        <FileText className="h-3.5 w-3.5" />
                        PDF
                      </Button>
                      <Button size="sm" variant="outline" title="Download Excel" className="h-7 min-h-0 shrink-0 gap-1 px-2 text-xs border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900" onClick={() => exportRecord('claim', r.id, 'excel')}>
                        <Sheet className="h-3.5 w-3.5" />
                        Excel
                      </Button>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={Boolean(detail)} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-4xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>Claim {detail.claim_no}</DialogTitle>
              </DialogHeader>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Status</dt><dd><StatusBadge kind="claim" status={detail.status} /></dd></div>
                <div><dt className="text-muted-foreground">Month</dt><dd>{monthName(detail.month)}</dd></div>
                <div><dt className="text-muted-foreground">Contract</dt><dd>{detail.contract?.code} — {detail.contract?.description}</dd></div>
                <div><dt className="text-muted-foreground">This month</dt><dd><CertifiedMoney submitted={detail.this_month_total} certified={detail.client_certified_amount} /></dd></div>
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>JSR No</TableHead>
                    <TableHead>WO Ref</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>This month</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.jsrs || []).map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>{j.jsr_no}</TableCell>
                      <TableCell>{j.wo_ref || '—'}</TableCell>
                      <TableCell>{j.site_name}</TableCell>
                      <TableCell><CertifiedMoney submitted={j.total} certified={j.certified_amount} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <LineCertificationTable
                rows={(detail.jsrs || []).map((j) => ({
                  key: j.id,
                  label: j.jsr_no,
                  detail: j.wo_ref || j.site_name,
                  originalAmount: j.total,
                  certifiedAmount: j.certified_amount,
                }))}
              />
              {detail.client_response ? (
                <Card className="p-3 text-sm">
                  <div className="font-semibold">Client response</div>
                  <p>Certified <Money value={detail.client_certified_amount} /></p>
                  {detail.client_reason ? <p>Reason: {detail.client_reason}</p> : null}
                  {(detail.attachments || []).map((a) => (
                    <button key={a.id} type="button" className="mr-2 text-brand underline" onClick={async () => window.open(await signedAttachmentUrl(a.storage_path), '_blank')}>
                      {a.file_name}
                    </button>
                  ))}
                </Card>
              ) : null}
              {detail.invoice ? (
                <Card className="p-3 text-sm">
                  <div className="font-semibold">Invoice {detail.invoice.invoice_no}</div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800" onClick={() => exportInvoice('claim', detail, 'print')}>Invoice PDF</Button>
                    <Button size="sm" variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900" onClick={() => exportInvoice('claim', detail, 'excel')}>Invoice Excel</Button>
                  </div>
                </Card>
              ) : null}
              {role !== 'manager' ? <HistoryTable history={detail.history} /> : null}
              {role !== 'manager' ? <DocumentAuditTrail kind="jsr_claim" documentId={detail.id} /> : null}
              <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch sm:space-x-0">
                <WorkflowBar
                  kind="claim"
                  record={detail}
                  role={role}
                  perms={perms}
                  onRefresh={() => openDetail(detail.id).then(refresh)}
                  onEdit={() => openEdit(detail.id)}
                  onDelete={can('delete_claim') ? () => handleDelete(detail.id, detail.claim_no) : undefined}
                  onPrepareInvoice={() => setInvoiceOpen(true)}
                  onPassToClient={() => {
                    setPassAction('pass_to_client');
                    setPassOpen(true);
                  }}
                  onAssignExporter={() => {
                    setPassAction('assign_exporter');
                    setPassOpen(true);
                  }}
                  onSubmitInvoice={() => {
                    setPassAction('submit_invoice');
                    setPassOpen(true);
                  }}
                />
                <div className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row">
                  <Button size="sm" variant="outline" className="w-full border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800 sm:w-auto" onClick={() => exportRecord('claim', detail.id, 'print', { record: detail })}>PDF</Button>
                  <Button size="sm" variant="outline" className="w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto" onClick={() => exportRecord('claim', detail.id, 'excel', { record: detail })}>Excel</Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <InvoicePrepareDialog
        open={invoiceOpen}
        kind="claim"
        record={detail}
        onClose={() => setInvoiceOpen(false)}
        onDone={() => { setInvoiceOpen(false); if (detail) openDetail(detail.id); refresh(); }}
      />
      <PassToExporterDialog
        open={passOpen}
        kind="claim"
        action={passAction}
        record={detail}
        onClose={() => setPassOpen(false)}
        onDone={() => {
          setPassOpen(false);
          if (detail) openDetail(detail.id);
          refresh();
        }}
        buildPdfBlob={async (rec) => {
          const nested = [];
          const photosByJsrId = {};
          if (rec?.include_jsr_details) {
            const rows = rec.jsrs || [];
            const loaded = await runPool(rows, 3, async (row) => {
              try {
                const full = await getJsr(row.id);
                const photos = rec.include_photos
                  ? await loadLinkedPhotosForExport('jsr', row.id, { fit: CLAIM_PDF_PHOTO_FIT })
                  : [];
                return { full, photos };
              } catch {
                return { full: { ...row, items: [], company: rec.company, contract: rec.contract }, photos: [] };
              }
            });
            loaded.forEach(({ full, photos }) => {
              nested.push(full);
              if (photos?.length) photosByJsrId[full.id] = photos;
            });
          }
          return buildClaimPdfBlob(rec, nested, photosByJsrId);
        }}
      />
    </div>
  );
}

function ClaimEditor({ lookups, draft, setDraft, editId, onCancel, onSaved, canSubmit, canSaveDraft }) {
  const [jsrs, setJsrs] = useState([]);
  const [saving, setSaving] = useState(false);
  const companies = (lookups.companies || []).filter((c) => c.is_active !== false);
  const contracts = (lookups.contracts || []).filter((c) => c.is_active !== false && c.company_id === draft.company_id);

  useEffect(() => {
    if (!draft.contract_id) { setJsrs([]); return; }
    listClaimJsrs(draft.contract_id).then(setJsrs).catch(() => setJsrs([]));
  }, [draft.contract_id]);

  const onThisClaim = (j) => Boolean(editId && draft.jsr_ids.includes(j.id));
  const selectable = jsrs.filter((j) => j.selectable || onThisClaim(j));
  const locked = jsrs.filter((j) => !j.selectable && !onThisClaim(j));
  const total = selectable.filter((j) => draft.jsr_ids.includes(j.id)).reduce((a, j) => a + Number(j.total || 0), 0);

  const onCompany = (id) => {
    const next = (lookups.contracts || []).find((c) => c.company_id === id && c.is_active !== false);
    setDraft((d) => ({
      ...d,
      company_id: id,
      contract_id: next?.id || '',
      pc_no: next?.pc_no || 1,
      price: next?.price || 0,
      prev_cert: next?.prev_cert || 0,
      jsr_ids: [],
    }));
  };

  const onContract = (id) => {
    const ct = (lookups.contracts || []).find((c) => c.id === id);
    setDraft((d) => ({
      ...d,
      contract_id: id,
      pc_no: ct?.pc_no || 1,
      price: ct?.price || 0,
      prev_cert: ct?.prev_cert || 0,
      jsr_ids: [],
    }));
  };

  const save = async (submit) => {
    if (!draft.jsr_ids.length) { toast.error('Select at least one JSR'); return; }
    setSaving(true);
    try {
      await saveClaim(draft, { submit, claimId: editId });
      toast.success(submit ? 'Claim submitted' : 'Draft saved');
      onSaved();
    } catch (e) {
      toast.error(e.message || 'Could not save claim');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{editId ? 'Edit monthly progress claim' : 'New monthly progress claim'}</h2>
        <p className="text-sm text-muted-foreground">One claim per contract and month. JSRs already claimed are locked.</p>
      </div>
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <Label>Company</Label>
          <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={draft.company_id} onChange={(e) => onCompany(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Contract</Label>
          <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={draft.contract_id} onChange={(e) => onContract(e.target.value)}>
            {contracts.map((c) => <option key={c.id} value={c.id}>{formatContractOption(c)}</option>)}
          </select>
        </div>
        <div>
          <Label>Claim month</Label>
          <Input className="mt-1" type="month" value={draft.month} onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value }))} />
        </div>
        <div>
          <Label>Claim date</Label>
          <Input className="mt-1" type="date" value={draft.claim_date} onChange={(e) => setDraft((d) => ({ ...d, claim_date: e.target.value }))} />
        </div>
        <div>
          <Label>PC No</Label>
          <Input className="mt-1" type="number" value={draft.pc_no} onChange={(e) => setDraft((d) => ({ ...d, pc_no: e.target.value }))} />
        </div>
        <div>
          <Label>Contract price (S$)</Label>
          <Input className="mt-1" type="number" step="any" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} />
        </div>
        <div>
          <Label>Previously certified (S$)</Label>
          <Input className="mt-1" type="number" step="any" value={draft.prev_cert} onChange={(e) => setDraft((d) => ({ ...d, prev_cert: e.target.value }))} />
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">Select JSRs of this contract</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>JSR No</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectable.map((j) => (
              <TableRow key={j.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={draft.jsr_ids.includes(j.id)}
                    onChange={() => setDraft((d) => ({
                      ...d,
                      jsr_ids: d.jsr_ids.includes(j.id) ? d.jsr_ids.filter((x) => x !== j.id) : [...d.jsr_ids, j.id],
                    }))}
                  />
                </TableCell>
                <TableCell className="font-medium">{j.jsr_no}</TableCell>
                <TableCell>{j.site_name}</TableCell>
                <TableCell><Money value={j.total} /></TableCell>
                <TableCell><StatusBadge kind="jsr" status={j.status} /></TableCell>
              </TableRow>
            ))}
            {locked.map((j) => (
              <TableRow key={j.id} className="bg-amber-50">
                <TableCell>🔒</TableCell>
                <TableCell className="font-medium">{j.jsr_no}</TableCell>
                <TableCell>{j.site_name}</TableCell>
                <TableCell><Money value={j.total} /></TableCell>
                <TableCell>
                  <StatusBadge kind="jsr" status={j.status} />
                  <div className="text-xs text-amber-800">Already claimed in {j.claim_no} ({j.claimed_month})</div>
                </TableCell>
              </TableRow>
            ))}
            {!jsrs.length ? (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">No approved JSRs of this contract yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.include_jsr_details} onChange={(e) => setDraft((d) => ({ ...d, include_jsr_details: e.target.checked }))} />
          Include JSR detail pages in the claim PDF
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.include_photos} onChange={(e) => setDraft((d) => ({ ...d, include_photos: e.target.checked }))} />
          Include supporting photos in the claim PDF
        </label>
        <div className="mt-3 text-right font-semibold">This month: <Money value={total} /></div>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {canSubmit ? <Button className="w-full sm:w-auto" disabled={saving} onClick={() => save(true)}>Submit monthly claim</Button> : null}
        {canSaveDraft ? <Button className="w-full sm:w-auto" disabled={saving} variant="outline" onClick={() => save(false)}>Save as draft</Button> : null}
        <Button className="w-full sm:w-auto" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
