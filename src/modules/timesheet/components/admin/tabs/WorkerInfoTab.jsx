import React, { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { paths } from '@/app/paths';
import { sectionHref } from '@/app/useHubSection';
import { useAdminDash } from '../AdminDashContext';
import { glassPanel } from '@/ui/PortalShell';
import { Button } from '@/ui/button';
import {
  ChevronRight, CreditCard, Edit2, FileSpreadsheet, IdCard, Loader2, Printer, Search, Table2, Trash2, UserCheck, UserPlus, Users, X,
} from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { isHubAdmin } from '@/modules/timesheet/lib/workerPrivacy';
import { UNIFIED } from '@/core/supabase';
import WorkerInfoCenter from '@/features/workerInfo/WorkerInfoCenter';
import { WorkerInfoAdminHost, openWorkerLookup, openWorkerProfile } from '@/features/workerInfo/WorkerProfile';
import { workerInfoAdmin } from '@/features/workerInfo/api';
import { EXPIRY_NAME_CLASS, expiryAlertTitle } from '@/features/workerInfo/expiryAlert';
import WorkerAccessTable from '@/modules/timesheet/components/admin/WorkerAccessTable';

const CardsAdminPanel = lazy(() => import('@/features/cards/CardsAdminPanel'));

/**
 * Admin → Workers.
 *   Quick actions · one switcher for Worker records / Information & requests / ID cards ·
 *   one worker table (Local | Foreign × Active | Not in company | All, with search).
 * Sticky identity columns — widths/left/z-index live in glass.css (.akk-worker-table).
 */
const TH =
  'sticky top-0 z-30 whitespace-nowrap bg-[var(--g-surface-inset,#f1f5f9)] px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--g-muted)] shadow-[0_1px_0_var(--g-hairline-2,rgb(15_29_51/0.1))]';
const TH_NUM = cn(TH, 'text-right tabular-nums');
const TD = 'px-3 py-2 text-[13px] text-slate-700';
const TD_NUM = cn(TD, 'whitespace-nowrap text-right tabular-nums text-slate-800');

/** Column sets per worker type — every field the old tables showed is kept. */
const columns = (type, { formatAmount, formatRejoinDatesCell }) => [
  { key: 'designation', label: 'Designation', cell: (w) => w.designation || '—', td: 'min-w-[9rem] max-w-[14rem] break-words' },
  { key: 'date_joined', label: 'Date joined', cell: (w) => w.date_joined || '—', td: 'whitespace-nowrap' },
  { key: 'bank', label: 'Bank', cell: (w) => w.bank_account_number || '—', td: 'min-w-[7rem] max-w-[10rem] break-all font-mono text-xs text-slate-600' },
  { key: 'basic', label: 'Basic/day', num: true, cell: (w) => formatAmount(w.basic_salary_per_day) },
  { key: 'allow', label: 'Monthly allow.', num: true, cell: (w) => formatAmount(w.monthly_allowance) },
  { key: 'ot', label: 'OT rate', num: true, cell: (w) => formatAmount(w.ot_rate_per_hour) },
  { key: 'sunph', label: 'Sun/PH rate', num: true, cell: (w) => formatAmount(w.sun_ph_rate_per_day) },
  { key: 'al', label: 'AL limit', num: true, cell: (w) => w.annual_leave_limit },
  { key: 'mc', label: 'MC limit', num: true, cell: (w) => w.medical_leave_limit },
  { key: 'alb', label: 'AL bal.', num: true, cell: (w) => w.annual_leave_balance },
  { key: 'mcb', label: 'MC bal.', num: true, cell: (w) => w.medical_leave_balance },
  ...(type === 'local'
    ? [
        { key: 'cpfe', label: 'CPF emp %', num: true, cell: (w) => w.cpf_employee_contribution },
        { key: 'cpfr', label: 'CPF empr %', num: true, cell: (w) => w.cpf_employer_contribution },
        { key: 'sinda', label: 'SINDA', num: true, cell: (w) => formatAmount(w.sinda_contribution) },
      ]
    : []),
  { key: 'cess', label: 'Cessation', cell: (w) => w.date_of_cessation || '—', td: 'whitespace-nowrap' },
  { key: 'rejoin', label: 'Rejoined', cell: (w) => formatRejoinDatesCell(w), td: 'min-w-[8rem] max-w-[12rem] break-words' },
];

const VIEWS = [
  ['records', 'Worker records', Table2],
  ['info', 'Information & requests', IdCard],
  ['cards', 'ID cards', CreditCard],
];
const VIEW_KEY = 'akk.workers.view';
const readView = () => {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    return VIEWS.some(([k]) => k === v) ? v : 'records';
  } catch {
    return 'records';
  }
};

function Segmented({ value, onChange, options, label, className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1', className)}>
      {options.map(([k, l, n]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn(
            'flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)]',
            value === k ? 'bg-white text-[var(--g-brand-text)] shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {l}
          {n != null ? <span className={cn('rounded-md px-1.5 text-[11px] tabular-nums', value === k ? 'bg-[var(--g-brand-soft)]' : 'bg-white/70')}>{n}</span> : null}
        </button>
      ))}
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

  const navigate = useNavigate();
  const [view, setViewState] = useState(readView);
  const [seen, setSeen] = useState(() => new Set([readView()]));
  const setView = (v) => {
    setViewState(v);
    setSeen((s) => new Set(s).add(v));
    try {
      sessionStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  const [type, setType] = useState('local');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');

  const { data: expiryAlertIds = [] } = useQuery({
    queryKey: ['admin-expiry-alert-ids'],
    queryFn: async () => {
      try {
        return await workerInfoAdmin.expiryAlertIds();
      } catch {
        return [];
      }
    },
    enabled: UNIFIED && isHubAdmin(),
    staleTime: 60_000,
  });
  const expiryAlertSet = useMemo(() => new Set((expiryAlertIds || []).map(String)), [expiryAlertIds]);

  const isLocal = type === 'local';
  const list = isLocal ? localWorkers : foreignWorkers;
  const dir = isLocal ? localWorkersDirectory : foreignWorkersDirectory;
  const loading = isLocal ? isLoadingLocalWorkers : isLoadingForeignWorkers;
  const needle = q.trim().toLowerCase();
  const match = (w) =>
    !needle || `${w.employee_id} ${w.employee_name} ${w.nric_fin || ''} ${w.designation || ''}`.toLowerCase().includes(needle);
  const active = useMemo(() => (list ? dir.active.filter(match) : []), [list, dir, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = useMemo(() => (list ? dir.leftCompany.filter(match) : []), [list, dir, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = status === 'active' ? active : status === 'left' ? left : [...active, ...left];

  // Local-worker NRIC/bank/pay columns are admin-only — never mount for other roles.
  if (!isHubAdmin()) return null;

  const cols = columns(type, { formatAmount, formatRejoinDatesCell });

  const nameCell = (w) => {
    const alert = expiryAlertSet.has(String(w.employee_id));
    const label = (
      <span className={cn(alert && EXPIRY_NAME_CLASS)} title={alert ? expiryAlertTitle(null) : w.employee_name}>
        {w.employee_name}
      </span>
    );
    if (!UNIFIED) return label;
    return (
      <button
        type="button"
        onClick={() => openWorkerProfile(w.employee_id)}
        className="max-w-full truncate text-left font-medium underline-offset-2 hover:text-[var(--g-brand-text)] hover:underline"
      >
        {label}
      </button>
    );
  };

  const actions = [
    { icon: UserPlus, title: t('ui.addWorker'), hint: 'New local or foreign worker', onClick: handleAddWorkerClick, tour: 'admin-worker-add', primary: true },
    { icon: Edit2, title: t('ui.editWorker'), hint: 'Details, rates, balances', onClick: UNIFIED ? () => openWorkerLookup('edit') : handleEditWorkerClick },
    { icon: Search, title: t('ui.searchWorker'), hint: 'Profile, timesheets, payslips', onClick: UNIFIED ? openWorkerLookup : handleWorkerSearchClick },
    // One Managers page for hub, Materials and Site work logins (the old Attendance-only dialog is retired).
    { icon: Users, title: t('ui.managers'), hint: 'Logins for every area', onClick: () => (UNIFIED ? navigate(sectionHref(paths.materials.admin, 'managers')) : setShowManagerDialog(true)) },
    { icon: UserCheck, title: t('ui.supervisors'), hint: 'Supervisor accounts', onClick: () => setShowSupervisorDialog(true) },
    { icon: Trash2, title: t('ui.deleteWorker'), hint: 'Remove a record', onClick: handleDeleteWorkerClick, danger: true },
  ];

  return (
    <div className="min-w-0 space-y-4" data-tour="admin-worker-info-panel">
      <div className="flex flex-col gap-0.5">
        <nav aria-label="Breadcrumb" className="text-xs font-medium text-[var(--g-muted)]">
          Admin <span aria-hidden>/</span> <span className="text-[var(--g-ink)]">Workers</span>
        </nav>
        <p className="text-sm text-[var(--g-muted)]">Manage employee records, worker information and ID cards.</p>
      </div>

      {/* Quick actions — one compact row on desktop instead of six tall cards. */}
      <section aria-label={t('ui.workerDirectory')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {actions.map((a) => (
          <button
            key={a.title}
            type="button"
            onClick={a.onClick}
            data-tour={a.tour}
            className={cn(
              'group flex min-h-[3.75rem] min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g-brand)]',
              a.primary
                ? 'border-transparent bg-[var(--g-brand)] text-white shadow-sm hover:brightness-110'
                : 'border-[var(--g-hairline)] bg-[var(--g-surface)] hover:border-slate-300 hover:shadow-sm',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                a.primary ? 'bg-white/15' : a.danger ? 'bg-red-50 text-red-700' : 'bg-[var(--g-brand-soft)] text-[var(--g-brand)]',
              )}
            >
              <a.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate text-sm font-semibold', !a.primary && (a.danger ? 'text-red-700' : 'text-[var(--g-ink)]'))}>{a.title}</span>
              <span className={cn('hidden truncate text-xs sm:block', a.primary ? 'text-white/80' : 'text-[var(--g-muted)]')}>{a.hint}</span>
            </span>
          </button>
        ))}
      </section>

      {UNIFIED ? (
        <div role="tablist" aria-label="Workers sections" className="flex gap-1 overflow-x-auto border-b border-[var(--g-hairline)]">
          {VIEWS.map(([k, l, Icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`workers-tab-${k}`}
              aria-selected={view === k}
              aria-controls={`workers-panel-${k}`}
              onClick={() => setView(k)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const i = VIEWS.findIndex(([x]) => x === k);
                const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length][0];
                setView(next);
                document.getElementById(`workers-tab-${next}`)?.focus();
              }}
              tabIndex={view === k ? 0 : -1}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--g-brand)]',
                view === k ? 'border-[var(--g-brand)] text-[var(--g-brand-text)]' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              <Icon className="h-4 w-4" /> {l}
            </button>
          ))}
        </div>
      ) : null}

      {/* Bulk Materials / Site photos switches — UNIFIED only (component no-ops otherwise). */}
      {UNIFIED && view === 'records' ? <WorkerAccessTable /> : null}

      {/* Worker records */}
      <section
        id="workers-panel-records"
        role="tabpanel"
        aria-labelledby="workers-tab-records"
        hidden={UNIFIED && view !== 'records'}
        className={cn(glassPanel, 'akk-panel min-w-0 p-3 sm:p-4')}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Worker type"
              value={type}
              onChange={setType}
              options={[
                ['local', t('ui.localWorkers'), localWorkers ? localWorkers.length : null],
                ['foreign', t('ui.foreignWorkers'), foreignWorkers ? foreignWorkers.length : null],
              ]}
            />
            <Segmented
              label="Employment"
              value={status}
              onChange={setStatus}
              options={[
                ['active', 'Active', list ? dir.active.length : null],
                ['left', 'Not in company', list ? dir.leftCompany.length : null],
                ['all', 'All', null],
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
              <span className="sr-only">Search workers</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, ID, NRIC/FIN, role"
                className="h-9 w-full rounded-lg border border-[var(--g-hairline)] bg-[var(--g-surface)] pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--g-brand)]"
              />
              {q ? (
                <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Button variant="outline" size="sm" className="h-9 rounded-lg border-[var(--g-hairline)] bg-[var(--g-surface)]" onClick={() => exportWorkersToExcel(type)} title={`Export all ${type} workers to Excel`}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              {t('ui.export')}
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-lg border-[var(--g-hairline)] bg-[var(--g-surface)]" onClick={() => printWorkerDetails(type)} title={`Print all ${type} workers`}>
              <Printer className="mr-1.5 h-4 w-4" />
              {t('ui.print')}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--g-muted)]">
          {isLocal ? t('ui.localWorkersHint') : t('ui.foreignWorkersHint')}
          {UNIFIED ? ' · Click a name or ID to open the worker.' : ''}
        </p>

        <div className="mt-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : !list || list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
              {isLocal ? t('ui.noLocalWorkers') : 'No foreign workers found.'}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
              {needle ? `No workers match “${q.trim()}”.` : status === 'left' ? 'No workers have left the company.' : 'No active workers.'}
            </div>
          ) : (
            <>
              {/* Phones: simple list, tap to open the worker. */}
              <ul className="divide-y divide-[var(--g-hairline)] overflow-hidden rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface)] md:hidden">
                {rows.map((w, idx) => {
                  const off = workerIsNotInCompany(w);
                  const alert = expiryAlertSet.has(String(w.employee_id));
                  return (
                    <React.Fragment key={w.employee_id}>
                      {status === 'all' && idx === active.length && left.length > 0 ? (
                        <li className="bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Not in company ({left.length})</li>
                      ) : null}
                      <li>
                        <button
                          type="button"
                          disabled={!UNIFIED}
                          onClick={() => openWorkerProfile(w.employee_id)}
                          className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left', off && 'bg-slate-50')}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate text-sm font-semibold', off ? 'text-slate-500' : 'text-slate-900')}>
                              <span className={cn(alert && EXPIRY_NAME_CLASS)}>{w.employee_name}</span>
                            </span>
                            <span className="block truncate text-xs text-slate-500">
                              <span className="font-mono">{w.employee_id}</span> · {w.designation || '—'}
                            </span>
                            <span className="block text-[11px] tabular-nums text-slate-500">
                              Basic/day {formatAmount(w.basic_salary_per_day)} · AL {w.annual_leave_balance}/{w.annual_leave_limit} · MC {w.medical_leave_balance}/{w.medical_leave_limit}
                            </span>
                          </span>
                          {off ? <span className="shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Left</span> : null}
                          {UNIFIED ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /> : null}
                        </button>
                      </li>
                    </React.Fragment>
                  );
                })}
              </ul>

              {/* Tablet / desktop: one table, one scroll area (headers + ID/NRIC/Name stay put). */}
              <div className="nested-touch-scroll akk-table-scroll hidden max-h-[max(22rem,calc(100dvh-17rem))] overflow-auto rounded-xl border border-[var(--g-hairline)] bg-[var(--g-surface)] md:block">
                <table className="akk-worker-table w-full text-sm" style={{ minWidth: isLocal ? 1320 : 1160 }}>
                  <thead>
                    <tr>
                      <th className={cn(TH, 'akk-sticky-id')}>ID</th>
                      <th className={cn(TH, 'akk-sticky-nric')}>NRIC/FIN</th>
                      <th className={cn(TH, 'akk-sticky-name')}>Name</th>
                      {cols.map((c) => (
                        <th key={c.key} className={c.num ? TH_NUM : TH}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((w, idx) => {
                      const off = workerIsNotInCompany(w);
                      return (
                        <React.Fragment key={w.employee_id}>
                          {status === 'all' && idx === active.length && left.length > 0 ? (
                            <tr>
                              <td colSpan={3} className="akk-section-banner-label">
                                Not in company ({left.length})
                              </td>
                              <td colSpan={cols.length} className="akk-section-banner-rest" />
                            </tr>
                          ) : null}
                          <tr className={cn('transition-colors', off ? 'akk-row-left' : idx % 2 === 1 && 'akk-row-alt')}>
                            <td className={cn('akk-sticky-id px-3 py-2 font-mono text-xs', off ? 'font-semibold text-red-700' : 'text-slate-800')}>
                              {UNIFIED ? (
                                <button type="button" onClick={() => openWorkerProfile(w.employee_id)} className="underline-offset-2 hover:text-[var(--g-brand-text)] hover:underline">
                                  {w.employee_id}
                                </button>
                              ) : (
                                w.employee_id
                              )}
                            </td>
                            <td className="akk-sticky-nric px-3 py-2 font-mono text-xs text-slate-700">{w.nric_fin}</td>
                            <td className={cn('akk-sticky-name px-3 py-2', off ? 'text-slate-600' : 'text-slate-900')}>{nameCell(w)}</td>
                            {cols.map((c) => (
                              <td key={c.key} className={cn(c.num ? TD_NUM : TD, c.td)}>
                                {c.cell(w)}
                              </td>
                            ))}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[var(--g-muted)]">
                Showing {rows.length} of {list.length} {type} worker{list.length === 1 ? '' : 's'}
                {status === 'all' && left.length ? ' · not-in-company records are listed last' : ''}
              </p>
            </>
          )}
        </div>
      </section>

      {UNIFIED ? (
        <>
          <div id="workers-panel-info" role="tabpanel" aria-labelledby="workers-tab-info" hidden={view !== 'info'}>
            {seen.has('info') ? <WorkerInfoCenter /> : null}
          </div>
          <div id="workers-panel-cards" role="tabpanel" aria-labelledby="workers-tab-cards" hidden={view !== 'cards'}>
            {seen.has('cards') ? (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
                  </div>
                }
              >
                <CardsAdminPanel />
              </Suspense>
            ) : null}
          </div>
          {/* Worker profile / lookup dialogs — always mounted so names in the table open anywhere. */}
          <WorkerInfoAdminHost />
        </>
      ) : null}
    </div>
  );
}
