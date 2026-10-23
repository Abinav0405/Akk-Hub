import React from 'react';
import { useAdminDash } from '../AdminDashContext';
import { AdminChoiceCard, glassPanel } from '@/ui/PortalShell';
import { Button } from '@/ui/button';
import { Edit2, FileSpreadsheet, Loader2, Printer, Search, Trash2, User, UserCheck, Users } from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { isHubAdmin } from '@/modules/timesheet/lib/workerPrivacy';
import { UNIFIED } from '@/core/supabase';
import WorkerInfoCenter from '@/features/workerInfo/WorkerInfoCenter';
import { openWorkerLookup, openWorkerProfile } from '@/features/workerInfo/WorkerProfile';

/**
 * Sticky identity columns — widths/left/z-index live in glass.css (.akk-worker-table).
 *   ID 4.5rem → left 0 | NRIC 7.5rem → left 4.5rem | Name 11rem → left 12rem
 */
const TH =
  'sticky top-0 z-30 whitespace-nowrap bg-[var(--g-surface-inset,#f1f5f9)] px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--g-muted)] shadow-[0_1px_0_var(--g-hairline-2,rgb(15_29_51/0.1))]';
const TH_NUM = cn(TH, 'text-right tabular-nums');
const TH_ID = cn(TH, 'akk-sticky-id');
const TH_NRIC = cn(TH, 'akk-sticky-nric');
const TH_NAME = cn(TH, 'akk-sticky-name');

const TD = 'px-2.5 py-1.5 text-[13px] text-slate-700';
const TD_NUM = cn(TD, 'text-right tabular-nums text-slate-800');
const TD_ID = (extra) => cn('akk-sticky-id px-2.5 py-1.5 font-mono text-xs', extra);
const TD_NRIC = (extra) => cn('akk-sticky-nric px-2.5 py-1.5 text-[13px] text-slate-700', extra);
const TD_NAME = (extra) => cn('akk-sticky-name px-2.5 py-1.5 font-medium text-slate-900', extra);

function StatusPills({ total, active, left, t }) {
  return (
    <>
      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
        {t('ui.total', { count: total })}
      </span>
      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        {t('ui.activeCount', { count: active })}
      </span>
      {left > 0 && (
        <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">
          {t('ui.notInCompany', { count: left })}
        </span>
      )}
    </>
  );
}

function WorkerMobileCards({ workers, workerIsNotInCompany, formatAmount }) {
  return (
    <div className="space-y-2 md:hidden">
      {workers.map((w) => {
        const notInCompany = workerIsNotInCompany(w);
        return (
          <div
            key={w.employee_id}
            className={cn(
              'rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface)] p-3.5 text-sm',
              notInCompany && 'border-red-200 bg-red-50/80',
            )}
          >
            <p className="font-semibold text-slate-900">{w.employee_name}</p>
            <p className="font-mono text-xs text-slate-500">
              ID {w.employee_id} · {w.nric_fin}
            </p>
            <p className="mt-1 text-xs text-slate-600">{w.designation || '—'}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-slate-700">
              <span>Basic/day {formatAmount(w.basic_salary_per_day)}</span>
              <span>
                AL {w.annual_leave_balance}/{w.annual_leave_limit}
              </span>
              <span>
                MC {w.medical_leave_balance}/{w.medical_leave_limit}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkerInfoTab() {
  const {
    exportWorkersToExcel,
    foreignWorkers,
    foreignWorkersDirectory,
    formatAmount,
    formatRejoinDatesCell,
    handleAddWorkerClick,
    handleDeleteWorkerClick,
    handleEditWorkerClick,
    handleWorkerSearchClick,
    isLoadingForeignWorkers,
    isLoadingLocalWorkers,
    localWorkers,
    localWorkersDirectory,
    printWorkerDetails,
    setShowManagerDialog,
    setShowSupervisorDialog,
    t,
    workerIsNotInCompany,
  } = useAdminDash();

  // Local-worker NRIC/bank/pay columns are admin-only — never mount for other roles.
  if (!isHubAdmin()) return null;

  const localRows = localWorkers
    ? [...localWorkersDirectory.active, ...localWorkersDirectory.leftCompany]
    : [];
  const foreignRows = foreignWorkers
    ? [...foreignWorkersDirectory.active, ...foreignWorkersDirectory.leftCompany]
    : [];

  return (
    <div className="space-y-4" data-tour="admin-worker-info-panel">
      <section className={cn(glassPanel, 'akk-panel p-4 sm:p-5')}>
        <div className="mb-4 flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-[var(--g-ink)]">{t('ui.workerDirectory')}</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-[var(--g-muted)]">{t('ui.workerDirectoryHint')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <AdminChoiceCard
            icon={User}
            tone="emerald"
            title={t('ui.addWorker')}
            subtitle={t('ui.addWorkerHint')}
            onClick={handleAddWorkerClick}
            data-tour="admin-worker-add"
            className="min-h-[7.5rem]"
          />
          <AdminChoiceCard
            icon={Edit2}
            tone="sky"
            title={t('ui.editWorker')}
            subtitle={t('ui.editWorkerHint')}
            onClick={UNIFIED ? () => openWorkerLookup('edit') : handleEditWorkerClick}
            className="min-h-[7.5rem]"
          />
          <AdminChoiceCard
            icon={Search}
            tone="amber"
            title={t('ui.searchWorker')}
            subtitle={t('ui.searchWorkerHint')}
            onClick={UNIFIED ? openWorkerLookup : handleWorkerSearchClick}
            className="min-h-[7.5rem]"
          />
          <AdminChoiceCard
            icon={Users}
            tone="sky"
            title={t('ui.managers')}
            subtitle={t('ui.managersHint')}
            onClick={() => setShowManagerDialog(true)}
            className="min-h-[7.5rem]"
          />
          <AdminChoiceCard
            icon={UserCheck}
            tone="indigo"
            title={t('ui.supervisors')}
            subtitle={t('ui.supervisorsHint')}
            onClick={() => setShowSupervisorDialog(true)}
            className="min-h-[7.5rem]"
          />
          <AdminChoiceCard
            icon={Trash2}
            tone="rose"
            title={t('ui.deleteWorker')}
            subtitle={t('ui.deleteWorkerHint')}
            onClick={handleDeleteWorkerClick}
            className="min-h-[7.5rem]"
          />
        </div>
      </section>

      {UNIFIED ? <WorkerInfoCenter /> : null}

      <section className={cn(glassPanel, 'akk-panel p-4 sm:p-5')}>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
              <User className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-base font-semibold tracking-tight text-[var(--g-ink)]">{t('ui.localWorkers')}</h2>
                {!isLoadingLocalWorkers && localWorkers && (
                  <StatusPills
                    total={localWorkers.length}
                    active={localWorkersDirectory.active.length}
                    left={localWorkersDirectory.leftCompany.length}
                    t={t}
                  />
                )}
              </div>
              <p className="mt-0.5 text-sm text-[var(--g-muted)]">{t('ui.localWorkersHint')}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button
              variant="outline"
              className="h-9 rounded-lg border-[var(--g-hairline)] bg-[var(--g-surface)]"
              onClick={() => exportWorkersToExcel('local')}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              {t('ui.export')}
            </Button>
            <Button
              variant="outline"
              className="h-9 rounded-lg border-[var(--g-hairline)] bg-[var(--g-surface)]"
              onClick={() => printWorkerDetails('local')}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              {t('ui.print')}
            </Button>
          </div>
        </div>
        {isLoadingLocalWorkers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : localWorkers && localWorkers.length > 0 ? (
          <>
            <WorkerMobileCards
              workers={localRows}
              workerIsNotInCompany={workerIsNotInCompany}
              formatAmount={formatAmount}
            />
            <div className="nested-touch-scroll akk-table-scroll hidden max-h-[min(70vh,560px)] overflow-auto rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface)] md:block">
              <table className="akk-worker-table w-full min-w-[1180px] text-sm">
                <thead>
                  <tr>
                    <th className={TH_ID}>ID</th>
                    <th className={TH_NRIC}>NRIC/FIN</th>
                    <th className={TH_NAME}>Name</th>
                    <th className={TH}>Designation</th>
                    <th className={TH}>Date joined</th>
                    <th className={cn(TH, 'min-w-[5.5rem]')}>Bank</th>
                    <th className={TH_NUM}>Basic/day</th>
                    <th className={TH_NUM}>Monthly allow.</th>
                    <th className={TH_NUM}>OT rate</th>
                    <th className={TH_NUM}>Sun/PH rate</th>
                    <th className={TH_NUM}>AL limit</th>
                    <th className={TH_NUM}>MC limit</th>
                    <th className={TH_NUM}>AL bal.</th>
                    <th className={TH_NUM}>MC bal.</th>
                    <th className={TH_NUM}>CPF emp %</th>
                    <th className={TH_NUM}>CPF empr %</th>
                    <th className={TH_NUM}>SINDA</th>
                    <th className={TH}>Cessation</th>
                    <th className={TH}>Rejoined</th>
                  </tr>
                </thead>
                <tbody>
                  {localRows.map((w, idx) => {
                    const showLeftSectionHeader =
                      localWorkersDirectory.leftCompany.length > 0 &&
                      idx === localWorkersDirectory.active.length;
                    const notInCompany = workerIsNotInCompany(w);
                    return (
                      <React.Fragment key={w.employee_id}>
                        {showLeftSectionHeader && (
                          <tr>
                            <td colSpan={3} className="akk-section-banner-label">
                              Workers not in company ({localWorkersDirectory.leftCompany.length})
                            </td>
                            <td colSpan={16} className="akk-section-banner-rest" />
                          </tr>
                        )}
                        <tr
                          className={cn(
                            'group border-b border-[var(--g-hairline)] transition-colors hover:bg-slate-50/90',
                            notInCompany ? 'akk-row-left bg-red-50/95 hover:bg-red-50' : 'bg-white',
                          )}
                        >
                          <td
                            className={TD_ID(
                              notInCompany ? 'font-semibold text-red-700' : 'text-slate-800',
                            )}
                          >
                            {UNIFIED ? (
                              <button type="button" onClick={() => openWorkerProfile(w.employee_id)} className="underline-offset-2 hover:text-[var(--g-brand-text)] hover:underline">
                                {w.employee_id}
                              </button>
                            ) : (
                              w.employee_id
                            )}
                          </td>
                          <td className={TD_NRIC()}>{w.nric_fin}</td>
                          <td className={TD_NAME()} title={w.employee_name}>
                            {UNIFIED ? (
                              <button type="button" onClick={() => openWorkerProfile(w.employee_id)} className="text-left font-medium text-slate-900 underline-offset-2 hover:text-[var(--g-brand-text)] hover:underline">
                                {w.employee_name}
                              </button>
                            ) : (
                              w.employee_name
                            )}
                          </td>
                          <td className={cn(TD, 'max-w-[140px] break-words')}>{w.designation}</td>
                          <td className={cn(TD, 'whitespace-nowrap')}>{w.date_joined}</td>
                          <td className={cn(TD, 'max-w-[120px] break-all font-mono text-xs text-slate-600')}>
                            {w.bank_account_number}
                          </td>
                          <td className={TD_NUM}>{formatAmount(w.basic_salary_per_day)}</td>
                          <td className={TD_NUM}>{formatAmount(w.monthly_allowance)}</td>
                          <td className={TD_NUM}>{formatAmount(w.ot_rate_per_hour)}</td>
                          <td className={TD_NUM}>{formatAmount(w.sun_ph_rate_per_day)}</td>
                          <td className={TD_NUM}>{w.annual_leave_limit}</td>
                          <td className={TD_NUM}>{w.medical_leave_limit}</td>
                          <td className={TD_NUM}>{w.annual_leave_balance}</td>
                          <td className={TD_NUM}>{w.medical_leave_balance}</td>
                          <td className={TD_NUM}>{w.cpf_employee_contribution}</td>
                          <td className={TD_NUM}>{w.cpf_employer_contribution}</td>
                          <td className={TD_NUM}>{formatAmount(w.sinda_contribution)}</td>
                          <td className={cn(TD, 'whitespace-nowrap')}>{w.date_of_cessation || '—'}</td>
                          <td className={cn(TD, 'max-w-[180px] break-words')}>{formatRejoinDatesCell(w)}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-[var(--g-r-lg,1rem)] border border-dashed border-slate-200 bg-[var(--g-surface)] py-10 text-center text-sm text-slate-500">
            {t('ui.noLocalWorkers')}
          </div>
        )}
      </section>

      <section className={cn(glassPanel, 'akk-panel p-4 sm:p-5')}>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--g-brand-soft)] text-[var(--g-brand)]">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-base font-semibold tracking-tight text-[var(--g-ink)]">{t('ui.foreignWorkers')}</h2>
                {!isLoadingForeignWorkers && foreignWorkers && (
                  <StatusPills
                    total={foreignWorkers.length}
                    active={foreignWorkersDirectory.active.length}
                    left={foreignWorkersDirectory.leftCompany.length}
                    t={t}
                  />
                )}
              </div>
              <p className="mt-0.5 text-sm text-[var(--g-muted)]">{t('ui.foreignWorkersHint')}</p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button
              variant="outline"
              className="h-9 rounded-lg border-[var(--g-hairline)] bg-[var(--g-surface)]"
              onClick={() => exportWorkersToExcel('foreign')}
            >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              {t('ui.export')}
            </Button>
            <Button
              variant="outline"
              className="h-9 rounded-lg border-[var(--g-hairline)] bg-[var(--g-surface)]"
              onClick={() => printWorkerDetails('foreign')}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              {t('ui.print')}
            </Button>
          </div>
        </div>
        {isLoadingForeignWorkers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : foreignWorkers && foreignWorkers.length > 0 ? (
          <>
            <WorkerMobileCards
              workers={foreignRows}
              workerIsNotInCompany={workerIsNotInCompany}
              formatAmount={formatAmount}
            />
            <div className="nested-touch-scroll akk-table-scroll hidden max-h-[min(70vh,560px)] overflow-auto rounded-[var(--g-r-lg,1rem)] border border-[var(--g-hairline)] bg-[var(--g-surface)] md:block">
              <table className="akk-worker-table w-full min-w-[1080px] text-sm">
                <thead>
                  <tr>
                    <th className={TH_ID}>ID</th>
                    <th className={TH_NRIC}>NRIC/FIN</th>
                    <th className={TH_NAME}>Name</th>
                    <th className={TH}>Designation</th>
                    <th className={TH}>Date joined</th>
                    <th className={cn(TH, 'min-w-[5.5rem]')}>Bank</th>
                    <th className={TH_NUM}>Basic/day</th>
                    <th className={TH_NUM}>Monthly allow.</th>
                    <th className={TH_NUM}>OT rate</th>
                    <th className={TH_NUM}>Sun/PH rate</th>
                    <th className={TH_NUM}>AL limit</th>
                    <th className={TH_NUM}>MC limit</th>
                    <th className={TH_NUM}>AL bal.</th>
                    <th className={TH_NUM}>MC bal.</th>
                    <th className={TH}>Cessation</th>
                    <th className={TH}>Rejoined</th>
                  </tr>
                </thead>
                <tbody>
                  {foreignRows.map((w, idx) => {
                    const showLeftSectionHeader =
                      foreignWorkersDirectory.leftCompany.length > 0 &&
                      idx === foreignWorkersDirectory.active.length;
                    const notInCompany = workerIsNotInCompany(w);
                    return (
                      <React.Fragment key={w.employee_id}>
                        {showLeftSectionHeader && (
                          <tr>
                            <td colSpan={3} className="akk-section-banner-label">
                              Workers not in company ({foreignWorkersDirectory.leftCompany.length})
                            </td>
                            <td colSpan={13} className="akk-section-banner-rest" />
                          </tr>
                        )}
                        <tr
                          className={cn(
                            'group border-b border-[var(--g-hairline)] transition-colors hover:bg-slate-50/90',
                            notInCompany ? 'akk-row-left bg-red-50/95 hover:bg-red-50' : 'bg-white',
                          )}
                        >
                          <td
                            className={TD_ID(
                              notInCompany ? 'font-semibold text-red-700' : 'text-slate-800',
                            )}
                          >
                            {UNIFIED ? (
                              <button type="button" onClick={() => openWorkerProfile(w.employee_id)} className="underline-offset-2 hover:text-[var(--g-brand-text)] hover:underline">
                                {w.employee_id}
                              </button>
                            ) : (
                              w.employee_id
                            )}
                          </td>
                          <td className={TD_NRIC()}>{w.nric_fin}</td>
                          <td className={TD_NAME()} title={w.employee_name}>
                            {UNIFIED ? (
                              <button type="button" onClick={() => openWorkerProfile(w.employee_id)} className="text-left font-medium text-slate-900 underline-offset-2 hover:text-[var(--g-brand-text)] hover:underline">
                                {w.employee_name}
                              </button>
                            ) : (
                              w.employee_name
                            )}
                          </td>
                          <td className={cn(TD, 'max-w-[140px] break-words')}>{w.designation}</td>
                          <td className={cn(TD, 'whitespace-nowrap')}>{w.date_joined}</td>
                          <td className={cn(TD, 'max-w-[120px] break-all font-mono text-xs text-slate-600')}>
                            {w.bank_account_number}
                          </td>
                          <td className={TD_NUM}>{formatAmount(w.basic_salary_per_day)}</td>
                          <td className={TD_NUM}>{formatAmount(w.monthly_allowance)}</td>
                          <td className={TD_NUM}>{formatAmount(w.ot_rate_per_hour)}</td>
                          <td className={TD_NUM}>{formatAmount(w.sun_ph_rate_per_day)}</td>
                          <td className={TD_NUM}>{w.annual_leave_limit}</td>
                          <td className={TD_NUM}>{w.medical_leave_limit}</td>
                          <td className={TD_NUM}>{w.annual_leave_balance}</td>
                          <td className={TD_NUM}>{w.medical_leave_balance}</td>
                          <td className={cn(TD, 'whitespace-nowrap')}>{w.date_of_cessation || '—'}</td>
                          <td className={cn(TD, 'max-w-[180px] break-words')}>{formatRejoinDatesCell(w)}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-[var(--g-r-lg,1rem)] border border-dashed border-slate-200 bg-[var(--g-surface)] py-10 text-center text-sm text-slate-500">
            No foreign workers found.
          </div>
        )}
      </section>
    </div>
  );
}
