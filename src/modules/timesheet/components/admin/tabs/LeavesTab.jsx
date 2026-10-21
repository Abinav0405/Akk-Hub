import React from 'react';
import { useAdminDash } from '../AdminDashContext';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Calendar, CheckCircle, Edit2, FileSpreadsheet, Loader2, Paperclip, PlusCircle, Printer, Settings, XCircle } from 'lucide-react';
import { DEFAULT_LEAVE_POLICY, countRequestedLeaveDays, getLeaveStatusLabel, normalizeLeaveType, requiresMedicalAttachment } from '@/modules/timesheet/lib/leaveService';
import LeaveCalendar from '@/modules/timesheet/components/LeaveCalendar';
import { cn } from '@/modules/timesheet/lib/utils';
import { format } from 'date-fns';
import { formatDate } from '@/modules/timesheet/lib/timeUtils';
import { glassPanel } from '@/ui/PortalShell';

export default function LeavesTab() {
  const {
    SHIFT_PAGE,
    allLeaveRequests,
    bulkLeaveStatusMutation,
    handleExportLeaveReport,
    handlePrintSingleLeaveForm,
    isLoadingLeaveRequests,
    isPrintingLeaveForms,
    leaveDashboardStats,
    leaveLimit,
    leavePolicySettings,
    leaveRequests,
    openLeaveAttachment,
    promptLeaveRejectReason,
    selectedLeaveIds,
    setEditingLeave,
    setLeaveEditData,
    setLeaveEditHardWarnings,
    setLeaveEditSoftWarnings,
    setLeaveLimit,
    setLeavePolicyForm,
    setSelectedLeaveIds,
    setShowCreateLeaveDialog,
    setShowEditLeaveDialog,
    setShowLeaveHistory,
    setShowLeavePolicyDialog,
    t,
    updateLeaveStatus,
  } = useAdminDash();

  return (
    <>
      <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={cn(glassPanel, 'px-4 py-4')}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending manager</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-amber-700">{leaveDashboardStats.pending_manager}</p>
              </div>
              <div className={cn(glassPanel, 'px-4 py-4')}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending admin</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700">
                      {leaveDashboardStats.pending_admin + leaveDashboardStats.pending}
                  </p>
              </div>
              <div className={cn(glassPanel, 'px-4 py-4')}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Overdue (&gt;72h)</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-red-700">{leaveDashboardStats.overdue}</p>
              </div>
              <div className={cn(glassPanel, 'px-4 py-4')}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">By type</p>
                  <div className="mt-1 max-h-16 space-y-0.5 overflow-y-auto text-xs text-slate-700">
                      {Object.keys(leaveDashboardStats.byType || {}).length === 0 ? (
                          <p className="text-slate-400">No data</p>
                      ) : (
                          Object.entries(leaveDashboardStats.byType)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 4)
                              .map(([type, count]) => (
                                  <p key={type} className="truncate">
                                      <span className="font-medium">{count}</span> {type}
                                  </p>
                              ))
                      )}
                  </div>
              </div>
          </div>

          <section className={cn(glassPanel, 'p-4 sm:p-5')} data-tour="admin-leaves-panel">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                                  <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                                  <Calendar className="h-5 w-5 text-emerald-600" />
                                  Leave approvals
                                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                                  {leaveRequests?.length ?? 0} pending
                                  </span>
                                  </h2>
                                  <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                                      Review pending requests. Edit before approving. MC/Hospitalization may need an attachment.
                                  </p>
                          </div>
                          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                              <Button
                                  type="button"
                                  className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                                  onClick={() => setShowCreateLeaveDialog(true)}
                              >
                                  <PlusCircle className="mr-1.5 h-4 w-4" />
                                  Create leave
                              </Button>
                              <Button
                                  type="button"
                                  variant="outline"
                                  className="h-10 rounded-xl border-slate-200 bg-white/70"
                                  onClick={() => setShowLeaveHistory(true)}
                                  data-tour="admin-leaves-history"
                              >
                                  <Calendar className="mr-1.5 h-4 w-4" />
                                  View history
                              </Button>
                              <Button
                                  type="button"
                                  variant="outline"
                                  className="h-10 rounded-xl border-slate-200 bg-white/70"
                                  onClick={() => {
                                      setLeavePolicyForm({
                                          ...DEFAULT_LEAVE_POLICY,
                                          ...(leavePolicySettings || {}),
                                      });
                                      setShowLeavePolicyDialog(true);
                                  }}
                              >
                                  <Settings className="mr-2 h-4 w-4" />
                                  Policy
                              </Button>
                              <Button
                                  type="button"
                                  variant="outline"
                                  className="h-10 rounded-xl border-slate-200 bg-white/70"
                                  onClick={handleExportLeaveReport}
                              >
                                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                                  {t('ui.exportExcel')}
                              </Button>
                          </div>
                      </div>
                      {leaveRequests?.length > 0 && (
                          <div className="mb-4 flex flex-wrap items-center gap-2">
                              <label className="flex items-center gap-2 text-xs text-slate-600">
                                  <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-slate-300"
                                      checked={
                                          selectedLeaveIds.length > 0 &&
                                          selectedLeaveIds.length === leaveRequests.length
                                      }
                                      onChange={() => {
                                          if (selectedLeaveIds.length === leaveRequests.length) {
                                              setSelectedLeaveIds([]);
                                          } else {
                                              setSelectedLeaveIds(leaveRequests.map((r) => r.id));
                                          }
                                      }}
                                  />
                                  Select all pending
                              </label>
                              <Button
                                  type="button"
                                  size="sm"
                                  className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                                  disabled={!selectedLeaveIds.length || bulkLeaveStatusMutation.isPending}
                                  onClick={() =>
                                      bulkLeaveStatusMutation.mutate({
                                          leaveIds: selectedLeaveIds,
                                          status: 'approved',
                                      })
                                  }
                              >
                                  Approve selected ({selectedLeaveIds.length})
                              </Button>
                              <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="h-9 rounded-xl"
                                  disabled={!selectedLeaveIds.length || bulkLeaveStatusMutation.isPending}
                                  onClick={() => {
                                      const reason = promptLeaveRejectReason();
                                      if (!reason) return;
                                      bulkLeaveStatusMutation.mutate({
                                          leaveIds: selectedLeaveIds,
                                          status: 'rejected',
                                          rejectionReason: reason,
                                      });
                                  }}
                              >
                                  Reject selected
                              </Button>
                          </div>
                      )}

                  {isLoadingLeaveRequests ? (
                      <div className="flex items-center justify-center py-16">
                          <Loader2 className="h-9 w-9 animate-spin text-slate-400" />
                      </div>
                  ) : leaveRequests?.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-14 text-center">
                          <Calendar className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                          <h4 className="text-base font-semibold text-slate-800">No pending requests</h4>
                          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">You’re all caught up. New worker submissions will show here.</p>
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {leaveRequests?.slice(0, leaveLimit).map((request) => {
                              const durationLabel = (() => {
                                  if (request.leave_duration === 'half_day_morning') return 'Half day — morning';
                                  if (request.leave_duration === 'half_day_afternoon') return 'Half day — afternoon';
                                  return 'Full day';
                              })();
                              const days = countRequestedLeaveDays(request);
                              const checked = selectedLeaveIds.includes(request.id);
                              const needsAttachment =
                                  requiresMedicalAttachment({
                                      leaveType: request.leave_type,
                                      requestedDays: days,
                                      policy: leavePolicySettings || DEFAULT_LEAVE_POLICY,
                                  }) && !request.attachment_path;
                              return (
                              <div key={request.id} className="flex flex-col rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface)]">
                                  <div className="flex flex-col p-4">
                                      <div className="mb-3 flex flex-col gap-2">
                                          <div className="flex min-w-0 items-start gap-2">
                                              <input
                                                  type="checkbox"
                                                  className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                                                  checked={checked}
                                                  onChange={() => {
                                                      setSelectedLeaveIds((prev) =>
                                                          prev.includes(request.id)
                                                              ? prev.filter((id) => id !== request.id)
                                                              : [...prev, request.id]
                                                      );
                                                  }}
                                              />
                                              <div className="min-w-0 flex-1">
                                              <p className="break-words text-base font-semibold leading-snug text-slate-900">{request.employee_name || 'Unknown'}</p>
                                              <p className="mt-0.5 font-mono text-xs text-slate-500">ID {request.employee_id}</p>
                                              </div>
                                          </div>
                                          <div className="flex flex-wrap gap-1">
                                              <Badge className="bg-emerald-100 text-emerald-900">
                                                  {normalizeLeaveType(request.leave_type)}
                                              </Badge>
                                              <Badge variant="outline" className="text-xs">
                                                  {getLeaveStatusLabel(request.status)}
                                              </Badge>
                                          </div>
                                      </div>
                                      <p className="mb-3 text-xs text-slate-500">
                                                  Submitted {format(new Date(request.created_at), 'MMM d, yyyy')}
                                      </p>

                                      <div className="space-y-3">
                                              {request.manager_name && (
                                                  <p className="mt-1 text-xs text-slate-500">
                                                      Manager: {request.manager_name}
                                                      {request.manager_approved_at ? ` · ${formatDate(request.manager_approved_at)}` : ''}
                                                  </p>
                                              )}
                                              {request.edited_by && (
                                                  <p className="mt-1 text-xs italic text-slate-500">
                                                      Edited by {request.edited_by}
                                                      {request.edited_at ? ` · ${formatDate(request.edited_at)}` : ''}
                                                      {request.amend_count > 0 ? ` · amended ${request.amend_count}×` : ''}
                                                  </p>
                                              )}
                                              {needsAttachment && (
                                                  <p className="mt-1 text-xs font-medium text-red-600">
                                                      Attachment required before approve
                                                  </p>
                                              )}
                                          </div>

                                          <dl className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-3 text-sm">
                                              <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                                                  <dt className="shrink-0 text-slate-500">Period</dt>
                                                  <dd className="text-right font-medium text-slate-800">
                                                      {formatDate(request.from_date)} → {formatDate(request.to_date)}
                                                  </dd>
                                              </div>
                                              <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                                                  <dt className="shrink-0 text-slate-500">Days</dt>
                                                  <dd className="text-right text-slate-800">{days}</dd>
                                              </div>
                                              <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                                                  <dt className="shrink-0 text-slate-500">Duration</dt>
                                                  <dd className="text-right text-slate-800">{durationLabel}</dd>
                                              </div>
                                              {request.reason ? (
                                                  <div>
                                                      <dt className="mb-1 text-slate-500">Reason</dt>
                                                      <dd className="break-words text-slate-800">{request.reason}</dd>
                                                  </div>
                                              ) : null}
                                          </dl>

                                      <div className="mt-auto flex flex-col gap-2 pt-3">
                                          <div className="flex gap-2">
                                          <Button
                                              type="button"
                                              size="sm"
                                              className="h-9 flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700"
                                              onClick={() => updateLeaveStatus.mutate({
                                                  id: request.id,
                                                  status: 'approved',
                                                  adminNotes: ''
                                              })}
                                              disabled={updateLeaveStatus.isPending || needsAttachment}
                                              title={needsAttachment ? 'Attachment required' : undefined}
                                          >
                                              <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                                              Approve
                                          </Button>
                                          <Button
                                              type="button"
                                              size="sm"
                                              variant="destructive"
                                              className="h-9 flex-1 rounded-xl"
                                              onClick={() => {
                                                  const reason = promptLeaveRejectReason();
                                                  if (!reason) return;
                                                  updateLeaveStatus.mutate({
                                                      id: request.id,
                                                      status: 'rejected',
                                                      adminNotes: reason,
                                                      rejectionReason: reason,
                                                  });
                                              }}
                                              disabled={updateLeaveStatus.isPending}
                                          >
                                              <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                              Reject
                                          </Button>
                                          </div>
                                          <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              className="h-9 w-full rounded-xl border-slate-200 bg-white"
                                              onClick={() => {
                                                  setEditingLeave(request);
                                                  setLeaveEditData({
                                                      leave_type: normalizeLeaveType(request.leave_type),
                                                      leave_duration: request.leave_duration,
                                                      from_date: request.from_date,
                                                      to_date: request.to_date,
                                                  });
                                                  setLeaveEditSoftWarnings([]);
                                                  setLeaveEditHardWarnings([]);
                                                  setShowEditLeaveDialog(true);
                                              }}
                                          >
                                              <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                                              Edit before approval
                                          </Button>
                                          <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              className="h-9 w-full rounded-xl border-slate-200 bg-white"
                                              onClick={() => handlePrintSingleLeaveForm(request)}
                                              disabled={isPrintingLeaveForms}
                                          >
                                              <Printer className="mr-1.5 h-3.5 w-3.5" />
                                              Print leave form
                                          </Button>
                                          {request.attachment_path && (
                                              <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="outline"
                                                  className="h-9 w-full rounded-xl border-slate-200 bg-white"
                                                  onClick={() => openLeaveAttachment(request.attachment_path)}
                                              >
                                                  <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                                                  View attachment
                                              </Button>
                                          )}
                                      </div>
                                  </div>
                              </div>
                              );
                          })}
                          {leaveRequests?.length > leaveLimit ? (
                              <button
                                  type="button"
                                  className="g-btn g-btn--secondary g-btn--block md:col-span-2 xl:col-span-3"
                                  onClick={() => setLeaveLimit((n) => n + (SHIFT_PAGE || 50))}
                              >
                                  Show more ({leaveRequests.length - leaveLimit} more)
                              </button>
                          ) : null}
                      </div>
                  )}
          </section>

          <LeaveCalendar
              leaveRequests={allLeaveRequests}
              onSelectLeave={(leave) => setShowLeaveHistory(true)}
          />
      </div>
    </>
  );
}
