import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Download, Eye, FileText, Link2, Pencil, Plus, Sheet, Trash2 } from 'lucide-react';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import { cn } from '@/modules/progress/lib/utils';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import SearchField, { matchesQuery } from '@/modules/progress/components/SearchField';
import { PortalPageHeader } from '@/ui/layout';
import { formatDate, todayIso } from '@/modules/progress/lib/dates';
import { listAllSites } from '@/modules/progress/lib/sites';
import {
  autoScWorkForGroup,
  canEditJsrContent,
  canShowJsrDelete,
  commercialWorkflow,
  deleteJsr,
  formatContractOption,
  getJsr,
  hasCertifiedAmount,
  jsrDeleteConfirmText,
  JSR_EDIT_LOCKED_MESSAGE,
  jsrExporterLabel,
  jsrHasExporters,
  jsrLinkedPackageChipLabel,
  jsrPackagePickerName,
  listJsrs,
  listJsrPackages,
  JSR_NUMBER_EDITABLE_STATUSES,
  roundMoney,
  saveJsr,
  setJsrNumber,
  scheduleGroupsFrom,
  signedAttachmentUrl,
} from '@/modules/progress/lib/jsr';
import { CLIENT_VISIBLE_STATUSES, clientAdjustment, fmtMoney, monthName } from '@/modules/progress/lib/jsrStatus';
import { jsrCan } from '@/modules/progress/lib/jsrPermissions';
import { packageHeading } from '@/modules/progress/lib/sectionLabel';
import { StatusBadge, Money, CertifiedMoney, HistoryTable, LineCertificationTable, exportRecord, exportInvoice } from '@/modules/progress/components/jsr/shared';
import DocumentAuditTrail from '@/modules/progress/components/DocumentAuditTrail';
import WorkflowBar from '@/modules/progress/components/jsr/WorkflowBar';
import InvoicePrepareDialog from '@/modules/progress/components/jsr/InvoicePrepareDialog';
import PassToExporterDialog from '@/modules/progress/components/jsr/PassToExporterDialog';

function emptyDraft(lookups) {
  const companies = (lookups.companies || []).filter((c) => c.is_active);
  const contracts = (lookups.contracts || []).filter((c) => c.is_active);
  const company = companies[0];
  const contract = contracts.find((c) => c.company_id === company?.id) || contracts[0];
  return {
    company_id: company?.id || '',
    contract_id: contract?.id || '',
    site_id: '',
    jsr_date: todayIso(),
    loa: contract?.loa || '',
    sc_work: contract?.sc_work || '',
    wo_ref: '',
    location: '',
    completion_date: '',
    package_ids: [],
    items: [],
  };
}

export default function JsrPanel({ role, lookups, perms = {} }) {
  const can = (key) => jsrCan(role, perms, key);
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [stage, setStage] = useState('all');
  const [siteF, setSiteF] = useState('');
  const [scheduleF, setScheduleF] = useState('');
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null);
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [passAction, setPassAction] = useState('pass_to_client');

  const refresh = () => {
    listJsrs()
      .then(setRows)
      .catch((e) => {
        toast.error(e.message || 'Could not load JSRs');
        setRows([]);
      });
  };

  useEffect(refresh, []);

  // Months that actually have JSRs, newest first (by JSR date).
  const monthOptions = useMemo(() => {
    const set = new Set((rows || []).map((r) => String(r.jsr_date || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)));
    return [...set].sort().reverse();
  }, [rows]);
  const monthRows = useMemo(
    () => (rows || []).filter((r) => !month || String(r.jsr_date || '').slice(0, 7) === month),
    [rows, month]
  );
  const siteOptions = useMemo(() => [...new Set((rows || []).map((r) => r.site_name).filter(Boolean))].sort(), [rows]);
  const scheduleOptions = useMemo(() => [...new Set((rows || []).map((r) => r.contract_code).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    const stageDef = JSR_STAGES.find((s) => s.id === stage);
    return monthRows.filter((r) =>
      (stage === 'all' || stageDef?.statuses.includes(r.status))
      && (!siteF || r.site_name === siteF)
      && (!scheduleF || r.contract_code === scheduleF)
      && matchesQuery([
        r.jsr_no, r.summary, r.first_package?.display_id,
        ...(r.linked_packages || []).map((p) => p.display_id),
        r.site_name, r.location, r.wo_ref, r.sc_work, r.contract_code, r.status, jsrExporterLabel(r),
      ], search)
    );
  }, [monthRows, stage, siteF, scheduleF, search]);
  const filteredTotal = useMemo(
    () => filtered.reduce((sum, r) => sum + (Number(r.client_certified_amount ?? r.total) || 0), 0),
    [filtered]
  );

  /** The rows shown, as a CSV that opens in Excel. */
  const exportList = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['JSR no', 'Description', 'Site', 'Schedule', 'SC work', 'Date', 'Amount', 'Certified', 'Status', 'Claim'];
    const lines = filtered.map((r) => [
      r.jsr_no, r.summary || r.location || '', r.site_name, r.contract_code, r.sc_work,
      r.jsr_date, Number(r.total) || 0, r.client_certified_amount ?? '', r.status, r.claim_no || '',
    ].map(cell).join(','));
    const blob = new Blob([`\uFEFF${[header.map(cell).join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    savePdfBlob(blob, `JSR-list-${todayIso()}.csv`);
  };

  const renameDetail = async () => {
    if (!detail) return;
    const next = window.prompt('JSR number', detail.jsr_no || '');
    if (next == null) return;
    const value = next.trim();
    if (!value || value === detail.jsr_no) return;
    try {
      await setJsrNumber(detail.id, value);
      toast.success('JSR number changed');
      await openDetail(detail.id);
      refresh();
    } catch (e) {
      toast.error(e.message || 'Could not change the JSR number');
    }
  };
  const unassignedPassed = (rows || []).filter(
    (r) => CLIENT_VISIBLE_STATUSES.includes(r.status) && !jsrHasExporters(r)
  );

  const openCreate = () => {
    setEditId(null);
    setDraft(emptyDraft(lookups));
    setView('edit');
  };

  const openEdit = async (id) => {
    try {
      const rec = await getJsr(id);
      if (!canEditJsrContent(role, perms, rec.status)) {
        toast.error(JSR_EDIT_LOCKED_MESSAGE);
        return;
      }
      setEditId(id);
      setDraft({
        company_id: rec.company_id,
        contract_id: rec.contract_id,
        site_id: rec.site_id,
        jsr_date: rec.jsr_date,
        loa: rec.loa || '',
        sc_work: rec.sc_work || '',
        wo_ref: rec.wo_ref || '',
        location: rec.location || '',
        completion_date: rec.completion_date || '',
        jsr_no: rec.jsr_no || '',
        original_jsr_no: rec.jsr_no || '',
        package_ids: rec.package_ids || [],
        items: rec.items || [],
        status: rec.status || 'draft',
      });
      setView('edit');
      setDetail(null);
    } catch (e) {
      toast.error(e.message || 'Could not open JSR');
    }
  };

  const openDetail = async (id) => {
    try {
      const rec = await getJsr(id);
      if (rec.client_response_submitted && !rec.client_ack_at) {
        commercialWorkflow('jsr', id, 'ack', {}).catch(() => {});
      }
      setDetail(rec);
    } catch (e) {
      toast.error(e.message || 'Could not open JSR');
    }
  };

  const handleDelete = async (rec) => {
    if (!window.confirm(jsrDeleteConfirmText(role, rec))) return;
    try {
      await deleteJsr(rec.id, { asAdmin: role === 'admin' });
      toast.success('JSR deleted');
      setDetail(null);
      refresh();
    } catch (e) {
      toast.error(e.message || 'Could not delete');
    }
  };

  if (view === 'edit') {
    return (
      <JsrEditor
        lookups={lookups}
        draft={draft}
        setDraft={setDraft}
        editId={editId}
        existingJsrs={rows}
        editStatus={editId ? (draft?.status || 'draft') : 'draft'}
        canSubmit={can('submit_jsr')}
        canSaveDraft={editId ? can('edit_jsr') : can('create_jsr')}
        onCancel={() => {
          setView('list');
          setDraft(null);
          setEditId(null);
        }}
        onSaved={() => {
          setView('list');
          setDraft(null);
          setEditId(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PortalPageHeader
        title="Job Service Reports"
        description="Create a JSR from site packages, review it, then pass it to the client for sign-off."
        actions={
          can('create_jsr') ? (
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> New JSR
            </Button>
          ) : null
        }
      />
      {(rows || []).some((r) => r.client_response_submitted && !r.client_ack_at) ? (
        <Card className="border-amber-200 bg-amber-50 p-3 text-sm">New client response — open a JSR to view certified amount and attachments.</Card>
      ) : null}
      {unassignedPassed.length ? (
        <Card className="border-amber-200 bg-amber-50 p-3 text-sm">
          {unassignedPassed.length} passed-out JSR{unassignedPassed.length === 1 ? '' : 's'} {' '}
          {unassignedPassed.length === 1 ? 'has' : 'have'} no Export Only ID — hidden from every client login until you assign one.
        </Card>
      ) : null}
      {/* Stage cards double as filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {JSR_STAGES.map((s, idx) => {
          const n = s.id === 'all' ? monthRows.length : monthRows.filter((r) => s.statuses.includes(r.status)).length;
          const active = stage === s.id;
          return (
            <div key={s.id} className="flex min-w-0 flex-1 items-stretch gap-2">
              {idx > 0 ? (
                <div className="hidden items-center text-slate-300 lg:flex" aria-hidden>
                  <ChevronRight className="h-4 w-4" />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setStage(s.id)}
                aria-pressed={active}
                className={cn(
                  'min-w-0 flex-1 rounded-xl border bg-white p-3.5 text-left transition-all hover:shadow-sm',
                  active ? 'border-slate-900 ring-1 ring-slate-900' : 'border-border bg-slate-50/80'
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <span className={cn('h-2 w-2 rounded-full', s.dot)} aria-hidden />
                  {s.id === 'all' && month ? `JSRs in ${monthName(month)}` : s.label}
                </p>
                <p className="mt-1 flex items-baseline gap-1.5">
                  <span className={cn('text-2xl font-semibold tabular-nums', n && s.tone)}>{n}</span>
                  <span className="text-xs text-muted-foreground">{n ? s.hint : s.empty}</span>
                </p>
              </button>
            </div>
          );
        })}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-center">
          <SearchField className="lg:flex-1" value={search} onChange={setSearch} placeholder="Search JSR no., site, location or schedule" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <select aria-label="Filter by site" className={filterSelect(siteF)} value={siteF} onChange={(e) => setSiteF(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Filter by schedule" className={filterSelect(scheduleF)} value={scheduleF} onChange={(e) => setScheduleF(e.target.value)}>
              <option value="">All schedules</option>
              {scheduleOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Filter by month" className={filterSelect(month)} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All months</option>
              {monthOptions.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
            <Button type="button" variant="outline" className="h-10 min-h-0" onClick={exportList} disabled={!filtered.length}>
              <Download className="mr-1.5 h-4 w-4" /> Export list
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="py-2.5 pl-4 pr-3">JSR</th>
                <th className="py-2.5 pr-3">Schedule</th>
                <th className="py-2.5 pr-3">Date</th>
                <th className="py-2.5 pr-3 text-right">Amount (SGD)</th>
                <th className="py-2.5 pl-3 pr-3">Status</th>
                <th className="py-2.5 pr-3">Linked packages</th>
                <th className="py-2.5 pl-2 pr-4 text-right">Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><td colSpan={7} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-muted-foreground">{(rows || []).length ? 'No JSRs match these filters.' : 'No JSRs yet. Create one from existing photo packages.'}</td></tr>
              ) : filtered.map((r) => {
                const next = jsrNextStep(r, can);
                const short = shortJsrLabel(r.jsr_no);
                const linkedPkgs = r.linked_packages?.length
                  ? r.linked_packages
                  : (r.first_package ? [r.first_package] : []);
                const chipLimit = 2;
                const shownPkgs = linkedPkgs.slice(0, chipLimit);
                const moreCount = linkedPkgs.length - shownPkgs.length;
                const rowEditable = canEditJsrContent(role, perms, r.status);
                const canLink = rowEditable;
                return (
                  <tr key={r.id} className="border-b border-border align-top transition-colors hover:bg-slate-50/70">
                    <td className="min-w-[12rem] max-w-[20rem] py-3 pl-4 pr-3">
                      <button type="button" onClick={() => openDetail(r.id)} className="text-left hover:text-brand">
                        <span className="font-semibold text-slate-900 hover:underline">{short}</span>
                      </button>
                      {r.summary ? (
                        <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900" title={r.summary}>
                          {r.summary}
                        </p>
                      ) : null}
                      <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{r.jsr_no}</p>
                    </td>
                    <td className="max-w-[14rem] py-3 pr-3">
                      {r.contract_code ? (
                        <p className="truncate text-sm font-semibold text-slate-900" title={r.contract_code}>
                          Sch. {r.contract_code}
                        </p>
                      ) : r.sc_work ? (
                        <p className="line-clamp-2 text-sm font-semibold text-slate-900" title={r.sc_work}>{r.sc_work}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">—</p>
                      )}
                      {r.contract_code && r.sc_work ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-600" title={r.sc_work}>{r.sc_work}</p>
                      ) : null}
                      {r.site_name ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.site_name}>{r.site_name}</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 tabular-nums">{formatDate(r.jsr_date)}</td>
                    <td className="whitespace-nowrap py-3 pr-3 text-right font-semibold tabular-nums">
                      <CertifiedMoney submitted={r.total} certified={r.client_certified_amount} />
                    </td>
                    <td className="py-3 pl-3 pr-3">
                      <StatusBadge status={r.status} />
                      {r.client_response_submitted && !r.client_ack_at ? <p className="mt-1 text-xs font-medium text-amber-700">New client response</p> : null}
                    </td>
                    <td className="py-3 pr-3">
                      {linkedPkgs.length ? (
                        <div className="flex max-w-[14rem] flex-wrap items-center gap-1">
                          {shownPkgs.map((pkg) => {
                            const label = jsrLinkedPackageChipLabel(pkg);
                            return (
                              <button
                                key={pkg.package_id || pkg.display_id || label}
                                type="button"
                                className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                onClick={() => (rowEditable ? openEdit(r.id) : openDetail(r.id))}
                                title={rowEditable ? 'Edit linked packages' : 'Open JSR'}
                              >
                                <Link2 className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{label}</span>
                              </button>
                            );
                          })}
                          {moreCount > 0 ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-slate-500 hover:text-slate-800"
                              onClick={() => (rowEditable ? openEdit(r.id) : openDetail(r.id))}
                              title={rowEditable ? 'Edit linked packages' : 'Open JSR'}
                            >
                              +{moreCount} more
                            </button>
                          ) : null}
                          {canLink ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:border-slate-500 hover:text-slate-900"
                              onClick={() => openEdit(r.id)}
                            >
                              <Plus className="h-3.5 w-3.5" /> Link package
                            </button>
                          ) : null}
                        </div>
                      ) : canLink ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:border-slate-500 hover:text-slate-900"
                          onClick={() => openEdit(r.id)}
                        >
                          <Plus className="h-3.5 w-3.5" /> Link package
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 pl-2 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant={next.primary ? 'default' : 'outline'}
                          className="h-8 min-h-0 whitespace-nowrap px-3 text-xs"
                          onClick={() => (next.edit ? openEdit(r.id) : openDetail(r.id))}
                        >
                          {next.label}
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 w-8 min-h-0 p-0" title="Download PDF" aria-label="Download PDF" onClick={() => exportRecord('jsr', r.id, 'print')}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        <MoreMenu
                          items={[
                            { label: 'Open', icon: <Eye className="h-4 w-4" />, onClick: () => openDetail(r.id) },
                            rowEditable
                              ? { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(r.id) }
                              : null,
                            { label: 'Download Excel', icon: <Sheet className="h-4 w-4" />, onClick: () => exportRecord('jsr', r.id, 'excel') },
                            { label: `Export Only: ${jsrExporterLabel(r) || 'Not assigned'}`, onClick: () => openDetail(r.id) },
                            canShowJsrDelete(role, perms, r)
                              ? { label: 'Delete JSR', icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => handleDelete(r) }
                              : null,
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length ? (
              <tfoot>
                <tr className="bg-slate-50/80 text-xs text-muted-foreground">
                  <td className="py-2.5 pl-4 pr-3" colSpan={3}>Showing {filtered.length} JSR{filtered.length === 1 ? '' : 's'}</td>
                  <td className="py-2.5 pr-3 text-right text-sm font-semibold tabular-nums text-slate-900">$ {fmtMoney(filteredTotal)}</td>
                  <td className="py-2.5 pl-3 pr-4" colSpan={3}>total of rows shown</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <Dialog open={Boolean(detail)} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-4xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
                  <span>JSR {detail.jsr_no}</span>
                  {can('edit_jsr') && JSR_NUMBER_EDITABLE_STATUSES.includes(detail.status) ? (
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={renameDetail}>
                      Edit number
                    </Button>
                  ) : null}
                </DialogTitle>
              </DialogHeader>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={detail.status} /></dd></div>
                <div><dt className="text-muted-foreground">Export Only IDs</dt><dd><ExportOnlyLabel row={detail} /></dd></div>
                <div><dt className="text-muted-foreground">Company</dt><dd>{detail.company?.name}</dd></div>
                <div><dt className="text-muted-foreground">Contract</dt><dd>{detail.contract?.code} — {detail.contract?.description}</dd></div>
                <div><dt className="text-muted-foreground">Site</dt><dd>{detail.site?.name}</dd></div>
                <div><dt className="text-muted-foreground">JSR date</dt><dd>{formatDate(detail.jsr_date)}</dd></div>
                <div><dt className="text-muted-foreground">LOA</dt><dd>{detail.loa || '—'}</dd></div>
                <div><dt className="text-muted-foreground">WO Ref</dt><dd>{detail.wo_ref || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Location</dt><dd>{detail.location || '—'}</dd></div>
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>S.No</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.items || []).map((it, i) => (
                    <TableRow key={it.id || i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>{it.code}</TableCell>
                      <TableCell>{it.description}</TableCell>
                      <TableCell>{it.qty} {it.unit}</TableCell>
                      <TableCell><Money value={it.rate} /></TableCell>
                      <TableCell><Money value={it.amount} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-right font-semibold">
                TOTAL: <CertifiedMoney className="font-semibold" submitted={detail.total} certified={detail.client_certified_amount} />
                {hasCertifiedAmount(detail.client_certified_amount) && Math.abs(roundMoney(detail.total) - roundMoney(detail.client_certified_amount)) >= 0.005 ? (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    After client certification · {clientAdjustment(detail.total, detail.client_certified_amount).label.toLowerCase()} <Money value={clientAdjustment(detail.total, detail.client_certified_amount).amount} />
                  </span>
                ) : null}
              </div>
              <LineCertificationTable
                showRate
                rows={(detail.items || []).map((it, i) => ({
                  key: it.id || i,
                  label: it.code,
                  detail: it.description,
                  originalQty: it.qty,
                  certifiedQty: it.certified_qty,
                  originalRate: it.rate,
                  certifiedRate: it.certified_rate,
                  originalAmount: it.amount,
                  certifiedAmount: it.certified_amount,
                }))}
              />
              {detail.client_response ? (
                <Card className="p-3 text-sm">
                  <div className="font-semibold">Client response</div>
                  <p>Certified <Money value={detail.client_certified_amount} /> · {detail.client_responded_by_name}</p>
                  {detail.client_reason ? <p>Reason: {detail.client_reason}</p> : null}
                  {detail.client_comments ? <p>{detail.client_comments}</p> : null}
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
                  <p><Money value={detail.invoice.amount} /> · {formatDate(detail.invoice.invoice_date)}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800" onClick={() => exportInvoice('jsr', detail, 'print')}>Invoice PDF</Button>
                    <Button size="sm" variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900" onClick={() => exportInvoice('jsr', detail, 'excel')}>Invoice Excel</Button>
                  </div>
                </Card>
              ) : null}
              <HistoryTable history={detail.history} />
              <DocumentAuditTrail kind="jsr" documentId={detail.id} />
              <DialogFooter className="flex-col items-stretch gap-3 sm:flex-col sm:items-stretch sm:space-x-0">
                <WorkflowBar
                  kind="jsr"
                  record={detail}
                  role={role}
                  perms={perms}
                  onRefresh={() => openDetail(detail.id).then(refresh)}
                  onEdit={() => openEdit(detail.id)}
                  onDelete={canShowJsrDelete(role, perms, detail) ? () => handleDelete(detail) : undefined}
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
                  <Button size="sm" variant="outline" className="w-full border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 hover:text-slate-800 sm:w-auto" onClick={() => exportRecord('jsr', detail.id, 'print', { record: detail })}>PDF</Button>
                  <Button size="sm" variant="outline" className="w-full border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto" onClick={() => exportRecord('jsr', detail.id, 'excel', { record: detail })}>Excel</Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <InvoicePrepareDialog
        open={invoiceOpen}
        kind="jsr"
        record={detail}
        onClose={() => setInvoiceOpen(false)}
        onDone={() => { setInvoiceOpen(false); if (detail) openDetail(detail.id); refresh(); }}
      />
      <PassToExporterDialog
        open={passOpen}
        kind="jsr"
        action={passAction}
        record={detail}
        onClose={() => setPassOpen(false)}
        onDone={() => {
          setPassOpen(false);
          if (detail) openDetail(detail.id);
          refresh();
        }}
      />
    </div>
  );
}

function ExportOnlyLabel({ row }) {
  const label = jsrExporterLabel(row);
  if (label) return <span>{label}</span>;
  if (CLIENT_VISIBLE_STATUSES.includes(row?.status)) {
    return <span className="font-medium text-amber-800">Not assigned</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

/** Stage cards above the list — each one filters to its statuses. */
const JSR_STAGES = [
  { id: 'all', label: 'All JSRs', dot: 'bg-slate-900', tone: '', hint: 'total', empty: 'none yet', statuses: [] },
  { id: 'review', label: 'Awaiting review', dot: 'bg-amber-500', tone: 'text-amber-700', hint: 'needs action', empty: 'all clear', statuses: ['draft', 'submitted', 'rejected'] },
  { id: 'client', label: 'With client', dot: 'bg-brand', tone: 'text-slate-800', hint: 'pending sign-off', empty: 'none', statuses: ['approved', 'passedout', 'clientreview', 'c-approved', 'c-certified', 'c-partial', 'c-rejected'] },
  { id: 'billing', label: 'Invoicing · payment', dot: 'bg-emerald-500', tone: 'text-emerald-700', hint: 'to collect', empty: 'none', statuses: ['paymentcert', 'invoiceprepared', 'invoicesubmitted', 'paymentpending', 'paid', 'claimed'] },
];

/** "JSR 003" from a full number ending in …-003 / …/003. */
function shortJsrLabel(jsrNo) {
  const s = String(jsrNo || '').trim();
  if (!s) return 'JSR';
  const m = s.match(/(?:^|[/\-_])(\d+)\s*$/);
  if (m) return `JSR ${m[1].padStart(3, '0')}`;
  return s.length > 18 ? `JSR …${s.slice(-8)}` : s;
}

function filterSelect(value) {
  return cn(
    'h-10 w-full min-w-0 rounded-lg border border-input bg-white px-3 text-sm text-slate-700 sm:w-40',
    value && 'border-brand/50 bg-brand-muted/40 font-medium text-brand'
  );
}

/** The one thing to do next for a JSR, shown as the row's main button. */
function jsrNextStep(r, can) {
  if (r.client_response_submitted && !r.client_ack_at) return { label: 'View response', primary: true };
  if ((r.status === 'draft' || r.status === 'rejected') && can('edit_jsr')) return { label: 'Edit', edit: true };
  if (r.status === 'submitted') return { label: 'Review', primary: false };
  if (r.status === 'approved') return { label: 'Send to client', primary: true };
  return { label: 'Open' };
}

/** Month key "YYYY-MM" from the package's photo/work date (package_date). */
function packageMonthKey(p) {
  const m = String(p?.package_date || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}

function JsrEditor({ lookups, draft, setDraft, editId, existingJsrs = null, editStatus = 'draft', onCancel, onSaved, canSubmit, canSaveDraft }) {
  const [sites, setSites] = useState([]);
  const [packages, setPackages] = useState([]);
  const [pkgSearch, setPkgSearch] = useState('');
  const [pkgMonth, setPkgMonth] = useState('');
  const [pkgSiteF, setPkgSiteF] = useState(draft.site_id || '');
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  const companies = (lookups.companies || []).filter((c) => c.is_active !== false);
  const contracts = (lookups.contracts || []).filter((c) => c.is_active !== false && c.company_id === draft.company_id);
  const catalog = (lookups.catalog || []).filter((c) => c.is_active !== false);
  const scheduleGroups = scheduleGroupsFrom(lookups);
  const scWorkOptions = Array.from(new Set([
    ...scheduleGroups.map(autoScWorkForGroup),
    ...(lookups.contracts || []).map((c) => (c.sc_work || '').trim()).filter(Boolean),
    (draft.sc_work || '').trim(),
  ].filter(Boolean)));

  useEffect(() => {
    listAllSites().then((s) => setSites((s || []).filter((x) => x.is_active !== false))).catch(() => setSites([]));
  }, []);

  // Eligible packages for every site (same RPC as before), so Site + Month filters can narrow the list.
  useEffect(() => {
    if (!sites.length) {
      setPackages([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all(
      sites.map((s) =>
        listJsrPackages(s.id)
          .then((rows) =>
            (rows || []).map((p) => ({
              ...p,
              site_id: s.id,
              site_name: p.site_name || s.name,
              section_label: p.section_label || s.section_label,
            }))
          )
          .catch(() => [])
      )
    )
      .then((lists) => {
        if (cancelled) return;
        const merged = lists.flat().sort((a, b) => {
          const da = String(a.package_date || '');
          const db = String(b.package_date || '');
          return db.localeCompare(da) || String(b.display_id || '').localeCompare(String(a.display_id || ''));
        });
        setPackages(merged);
      })
      .catch(() => {
        if (!cancelled) setPackages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sites]);

  // package id → numbers of the OTHER JSRs it is already attached to (so the picker can say so).
  const attachedElsewhere = useMemo(() => {
    const map = new Map();
    (existingJsrs || []).forEach((j) => {
      if (editId && j.id === editId) return;
      (j.linked_packages || []).forEach((lp) => {
        const id = lp.package_id || lp.id;
        if (!id) return;
        const list = map.get(id) || [];
        if (!list.includes(j.jsr_no)) list.push(j.jsr_no);
        map.set(id, list);
      });
    });
    return map;
  }, [existingJsrs, editId]);

  const total = (draft.items || []).reduce((a, it) => a + Number(it.amount || 0), 0);
  const selectedSite = sites.find((s) => s.id === draft.site_id);

  const pkgSiteOptions = useMemo(() => {
    const seen = new Map();
    (packages || []).forEach((p) => {
      if (!p.site_id || seen.has(p.site_id)) return;
      seen.set(p.site_id, p.site_name || sites.find((s) => s.id === p.site_id)?.name || 'Site');
    });
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [packages, sites]);

  const pkgMonthOptions = useMemo(() => {
    const set = new Set();
    (packages || []).forEach((p) => {
      if (pkgSiteF && p.site_id !== pkgSiteF) return;
      const key = packageMonthKey(p);
      if (key) set.add(key);
    });
    return [...set].sort().reverse();
  }, [packages, pkgSiteF]);

  const filtersActive = Boolean(pkgSearch.trim() || pkgMonth || pkgSiteF);

  const filteredPackages = useMemo(() => {
    return (packages || []).filter((p) => {
      if (pkgSiteF && p.site_id !== pkgSiteF) return false;
      if (pkgMonth && packageMonthKey(p) !== pkgMonth) return false;
      const enriched = { ...p, section_label: p.section_label || selectedSite?.section_label };
      return matchesQuery(
        [
          packageHeading({ ...enriched, display_id: '' }),
          p.display_id,
          p.description,
          p.street_name,
          p.lcb_id,
          p.place,
          p.site_name,
        ],
        pkgSearch
      );
    });
  }, [packages, pkgSearch, pkgMonth, pkgSiteF, selectedSite?.section_label]);

  const clearPkgFilters = () => {
    setPkgSearch('');
    setPkgMonth('');
    setPkgSiteF('');
  };

  const patch = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const onFormSite = (id) => {
    setPkgSiteF(id);
    setDraft((d) => ({
      ...d,
      site_id: id,
      package_ids: id
        ? d.package_ids.filter((pid) => packages.find((p) => p.id === pid)?.site_id === id)
        : d.package_ids,
    }));
  };

  const onPkgSiteFilter = (id) => {
    setPkgSiteF(id);
    if (!id) return;
    setDraft((d) => ({
      ...d,
      site_id: id,
      package_ids: d.package_ids.filter((pid) => packages.find((p) => p.id === pid)?.site_id === id),
    }));
  };

  const onCompany = (id) => {
    const next = (lookups.contracts || []).filter((c) => c.company_id === id && c.is_active !== false)[0];
    setDraft((d) => ({
      ...d,
      company_id: id,
      contract_id: next?.id || '',
      loa: next?.loa || d.loa,
      sc_work: next?.sc_work || d.sc_work,
    }));
  };

  const onContract = (id) => {
    const ct = (lookups.contracts || []).find((c) => c.id === id);
    setDraft((d) => ({ ...d, contract_id: id, loa: ct?.loa || d.loa, sc_work: ct?.sc_work || d.sc_work }));
  };

  // Location = the street of EVERY selected package, one per package, in selection order,
  // comma separated (even when several packages share a street). A location typed by hand is kept.
  const streetOf = (p) => String(p?.street_name || p?.place || '').trim();
  const streetsFor = (ids) =>
    ids
      .map((pid) => streetOf((packages || []).find((x) => x.id === pid)))
      .filter(Boolean)
      .join(', ');

  const togglePkg = (pkg) => {
    const id = pkg.id;
    const pkgSiteId = pkg.site_id;
    setDraft((d) => {
      const has = d.package_ids.includes(id);
      const switching = !has && pkgSiteId && d.site_id && d.site_id !== pkgSiteId;
      const package_ids = has
        ? d.package_ids.filter((x) => x !== id)
        : [...(switching ? [] : d.package_ids), id];
      const wasAuto = !d.location || d.location === streetsFor(d.package_ids);
      return {
        ...d,
        site_id: has ? d.site_id : pkgSiteId || d.site_id,
        package_ids,
        location: wasAuto ? streetsFor(package_ids) : d.location,
      };
    });
    if (!draft.package_ids.includes(id) && attachedElsewhere.has(id)) {
      toast.message(`${pkg.display_id || 'This package'} is already on JSR ${attachedElsewhere.get(id).join(', ')}`);
    }
    if (pkgSiteId) setPkgSiteF(pkgSiteId);
  };

  const addItem = () => {
    const it = catalog.find((c) => c.code === pick);
    if (!it) { toast.error('Select a catalog item first'); return; }
    const q = Number(qty) || 1;
    setDraft((d) => ({
      ...d,
      items: [...d.items, { code: it.code, description: it.description, unit: it.unit, qty: q, rate: Number(it.rate), amount: Math.round(q * Number(it.rate) * 100) / 100, remarks: '', package_ids: [], is_custom: false }],
    }));
    setPick('');
    setQty(1);
  };

  const addCustom = () => {
    setDraft((d) => ({
      ...d,
      items: [...d.items, { code: 'NA', description: 'Custom item — edit description', unit: 'no.', qty: 1, rate: 0, amount: 0, remarks: '', package_ids: [], is_custom: true }],
    }));
  };

  const updateItem = (idx, field, value) => {
    setDraft((d) => {
      const items = d.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [field]: field === 'qty' || field === 'rate' ? Number(value) || 0 : value };
        if (field === 'qty' || field === 'rate') next.amount = Math.round(next.qty * next.rate * 100) / 100;
        return next;
      });
      return { ...d, items };
    });
  };

  const status = editId ? (editStatus || draft.status || 'draft') : 'draft';
  const alreadySubmitted = status === 'submitted';
  const showSubmit = canSubmit && !alreadySubmitted;
  const saveLabel = !editId || status === 'draft' ? 'Save as draft' : 'Save changes';

  const save = async (submit) => {
    if (editId && !['draft', 'rejected', 'submitted'].includes(status)) {
      toast.error(JSR_EDIT_LOCKED_MESSAGE);
      return;
    }
    if (!draft.items.length) { toast.error('Add at least one JSR item'); return; }
    if (!draft.site_id) { toast.error('Select a site'); return; }
    setSaving(true);
    try {
      const savedId = await saveJsr(draft, { submit, jsrId: editId });
      const wanted = String(draft.jsr_no || '').trim();
      if (savedId && wanted && wanted !== String(draft.original_jsr_no || '').trim()) {
        try {
          await setJsrNumber(savedId, wanted);
        } catch (renameError) {
          toast.error(`Saved, but the JSR number was not changed: ${renameError.message}`);
        }
      }
      toast.success(submit ? 'JSR submitted' : (editId && status !== 'draft' ? 'JSR updated' : 'Draft saved'));
      onSaved();
    } catch (e) {
      toast.error(e.message || 'Could not save JSR');
    } finally {
      setSaving(false);
    }
  };

  const groups = {};
  catalog.forEach((it) => {
    (groups[it.group_name] = groups[it.group_name] || []).push(it);
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{editId ? 'Edit JSR' : 'Create JSR from photo packages'}</h2>
        <p className="text-sm text-muted-foreground">Select company, contract, photo packages and priced catalog items.</p>
      </div>
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Company">
          <select className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={draft.company_id} onChange={(e) => onCompany(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Contract">
          <select className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={draft.contract_id} onChange={(e) => onContract(e.target.value)}>
            {contracts.map((c) => <option key={c.id} value={c.id}>{formatContractOption(c)}</option>)}
          </select>
        </Field>
        <Field label="Site">
          <select className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={draft.site_id} onChange={(e) => onFormSite(e.target.value)}>
            <option value="">Select site</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="JSR number">
          <Input
            value={draft.jsr_no || ''}
            onChange={(e) => patch('jsr_no', e.target.value)}
            placeholder={editId ? '' : 'Leave blank to number it automatically'}
          />
        </Field>
        <Field label="JSR date"><Input type="date" value={draft.jsr_date} onChange={(e) => patch('jsr_date', e.target.value)} /></Field>
        <Field label="LOA Ref"><Input value={draft.loa} onChange={(e) => patch('loa', e.target.value)} /></Field>
        <Field label="SC Work">
          <select className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={draft.sc_work} onChange={(e) => patch('sc_work', e.target.value)}>
            {scWorkOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </Field>
        <Field label="Work Order Ref"><Input value={draft.wo_ref} onChange={(e) => patch('wo_ref', e.target.value)} placeholder="e.g. GUT/LTA/WO/00241" /></Field>
        <Field label="Location"><Input value={draft.location} onChange={(e) => patch('location', e.target.value)} placeholder="e.g. BOON TAT STREET LP 12" /></Field>
        <Field label="Work actual completion date"><Input type="date" value={draft.completion_date || ''} onChange={(e) => patch('completion_date', e.target.value)} /></Field>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 font-semibold">1 · Select photo packages</h3>
        <p className="mb-3 text-sm text-muted-foreground">Pending or approved packages. Filter by month or site, then tick the ones to link. Photos stay on the JSR.</p>
        {packages.length > 0 ? (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchField
              className="max-w-md sm:min-w-[16rem] sm:flex-1"
              value={pkgSearch}
              onChange={setPkgSearch}
              placeholder="Search packages by site, section, PKG id, or description…"
            />
            <select
              aria-label="Filter packages by site"
              className={filterSelect(pkgSiteF)}
              value={pkgSiteF}
              onChange={(e) => onPkgSiteFilter(e.target.value)}
            >
              <option value="">All sites</option>
              {pkgSiteOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              aria-label="Filter packages by month"
              className={filterSelect(pkgMonth)}
              value={pkgMonth}
              onChange={(e) => setPkgMonth(e.target.value)}
            >
              <option value="">All months</option>
              {pkgMonthOptions.map((m) => (
                <option key={m} value={m}>{monthName(m)}</option>
              ))}
            </select>
            {filtersActive ? (
              <Button type="button" variant="ghost" className="h-10 min-h-0 px-3" onClick={clearPkgFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Photos</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No eligible photo packages yet.</TableCell></TableRow>
            ) : filteredPackages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {filtersActive ? 'No packages match these filters.' : 'No packages to show.'}
                </TableCell>
              </TableRow>
            ) : filteredPackages.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <input type="checkbox" checked={draft.package_ids.includes(p.id)} onChange={() => togglePkg(p)} />
                </TableCell>
                <TableCell>
                  <PackagePickerLabel
                    pkg={{ ...p, section_label: p.section_label || selectedSite?.section_label }}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">{p.site_name || '—'}</TableCell>
                <TableCell>{formatDate(p.package_date)}</TableCell>
                <TableCell>{p.photo_count}</TableCell>
                <TableCell>
                  {p.approval_status}
                  {attachedElsewhere.has(p.id) ? (
                    <span
                      className="mt-1 block max-w-[11rem] break-words rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold leading-snug text-amber-800"
                      title={`Already attached to JSR ${attachedElsewhere.get(p.id).join(', ')}`}
                    >
                      Already on JSR {attachedElsewhere.get(p.id).map((n) => shortJsrLabel(n)).join(', ')}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 font-semibold">2 · JSR items & rates</h3>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1">
            <Label>Catalog item</Label>
            <select className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">— select a JSR item —</option>
              {Object.entries(groups).map(([g, items]) => (
                <optgroup key={g} label={g}>
                  {items.map((it) => (
                    <option key={it.id} value={it.code}>{it.code} — {it.description} ({it.unit}, $ {fmtMoney(it.rate)})</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="w-24">
            <Label>Qty</Label>
            <Input className="mt-1" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={addItem}>Add item</Button>
          <Button type="button" variant="outline" onClick={addCustom}>Add custom</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>S.No</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.items.map((it, idx) => (
              <TableRow key={idx}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell><Input value={it.code} onChange={(e) => updateItem(idx, 'code', e.target.value)} /></TableCell>
                <TableCell><Input value={it.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} /></TableCell>
                <TableCell><Input value={it.unit} onChange={(e) => updateItem(idx, 'unit', e.target.value)} /></TableCell>
                <TableCell><Input type="number" step="any" value={it.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} /></TableCell>
                <TableCell><Input type="number" step="any" value={it.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} /></TableCell>
                <TableCell className="font-semibold"><Money value={it.amount} /></TableCell>
                <TableCell><Button size="sm" variant="destructive" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }))}>Remove</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 text-right font-semibold">TOTAL: <Money value={total} /></div>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {showSubmit ? <Button className="w-full sm:w-auto" disabled={saving} onClick={() => save(true)}>Submit JSR for approval</Button> : null}
        {canSaveDraft ? <Button className="w-full sm:w-auto" disabled={saving} variant={showSubmit ? 'outline' : 'default'} onClick={() => save(false)}>{saveLabel}</Button> : null}
        <Button className="w-full sm:w-auto" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function PackagePickerLabel({ pkg }) {
  const label = jsrPackagePickerName(pkg);
  return (
    <>
      <div className="font-medium">{label.primary}</div>
      {label.secondary ? <div className="text-xs text-muted-foreground">{label.secondary}</div> : null}
    </>
  );
}
