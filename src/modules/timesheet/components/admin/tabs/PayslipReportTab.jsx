import React from 'react';
import { useAdminDash } from '../AdminDashContext';
import { AdminFieldLabel, glassInput, glassPanel } from '@/ui/PortalShell';
import { Button } from '@/ui/button';
import { Edit2, FileSpreadsheet, FileText, Loader2, Printer, Receipt, Trash2 } from 'lucide-react';
import { Input } from '@/ui/input';
import MoreMenu from '@/modules/progress/components/MoreMenu';
import PayBalancesPanel from '@/modules/timesheet/components/payroll/PayBalancesPanel';
import { cn } from '@/modules/timesheet/lib/utils';
import { confirmAction } from '@/ui/native/NativeConfirm';
import { stripSysAdditions } from '@/modules/timesheet/lib/payslipOverrides';
import { isHubAdmin } from '@/modules/timesheet/lib/workerPrivacy';

export default function PayslipReportTab() {
  const {
    deletePayslip,
    fetchPayslipReport,
    handlePrintAllPassedOutPayslipReport,
    handlePrintPassedOutPayslipReport,
    handlePrintPayslipReportSummary,
    handleViewPassedOutPayslipReport,
    payslipReportData,
    payslipReportMonth,
    setEditingPayslip,
    setPayslipEditForm,
    setPayslipReportMonth,
    t,
  } = useAdminDash();

  if (!isHubAdmin()) return null;

  return (
    <>
      <section className={cn(glassPanel, 'p-4 sm:p-5')} data-tour="admin-payslip-panel">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                                  <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
                                  <Receipt className="h-5 w-5 text-slate-700" />
                                  Payslip report
                                  {payslipReportData && payslipReportData.length > 0 && (
                                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                                              {payslipReportData.length} record{payslipReportData.length !== 1 ? 's' : ''}
                                          </span>
                                  )}
                                  </h2>
                                  <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                                      Passed-out payslips for the selected month. Print all for one job, or View / Print per row.
                                  </p>
                          </div>
                          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-end">
                          <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1">
                              <AdminFieldLabel>Month</AdminFieldLabel>
                              <Input
                                  type="month"
                                  value={payslipReportMonth}
                                  onChange={(e) => setPayslipReportMonth(e.target.value)}
                                  className={cn(glassInput, 'h-10 w-full min-w-0 sm:max-w-[13rem]')}
                              />
                          </div>
                          <Button
                              onClick={() => fetchPayslipReport.mutate()}
                              disabled={fetchPayslipReport.isPending || !payslipReportMonth}
                              className="h-10 rounded-xl bg-slate-800 hover:bg-slate-900"
                          >
                              {fetchPayslipReport.isPending ? (
                                  <>
                                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                      Loading…
                                  </>
                              ) : (
                                  <>
                                      <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                                      Load payslips
                                  </>
                              )}
                          </Button>
                          <Button
                              type="button"
                              variant="outline"
                              onClick={() => handlePrintPayslipReportSummary()}
                              disabled={
                                  !payslipReportData ||
                                  payslipReportData.length === 0 ||
                                  fetchPayslipReport.isPending
                              }
                              className="h-10 rounded-xl border-slate-200 bg-white/70"
                          >
                              <Printer className="mr-1.5 h-4 w-4" />
                              {t('ui.print')} summary
                          </Button>
                          <Button
                              type="button"
                              variant="outline"
                              onClick={() => handlePrintAllPassedOutPayslipReport()}
                              disabled={
                                  !payslipReportData ||
                                  payslipReportData.length === 0 ||
                                  fetchPayslipReport.isPending
                              }
                              className="h-10 rounded-xl border-slate-200 bg-white/70"
                          >
                              <Printer className="mr-1.5 h-4 w-4" />
                              {t('ui.print')} all
                          </Button>
                          </div>
                  </div>

                  {payslipReportData && payslipReportData.length > 0 && (
                          <>
                          <div className="space-y-3 md:hidden">
                              {payslipReportData.map((payslip) => (
                                  <div key={payslip.id} className="rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface)] p-4">
                                      <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                              <p className="font-mono text-sm font-semibold text-slate-900">{payslip.worker_id}</p>
                                              <p className="text-xs capitalize text-slate-500">{payslip.worker_type}</p>
                                          </div>
                                          <p className="shrink-0 text-lg font-semibold tabular-nums text-emerald-950">${parseFloat(payslip.net_pay || 0).toFixed(2)}</p>
                                      </div>
                                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                                          <div><dt className="text-slate-500">Basic</dt><dd className="font-medium tabular-nums">${parseFloat(payslip.basic_pay || 0).toFixed(2)}</dd></div>
                                          <div><dt className="text-slate-500">OT</dt><dd className="font-medium tabular-nums">${parseFloat(payslip.ot_pay || 0).toFixed(2)}</dd></div>
                                          <div><dt className="text-slate-500">Deductions</dt><dd className="font-medium tabular-nums">${parseFloat(payslip.total_deductions || 0).toFixed(2)}</dd></div>
                                          <div><dt className="text-slate-500">Additions</dt><dd className="font-medium tabular-nums">${parseFloat(payslip.total_additions || 0).toFixed(2)}</dd></div>
                                      </dl>
                                      <div className="mt-3 flex flex-col gap-2">
                                          <Button size="sm" variant="outline" className="h-11 w-full rounded-xl" onClick={() => handleViewPassedOutPayslipReport(payslip)}>
                                              <FileText className="mr-1.5 h-4 w-4" /> View
                                          </Button>
                                          <MoreMenu
                                              items={[
                                                  { label: 'Print', icon: <Printer className="h-4 w-4" />, onClick: () => handlePrintPassedOutPayslipReport(payslip) },
                                                  {
                                                      label: 'Edit',
                                                      icon: <Edit2 className="h-4 w-4" />,
                                                      onClick: () => {
                                                          setEditingPayslip(payslip);
                                                          setPayslipEditForm({
                                                              basic_pay: payslip.basic_pay?.toString() || '',
                                                              ot_pay: payslip.ot_pay?.toString() || '',
                                                              sun_ph_pay: payslip.sun_ph_pay?.toString() || '',
                                                              monthly_allowance: payslip.monthly_allowance?.toString() || '',
                                                              incentive_allowance: payslip.incentive_allowance?.toString() || '',
                                                              bonus: payslip.bonus?.toString() || '',
                                                              custom_additions: stripSysAdditions(payslip.custom_additions || []),
                                                              cpf_employee_deduction: payslip.cpf_employee_deduction?.toString() || '',
                                                              sinda_deduction: payslip.sinda_deduction?.toString() || '',
                                                              total_deductions: payslip.total_deductions?.toString() || '',
                                                              net_pay: payslip.net_pay?.toString() || '',
                                                              amount_paid: payslip.amount_paid != null ? String(payslip.amount_paid) : '',
                                                          });
                                                      },
                                                  },
                                                  {
                                                      label: 'Delete',
                                                      icon: <Trash2 className="h-4 w-4" />,
                                                      danger: true,
                                                      disabled: deletePayslip.isPending,
                                                      onClick: async () => {
                                                          if (await confirmAction({ title: 'Delete payslip?', message: 'Are you sure you want to delete this payslip? This action cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
                                                              deletePayslip.mutate(payslip.id);
                                                          }
                                                      },
                                                  },
                                              ]}
                                          />
                                      </div>
                                  </div>
                              ))}
                          </div>
                          <div className="hidden md:block overflow-x-auto rounded-2xl border border-[var(--g-hairline)] bg-[var(--g-surface)]">
                              <table className="w-full min-w-[1040px] border-collapse text-sm">
                                  <thead>
                                      <tr className="border-b border-slate-200 bg-slate-100/90">
                                          <th colSpan={2} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                              Worker
                                          </th>
                                          <th colSpan={6} className="border-l-2 border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                              Earnings & components
                                          </th>
                                          <th colSpan={3} className="border-l-2 border-slate-300 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                              Totals
                                          </th>
                                          <th className="border-l-2 border-slate-300 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                                              Actions
                                          </th>
                                      </tr>
                                      <tr className="border-b border-slate-200 bg-slate-50/90">
                                          <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-slate-600">ID</th>
                                          <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-slate-600">Type</th>
                                          <th className="whitespace-nowrap border-l-2 border-slate-200 px-3 py-2.5 text-right text-xs font-medium text-slate-600">Basic</th>
                                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-slate-600">OT</th>
                                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-slate-600">Sun/PH</th>
                                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-slate-600">Monthly</th>
                                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-slate-600">Incentive</th>
                                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-slate-600">Bonus</th>
                                          <th className="whitespace-nowrap border-l-2 border-slate-300 px-3 py-2.5 text-right text-xs font-medium text-slate-600">Additions</th>
                                          <th className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-slate-600">Deductions</th>
                                          <th className="whitespace-nowrap bg-emerald-50/80 px-3 py-2.5 text-right text-xs font-semibold text-emerald-900">Net pay</th>
                                          <th className="whitespace-nowrap border-l-2 border-slate-300 px-3 py-2.5 text-center text-xs font-medium text-slate-600" />
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                  {payslipReportData.map((payslip) => (
                                      <tr key={payslip.id} className="transition-colors hover:bg-slate-50/80">
                                          <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-800">{payslip.worker_id}</td>
                                          <td className="whitespace-nowrap px-4 py-2.5 capitalize text-slate-700">{payslip.worker_type}</td>
                                          <td className="whitespace-nowrap border-l-2 border-slate-100 px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.basic_pay || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.ot_pay || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.sun_ph_pay || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.monthly_allowance || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.incentive_allowance || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.bonus || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap border-l-2 border-slate-200 px-3 py-2.5 text-right tabular-nums font-medium text-slate-900">${parseFloat(payslip.total_additions || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">${parseFloat(payslip.total_deductions || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap bg-emerald-50/50 px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-emerald-950">${parseFloat(payslip.net_pay || 0).toFixed(2)}</td>
                                          <td className="whitespace-nowrap border-l-2 border-slate-200 px-2 py-2">
                                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                  <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-8 rounded-lg border-slate-200 text-xs"
                                                      onClick={() => handleViewPassedOutPayslipReport(payslip)}
                                                  >
                                                      <FileText className="mr-1 h-3.5 w-3.5" /> View
                                                  </Button>
                                                  <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-8 rounded-lg border-slate-200 text-xs"
                                                      onClick={() => handlePrintPassedOutPayslipReport(payslip)}
                                                  >
                                                      <Printer className="mr-1 h-3.5 w-3.5" /> Print
                                                  </Button>
                                                  <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-8 rounded-lg border-slate-200 px-2"
                                                      onClick={() => {
                                                          setEditingPayslip(payslip);
                                                          setPayslipEditForm({
                                                              basic_pay: payslip.basic_pay?.toString() || '',
                                                              ot_pay: payslip.ot_pay?.toString() || '',
                                                              sun_ph_pay: payslip.sun_ph_pay?.toString() || '',
                                                              monthly_allowance: payslip.monthly_allowance?.toString() || '',
                                                              incentive_allowance: payslip.incentive_allowance?.toString() || '',
                                                              bonus: payslip.bonus?.toString() || '',
                                                              custom_additions: stripSysAdditions(payslip.custom_additions || []),
                                                              cpf_employee_deduction: payslip.cpf_employee_deduction?.toString() || '',
                                                              sinda_deduction: payslip.sinda_deduction?.toString() || '',
                                                              total_deductions: payslip.total_deductions?.toString() || '',
                                                              net_pay: payslip.net_pay?.toString() || '',
                                                              amount_paid: payslip.amount_paid != null ? String(payslip.amount_paid) : ''
                                                          });
                                                      }}
                                                  >
                                                      <Edit2 className="w-4 h-4" />
                                                  </Button>
                                                  <Button
                                                      size="sm"
                                                      variant="destructive"
                                                      className="h-8 rounded-lg"
                                                      onClick={async () => {
                                                          if (await confirmAction({ title: 'Delete payslip?', message: 'Are you sure you want to delete this payslip? This action cannot be undone.', confirmLabel: 'Delete', destructive: true })) {
                                                              deletePayslip.mutate(payslip.id);
                                                          }
                                                      }}
                                                      disabled={deletePayslip.isPending}
                                                  >
                                                      <Trash2 className="w-4 h-4" />
                                                  </Button>
                                              </div>
                                          </td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                          </div>
                          </>
                  )}

                  {payslipReportData && payslipReportData.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-14 text-center">
                              <FileSpreadsheet className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                              <h4 className="text-base font-semibold text-slate-800">No payslips found</h4>
                              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Choose a month and load payslips, or try a different period.</p>
                      </div>
                  )}
      </section>
      <PayBalancesPanel />
    </>
  );
}
