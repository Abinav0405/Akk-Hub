import React from 'react';
import { useAdminDash } from '../AdminDashContext';
import { AdminFieldLabel, glassInput, glassPanel } from '@/ui/PortalShell';
import { Button } from '@/ui/button';
import { Download, FileSpreadsheet, FileText, History, Loader2, Printer, Trash2 } from 'lucide-react';
import { Input } from '@/ui/input';
import { cn } from '@/modules/timesheet/lib/utils';
import { confirmAction } from '@/ui/native/NativeConfirm';

export default function TimesheetReportTab() {
  const {
    adminApproveTimesheet,
    adminResendToWorker,
    deletePassedOutTimesheet,
    handleDownloadPassedOutTimesheet,
    handlePrintAllPassedOutTimesheets,
    handlePrintTimesheetReportSummary,
    handleViewPassedOutTimesheet,
    isFetchingAdminTimesheets,
    openTimesheetHistory,
    passedOutTimesheetsData,
    queryClient,
    recreateAndResendTimesheet,
    resendSameTimesheet,
    setAdminDeclineTimesheetDialog,
    setTimesheetReportMonth,
    t,
    timesheetReportMonth,
  } = useAdminDash();

  return (
    <>
      <section className={cn(glassPanel, 'p-4 sm:p-5')} data-tour="admin-timesheet-panel">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                                  <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                                  <FileText className="h-5 w-5 text-slate-700" />
                                  Passed out timesheets
                                  {passedOutTimesheetsData.length > 0 && (
                                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                              {passedOutTimesheetsData.length} record{passedOutTimesheetsData.length !== 1 ? 's' : ''}
                                          </span>
                                  )}
                                  </h2>
                                  <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                                      Review approval status, then approve or return items waiting on admin.
                                  </p>
                          </div>
                          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-end">
                          <div className="col-span-2 space-y-1.5 sm:col-span-1">
                              <AdminFieldLabel>Month</AdminFieldLabel>
                              <Input
                                  type="month"
                                  value={timesheetReportMonth}
                                  onChange={(e) => setTimesheetReportMonth(e.target.value)}
                                  className={cn(glassInput, 'h-10 w-full min-w-[200px] sm:w-52')}
                              />
                          </div>
                          <Button
                              onClick={() => queryClient.invalidateQueries({ queryKey: ['adminPassedOutTimesheets', timesheetReportMonth] })}
                              disabled={isFetchingAdminTimesheets || !timesheetReportMonth}
                              className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                              data-tour="admin-timesheet-load"
                          >
                              {isFetchingAdminTimesheets ? (
                                  <>
                                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                      Loading…
                                  </>
                              ) : (
                                  <>
                                      <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                                      Load timesheets
                                  </>
                              )}
                          </Button>
                          <Button
                              type="button"
                              variant="outline"
                              onClick={() => handlePrintTimesheetReportSummary()}
                              disabled={passedOutTimesheetsData.length === 0 || isFetchingAdminTimesheets}
                              className="h-10 rounded-xl border-slate-200 bg-white/70"
                          >
                              <Printer className="mr-1.5 h-4 w-4" />
                              {t('ui.print')} summary
                          </Button>
                          <Button
                              type="button"
                              variant="outline"
                              onClick={() => handlePrintAllPassedOutTimesheets()}
                              disabled={passedOutTimesheetsData.length === 0 || isFetchingAdminTimesheets}
                              className="h-10 rounded-xl border-slate-200 bg-white/70"
                          >
                              <Printer className="mr-1.5 h-4 w-4" />
                              {t('ui.print')} all
                          </Button>
                          </div>
                  </div>

                  {passedOutTimesheetsData.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {passedOutTimesheetsData.map((ts) => {
                              const statusConfig = {
                                  pending_worker: { bg: 'bg-amber-50/90 border-amber-200', text: 'text-amber-900', label: 'Not approved yet' },
                                  returned_to_worker: { bg: 'bg-blue-50/90 border-blue-200', text: 'text-blue-900', label: `Returned back to worker for re-approval${ts.manager_name ? ` by ${ts.manager_name}` : ''}` },
                                  awaiting_manager: { bg: 'bg-lime-50/90 border-lime-300', text: 'text-lime-900', label: 'Submitted by employee, awaiting manager' },
                                  awaiting_admin: { bg: 'bg-lime-50/90 border-lime-300', text: 'text-lime-900', label: 'Submitted by employee, awaiting admin' },
                                  approved: { bg: 'bg-emerald-50/90 border-emerald-300', text: 'text-emerald-900', label: `Approved by ${ts.manager_name || 'manager/admin'}` },
                                  declined_by_worker: { bg: 'bg-red-50/90 border-red-200', text: 'text-red-900', label: `Declined by worker${ts.worker_decline_reason ? `: ${ts.worker_decline_reason}` : ''}` },
                                  declined_by_manager: {
                                      bg: 'bg-red-50/90 border-red-200',
                                      text: 'text-red-900',
                                      label: (() => {
                                          const workerPart = ts.worker_decline_reason ? `Declined by worker: ${ts.worker_decline_reason}` : null;
                                          const managerPart = `Declined by manager${ts.manager_name ? ` (${ts.manager_name})` : ''}${ts.manager_decline_reason ? `: ${ts.manager_decline_reason}` : ''}`.trim() || 'Declined by manager';
                                          return [workerPart, managerPart].filter(Boolean).join('. ');
                                      })()
                                  }
                              };
                              const cfg = statusConfig[ts.status] || statusConfig.pending_worker;
                              const monthLabel = `${String(ts.month).padStart(2, '0')}/${ts.year}`;
                              const isDeclined = ts.status === 'declined_by_worker' || ts.status === 'declined_by_manager';
                              const isAwaitingAdmin = ts.status === 'awaiting_admin';
                              return (
                                  <div
                                      key={ts.id}
                                      className={`flex flex-col rounded-2xl border p-4 ${cfg.bg}`}
                                  >
                                              <div className="min-w-0">
                                                  <p className="break-words text-base font-semibold leading-snug text-slate-900">{ts.worker_name}</p>
                                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                                                      <span className="max-w-full break-words font-mono">ID {ts.worker_id}</span>
                                                      <span className="shrink-0 rounded-md bg-white/80 px-2 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200/80">{monthLabel}</span>
                                                      {(ts.revision || 1) > 1 && (
                                                          <span className="shrink-0 rounded-md bg-white/80 px-2 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200/80">Rev {ts.revision}</span>
                                                      )}
                                                      {ts.is_stale && (
                                                          <span className="shrink-0 rounded-md bg-orange-100 px-2 py-0.5 font-semibold text-orange-800 ring-1 ring-orange-300">Out of date</span>
                                                      )}
                                                  </div>
                                              </div>
                                          <p className={`mt-3 text-sm leading-snug ${cfg.text}`}>{cfg.label}</p>
                                          {ts.is_stale && (
                                              <p className="mt-1 text-xs leading-snug text-orange-800">
                                                  Shifts changed after this was passed out. Update it so the worker approves the latest hours.
                                              </p>
                                          )}
                                          <div className="mt-auto flex flex-col gap-2 pt-3">
                                          {ts.is_stale && !isDeclined && (
                                              <Button
                                                  size="sm"
                                                  className="h-9 w-full rounded-xl bg-orange-600 hover:bg-orange-700"
                                                  onClick={() => recreateAndResendTimesheet.mutate(ts)}
                                                  disabled={recreateAndResendTimesheet.isPending}
                                              >
                                                  Update timesheet
                                              </Button>
                                          )}
                                          {isAwaitingAdmin && (
                                              <>
                                                  <Button size="sm" className="h-9 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={() => adminApproveTimesheet.mutate(ts)} disabled={adminApproveTimesheet.isPending}>
                                                      Approve
                                                  </Button>
                                                  <Button size="sm" variant="outline" className="h-9 w-full rounded-xl border-slate-200 bg-white" onClick={() => adminResendToWorker.mutate(ts)} disabled={adminResendToWorker.isPending}>
                                                      Return to worker
                                                  </Button>
                                                  <Button size="sm" variant="destructive" className="h-9 w-full rounded-xl" onClick={() => setAdminDeclineTimesheetDialog(ts)}>
                                                      Decline
                                                  </Button>
                                              </>
                                          )}
                                          {isDeclined && (
                                              <>
                                                  <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-9 w-full rounded-xl border-slate-200 bg-white"
                                                      onClick={() => resendSameTimesheet.mutate(ts)}
                                                      disabled={resendSameTimesheet.isPending || recreateAndResendTimesheet.isPending}
                                                  >
                                                      Resend same timesheet
                                                  </Button>
                                                  <Button
                                                      size="sm"
                                                      className="h-9 w-full rounded-xl bg-amber-600 hover:bg-amber-700"
                                                      onClick={() => recreateAndResendTimesheet.mutate(ts)}
                                                      disabled={resendSameTimesheet.isPending || recreateAndResendTimesheet.isPending}
                                                  >
                                                      Update and resend
                                                  </Button>
                                              </>
                                          )}
                                                  <div className="flex gap-2">
                                                  <Button size="sm" variant="outline" className="h-9 flex-1 rounded-xl border-slate-200 bg-white text-xs" onClick={() => handleViewPassedOutTimesheet(ts)}>
                                                      <FileText className="mr-1 h-3.5 w-3.5" /> View
                                                  </Button>
                                                  <Button size="sm" variant="outline" className="h-9 flex-1 rounded-xl border-slate-200 bg-white text-xs" onClick={() => handleDownloadPassedOutTimesheet(ts)}>
                                                      <Download className="mr-1 h-3.5 w-3.5" /> Print
                                                  </Button>
                                                  {(ts.revision || 1) > 1 && (
                                                      <Button size="sm" variant="outline" className="h-9 flex-1 rounded-xl border-slate-200 bg-white text-xs" onClick={() => openTimesheetHistory(ts)}>
                                                          <History className="mr-1 h-3.5 w-3.5" /> History
                                                      </Button>
                                                  )}
                                                  <Button
                                                      size="sm"
                                                      variant="ghost"
                                                      className="h-9 w-9 shrink-0 rounded-xl px-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                      onClick={async () => {
                                                          if (await confirmAction({ title: 'Delete timesheet?', message: 'Delete this timesheet? This cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
                                                              deletePassedOutTimesheet.mutate(ts.id);
                                                          }
                                                      }}
                                                      disabled={deletePassedOutTimesheet.isPending}
                                                      title="Delete"
                                                  >
                                                      <Trash2 className="h-4 w-4" />
                                                  </Button>
                                                  </div>
                                          </div>
                                  </div>
                              );
                          })}
                      </div>
                  )}

                  {passedOutTimesheetsData.length === 0 && timesheetReportMonth && (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-14 text-center">
                          <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                          <h4 className="text-base font-semibold text-slate-800">No timesheets found</h4>
                          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                              No passed-out timesheets for this month. Use Pass out timesheet to send timesheets to workers.
                          </p>
                      </div>
                  )}

                  {!timesheetReportMonth && (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-12 text-center text-sm text-slate-600">
                          Select a month above, then click <span className="font-medium text-slate-800">Load timesheets</span>.
                      </div>
                  )}
      </section>
    </>
  );
}
