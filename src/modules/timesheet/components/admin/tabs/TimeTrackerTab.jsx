import React from 'react';
import { useAdminDash } from '../AdminDashContext';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Calendar, ChevronDown, ChevronUp, Clock, Coffee, Download, Edit2, FileSpreadsheet, FileText, Loader2, MapPin, PlusCircle, Printer, Search, Trash2 } from 'lucide-react';
import { Input } from '@/ui/input';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';
import { ShiftApprovalButtons, ShiftApprovalMeta, ShiftApprovalStatusBadge } from '@/modules/timesheet/components/ShiftApprovalActions';
import { Tabs, TabsList, TabsTrigger } from '@/ui/tabs';
import { calculateShiftHours, formatDate, formatTime, isPublicHoliday, isSunday } from '@/modules/timesheet/lib/timeUtils';
import { cn } from '@/modules/timesheet/lib/utils';
import { glassPanel } from '@/ui/PortalShell';

export default function TimeTrackerTab() {
  const {
    SHIFT_PAGE,
    approvingShiftId,
    dateFilter,
    deleteShiftMutation,
    expandedCards,
    exportToExcel,
    filter,
    filteredShifts,
    handleApproveShift,
    handleDeclineShift,
    inProgressCount,
    isFetching,
    isLoading,
    isShiftsError,
    nativeApp,
    openEditShiftDialog,
    refetch,
    searchTerm,
    selectedMonth,
    selectedYear,
    setCreateShiftData,
    setDateFilter,
    setFilter,
    setPassOutPayslipMode,
    setPassOutTimesheetMode,
    setPendingDeleteShiftId,
    setPrintSelectedWorkerType,
    setPrintWorkerTypeDialog,
    setSearchTerm,
    setSelectedMonth,
    setSelectedYear,
    setShiftLimit,
    setShowCreateShiftDialog,
    setShowDeleteDialog,
    setShowIndividualDeletePinDialog,
    setShowPassOutPayslipDialog,
    setShowPassOutTimesheetDialog,
    setSiteFilter,
    setWorkerIdFilter,
    setWorkerTypeFilter,
    shiftLimit,
    shifts,
    shiftsError,
    siteFilter,
    t,
    timeTrackerFormOpen,
    toggleCardExpansion,
    unapprovedCount,
    uniqueSites,
    workerIdFilter,
    workerTypeFilter,
  } = useAdminDash();

  return (
    <>
      <section className={cn(glassPanel, 'p-4 sm:p-5')}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
              <h2 className="akk-mod-head__title">
                  <span className="akk-mod-head__icon">
                      <Clock className="h-4 w-4" aria-hidden />
                  </span>
                  {t('admin.timeTracker')}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                  {t('ui.shown', { count: filteredShifts.length })}
                  {shifts.length ? ` · ${t('ui.loaded', { count: shifts.length })}` : ''}
                  {inProgressCount ? <span className="font-medium text-sky-600"> · {t('ui.activeCount', { count: inProgressCount })}</span> : null}
                  {unapprovedCount ? <span className="font-medium text-amber-600"> · {t('ui.unapprovedCount', { count: unapprovedCount })}</span> : null}
              </p>
          </div>
          <div className={cn(
              nativeApp
                  ? 'flex w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                  : 'grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap'
          )}>
          <Button
              onClick={() => {
                  setCreateShiftData({
                      worker_id: '',
                      site_id: '',
                      work_date: '',
                      entry_time: '',
                      leave_time: '',
                      breaks: [{ lunch_start: '', lunch_end: '' }],
                      leave_type: '__none__'
                  });
                  setShowCreateShiftDialog(true);
              }}
              className={cn('h-10 rounded-xl bg-brand hover:bg-brand-hover', nativeApp && 'shrink-0')}
              data-tour="admin-action-create-shift"
          >
              <PlusCircle className="mr-1.5 h-4 w-4" />
              {t('ui.createShift')}
          </Button>
          <Button
              onClick={exportToExcel}
              variant="outline"
              className={cn('h-10 rounded-xl border-emerald-200 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100', nativeApp && 'shrink-0')}
              data-tour="admin-action-export"
          >
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              {t('ui.exportExcel')}
          </Button>
          <Button
              onClick={() => {
                  setPrintSelectedWorkerType('');
                  setPrintWorkerTypeDialog(true);
              }}
              variant="outline"
              className={cn('h-10 rounded-xl border-sky-200 bg-sky-50/70 text-sky-800 hover:bg-sky-100', nativeApp && 'shrink-0')}
              data-tour="admin-action-print"
          >
              <Printer className="mr-1.5 h-4 w-4" />
              {t('ui.print')}
          </Button>
          <Button
              onClick={() => {
                  setPassOutPayslipMode('');
                  setShowPassOutPayslipDialog(true);
              }}
              variant="outline"
              className={cn('h-10 rounded-xl border-[var(--g-hairline-2)] bg-[var(--g-brand-muted)] text-[var(--g-brand-text)] hover:bg-[var(--g-brand-soft)]', nativeApp && 'shrink-0')}
              data-tour="admin-action-passout"
          >
              <Download className="mr-1.5 h-4 w-4" />
              {t('ui.passOutPayslip')}
          </Button>
          <Button
              onClick={() => {
                  setPassOutTimesheetMode('');
                  setShowPassOutTimesheetDialog(true);
              }}
              variant="outline"
              className={cn('h-10 rounded-xl border-teal-200 bg-teal-50/70 text-teal-800 hover:bg-teal-100', nativeApp && 'shrink-0')}
              data-tour="admin-action-passout-timesheet"
          >
              <FileText className="mr-1.5 h-4 w-4" />
              {t('ui.passOutTimesheet')}
          </Button>
          <Button
              onClick={() => setShowDeleteDialog(true)}
              variant="destructive"
              className={cn('h-10 rounded-xl', nativeApp && 'shrink-0')}
              data-tour="admin-action-delete-all"
          >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t('ui.deleteAll')}
          </Button>
          </div>
      </div>

      <div className="mb-4 space-y-3" data-tour="admin-filters">
                  <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                              placeholder={t('ui.searchShifts')}
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="h-11 rounded-xl border-slate-200 bg-white/80 pl-10"
                              data-tour="admin-filter-search"
                          />
                  </div>
                  <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
                      <Tabs value={filter} onValueChange={setFilter} data-tour="admin-filter-status" className="w-full lg:w-auto">
                          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-slate-100/80 p-1 sm:grid-cols-4 sm:inline-flex sm:w-auto">
                              <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.all')}</TabsTrigger>
                              <TabsTrigger value="unapproved" className="rounded-lg px-2 text-xs data-[state=active]:bg-amber-100 data-[state=active]:text-amber-900 sm:px-3 sm:text-sm">
                                  {t('ui.unapproved')}{unapprovedCount ? ` (${unapprovedCount})` : ''}
                              </TabsTrigger>
                              <TabsTrigger value="completed" className="rounded-lg px-2 text-xs data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-900 sm:px-3 sm:text-sm">{t('ui.done')}</TabsTrigger>
                              <TabsTrigger value="in_progress" className="rounded-lg px-2 text-xs data-[state=active]:bg-sky-100 data-[state=active]:text-sky-900 sm:px-3 sm:text-sm">{t('ui.active')}</TabsTrigger>
                          </TabsList>
                      </Tabs>
                      <Tabs value={dateFilter} onValueChange={(value) => {
                          setDateFilter(value);
                          if (value !== 'month') setSelectedMonth('');
                          if (value !== 'year') setSelectedYear(new Date().getFullYear().toString());
                      }} data-tour="admin-filter-date" className="w-full lg:w-auto">
                          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-slate-100/80 p-1 sm:inline-flex sm:w-auto">
                              <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.allDates')}</TabsTrigger>
                              <TabsTrigger value="month" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.month')}</TabsTrigger>
                              <TabsTrigger value="year" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.year')}</TabsTrigger>
                          </TabsList>
                      </Tabs>
                      {dateFilter === 'month' && (
                          <select
                              value={selectedMonth}
                              onChange={(e) => setSelectedMonth(e.target.value)}
                              className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white/80 px-3 text-sm sm:w-auto"
                          >
                              <option value="">{t('ui.currentMonth')}</option>
                              {Array.from({ length: 12 }, (_, i) => {
                                  const date = new Date();
                                  date.setMonth(date.getMonth() - i);
                                  const year = date.getFullYear();
                                  const month = String(date.getMonth() + 1).padStart(2, '0');
                                  const monthName = date.toLocaleString('default', { month: 'long' });
                                  return (
                                      <option key={`${year}-${month}`} value={`${year}-${month}`}>
                                          {monthName} {year}
                                      </option>
                                  );
                              })}
                          </select>
                      )}
                      {dateFilter === 'year' && (
                          <select
                              value={selectedYear}
                              onChange={(e) => setSelectedYear(e.target.value)}
                              className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white/80 px-3 text-sm sm:w-auto"
                          >
                              {Array.from({ length: 5 }, (_, i) => {
                                  const year = new Date().getFullYear() - i;
                                  return (
                                      <option key={year} value={year.toString()}>
                                          {year}
                                      </option>
                                  );
                              })}
                          </select>
                      )}
                      <Tabs
                          value={workerTypeFilter}
                          onValueChange={setWorkerTypeFilter}
                          data-tour="admin-filter-worker-type"
                          className="w-full lg:w-auto"
                      >
                          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-slate-100/80 p-1 sm:inline-flex sm:w-auto">
                              <TabsTrigger value="all" className="rounded-lg px-2 text-xs sm:px-3 sm:text-sm">{t('ui.allWorkers')}</TabsTrigger>
                              <TabsTrigger value="local" className="rounded-lg px-2 text-xs data-[state=active]:bg-sky-100 data-[state=active]:text-sky-900 sm:px-3 sm:text-sm">{t('ui.local')}</TabsTrigger>
                              <TabsTrigger value="foreign" className="rounded-lg px-2 text-xs data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-900 sm:px-3 sm:text-sm">{t('ui.foreign')}</TabsTrigger>
                          </TabsList>
                      </Tabs>
                      <select
                          value={siteFilter}
                          onChange={(e) => setSiteFilter(e.target.value)}
                          className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white/80 px-3 text-sm lg:max-w-xs"
                          data-tour="admin-filter-site"
                      >
                          <option value="all">{t('ui.allSites')}</option>
                          {uniqueSites.map(site => (
                              <option key={site} value={site}>{site}</option>
                          ))}
                      </select>
                      <Input
                          placeholder={t('ui.filterWorkerId')}
                          value={workerIdFilter}
                          onChange={(e) => setWorkerIdFilter(e.target.value)}
                          className="h-10 w-full min-w-0 rounded-xl border-slate-200 bg-white/80 sm:max-w-xs"
                          data-tour="admin-filter-worker-id"
                      />
                  </div>
      </div>

      {nativeApp && isLoading ? (
              <NativeListSkeleton rows={3} label="Loading shifts" />
          ) : nativeApp && isShiftsError && !shifts.length && !timeTrackerFormOpen ? (
              <NativeErrorState error={shiftsError} onRetry={() => refetch()} retrying={isFetching} className="shadow-none" />
          ) : isLoading ? (
              <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-7 w-7 animate-spin text-slate-600" />
              </div>
          ) : timeTrackerFormOpen ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-16 text-center">
                  <Clock className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                  <h3 className="text-base font-semibold text-slate-700">Shift list paused</h3>
                  <p className="mt-1 text-sm text-slate-500">Live updates and this list stay frozen until you close the form.</p>
              </div>
          ) : filteredShifts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-[var(--g-surface)] py-16 text-center">
                      <Clock className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                      <h3 className="text-base font-semibold text-slate-700">No shifts found</h3>
                      <p className="mt-1 text-sm text-slate-500">Shifts will appear here when workers clock in/out</p>
              </div>
          ) : (
              <div className="space-y-2">
                  {filteredShifts.slice(0, shiftLimit).map((shift) => {
                          const isSundayShift = isSunday(shift.work_date);
                          const isHolidayShift = isPublicHoliday(shift.work_date);

                          return (
                              <div
                                  key={shift.id}
                                  className={cn(
                                                      'overflow-hidden rounded-2xl border bg-[var(--g-surface)]',
                                                      isSundayShift || isHolidayShift
                                                          ? 'border-red-200 bg-red-50/70'
                                                          : shift.has_left
                                                            ? 'border-emerald-200/80'
                                                            : 'border-sky-200/80'
                                  )}
                              >
                                  <div className="p-4">
                                          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                              <button
                                                  type="button"
                                                  onClick={() => toggleCardExpansion(shift.id)}
                                                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                              >
                                                  <span className={cn(
                                                      'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                                                      shift.has_left ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'
                                                  )}>
                                                      <Clock className="h-5 w-5" />
                                                  </span>
                                                  <span className="min-w-0 flex-1">
                                                      <span className="flex items-center gap-2">
                                                          <span className="truncate font-semibold text-slate-900">
                                                              {shift.workers?.employee_name}
                                                          </span>
                                                          {expandedCards.has(shift.id) ? (
                                                              <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                                                          ) : (
                                                              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                                                          )}
                                                      </span>
                                                      <span className="mt-0.5 block text-xs text-slate-500">
                                                          ID {shift.worker_id}
                                                      </span>
                                                  </span>
                                              </button>
                                              <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                                                  <ShiftApprovalButtons
                                                      shift={shift}
                                                      onApprove={handleApproveShift}
                                                      onDecline={handleDeclineShift}
                                                      busy={approvingShiftId === shift.id}
                                                  />
                                                  <Button
                                                      size="sm"
                                                      variant="outline"
                                                      className="h-9 flex-1 rounded-xl border-brand-soft text-xs text-brand hover:bg-brand-soft sm:flex-initial sm:text-sm"
                                                      onClick={() => openEditShiftDialog(shift)}
                                                      data-tour="admin-edit-shift"
                                                  >
                                                      <Edit2 className="mr-1 h-4 w-4" />
                                                      {t('ui.edit')}
                                                  </Button>
                                                  <Button
                                                      size="sm"
                                                      variant="destructive"
                                                      className="h-9 flex-1 rounded-xl text-xs sm:flex-initial sm:text-sm"
                                                      onClick={() => {
                                                          setPendingDeleteShiftId(shift.id);
                                                          setShowIndividualDeletePinDialog(true);
                                                      }}
                                                      disabled={deleteShiftMutation.isPending}
                                                  >
                                                      <Trash2 className="mr-1 h-4 w-4" />
                                                      {t('ui.delete')}
                                                  </Button>
                                              </div>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-2">
                                                          <Badge variant="outline"
                                                              className={shift.has_left ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-sky-50 border-sky-200 text-sky-800'}
                                                          >
                                                              {shift.has_left ? t('ui.completed') : t('ui.inProgress')}
                                                          </Badge>
                                                          <ShiftApprovalStatusBadge shift={shift} />
                                                          {isSundayShift && (
                                                              <Badge variant="destructive">{t('ui.sunday')}</Badge>
                                                          )}
                                                          {isHolidayShift && (
                                                              <Badge variant="destructive">{t('ui.holiday')}</Badge>
                                                          )}
                                                          <span className="text-sm text-slate-500 flex items-center gap-1">
                                                              <Calendar className="w-3 h-3" />
                                                              {formatDate(shift.work_date)}
                                                          </span>
                                                          <span className="text-sm text-slate-500 flex items-center gap-1">
                                                              <MapPin className="w-3 h-3" />
                                                              {shift.sites?.site_name}
                                                          </span>
                                                      </div>
                                                      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                                                          {shift.entry_time && (
                                                              <span className="text-slate-600">
                                                                  {t('ui.entry')}: {formatTime(shift.entry_time)}
                                                              </span>
                                                          )}
                                                          {shift.breaks && shift.breaks.length > 0 && (
                                                              <div className="space-y-1">
                                                                  {shift.breaks.map((breakItem, breakIndex) => (
                                                                      <div key={breakIndex} className="text-xs text-slate-600">
                                                                          {t('ui.breakN', { n: breakIndex + 1 })}: {breakItem.break_start ? formatTime(breakItem.break_start) : t('ui.notSet')} - {breakItem.break_end ? formatTime(breakItem.break_end) : t('ui.notSet')}
                                                                      </div>
                                                                  ))}
                                                              </div>
                                                          )}
                                                          {shift.leave_time && (
                                                              <span className="text-slate-600">
                                                                  {t('ui.exit')}: {formatTime(shift.leave_time)}
                                                              </span>
                                                          )}
                                                          <ShiftApprovalMeta shift={shift} />
                                                      </div>
                                                      {shift.has_left && (() => {
                                                          const recalc = calculateShiftHours(
                                                              shift.entry_time,
                                                              shift.leave_time,
                                                              shift.breaks || [],
                                                              shift.work_date
                                                          );
                                                          const breakHours = recalc.breakHours || shift.break_hours || 0;
                                                          const basicH = recalc.basicHours;
                                                          const sunPhH = recalc.sundayHours;
                                                          const otH = recalc.otHours;
                                                          return (
                                                              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                                                                  {basicH > 0 && (
                                                                      <span className="text-green-600 font-medium">
                                                                          {t('ui.basic')}: {basicH.toFixed(2)}h
                                                                      </span>
                                                                  )}
                                                                  <span className="text-slate-600 font-medium">
                                                                      {t('ui.break')}: {breakHours.toFixed(2)}h
                                                                  </span>
                                                                  {sunPhH > 0 && (
                                                                      <span className="text-orange-600 font-medium">
                                                                          {t('ui.sunPh')}: {sunPhH.toFixed(2)}h
                                                                      </span>
                                                                  )}
                                                                  {otH > 0 && (
                                                                      <span className="text-blue-600 font-medium">
                                                                          OT: {otH.toFixed(2)}h
                                                                      </span>
                                                                  )}
                                                              </div>
                                                          );
                                                      })()}

                                          {expandedCards.has(shift.id) && (
                                              <div className="mt-4 pt-4 border-t border-slate-200">
                                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                      <div>
                                                          <h4 className="font-medium text-slate-700 mb-2">Time Details</h4>
                                                          <div className="space-y-1">
                                                              <p>{t('ui.entry')}: {shift.entry_time ? formatTime(shift.entry_time) : t('ui.notRecorded')}</p>
                                                              {shift.break_hours && shift.break_hours > 0 ? (
                                                                  <p className="flex items-center gap-1">
                                                                      <Coffee className="w-3 h-3" />
                                                                      Break Hours: {shift.break_hours.toFixed(1)} hrs
                                                                  </p>
                                                              ) : (
                                                                  shift.breaks && shift.breaks.length > 0 && shift.breaks.map((breakItem, index) => (
                                                                      <p key={breakItem.id || `${shift.id}-break-${index}`} className="flex items-center gap-1">
                                                                          <Coffee className="w-3 h-3" />
                                                                          Break {index + 1}: {formatTime(breakItem.break_start)}
                                                                          {breakItem.break_end ? ` - ${formatTime(breakItem.break_end)}` : ' (Ongoing)'}
                                                                      </p>
                                                                  ))
                                                              )}
                                                              <p>{t('ui.exit')}: {shift.leave_time ? formatTime(shift.leave_time) : t('ui.notRecorded')}</p>
                                                              {shift.edited_by && (
                                                                  <p className="text-xs text-slate-500 mt-2 italic">
                                                                      Edited By: {shift.edited_by}
                                                                  </p>
                                                              )}
                                                          </div>
                                                      </div>
                                                      {shift.has_left && (() => {
                                                          const recalc = calculateShiftHours(
                                                              shift.entry_time,
                                                              shift.leave_time,
                                                              shift.breaks || [],
                                                              shift.work_date
                                                          );
                                                          const breakHours = recalc.breakHours || shift.break_hours || 0;
                                                          const totalH = recalc.basicHours + recalc.sundayHours + recalc.otHours;
                                                          return (
                                                              <div>
                                                                  <h4 className="font-medium text-slate-700 mb-2">Hours Breakdown</h4>
                                                                  <div className="space-y-1">
                                                                      <p>Basic Hours: {recalc.basicHours.toFixed(2)}</p>
                                                                      <p>Sun/PH Hours: {recalc.sundayHours.toFixed(2)}</p>
                                                                      <p>OT Hours: {recalc.otHours.toFixed(2)}</p>
                                                                      <p>Break Hours: {breakHours.toFixed(2)}</p>
                                                                      <p>Total Hours: {totalH.toFixed(2)}</p>
                                                                  </div>
                                                              </div>
                                                          );
                                                      })()}
                                                  </div>
                                              </div>
                                          )}
                                  </div>
                              </div>
                          );
                      })}
                      {filteredShifts.length > shiftLimit ? (
                          <button
                              type="button"
                              className="g-btn g-btn--secondary g-btn--block"
                              onClick={() => setShiftLimit((n) => n + SHIFT_PAGE)}
                          >
                              Show more ({filteredShifts.length - shiftLimit} more)
                          </button>
                      ) : null}
              </div>
          )}
      </section>
    </>
  );
}
