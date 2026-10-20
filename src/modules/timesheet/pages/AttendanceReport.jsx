// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Calendar, Download, Loader2, Users } from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { isPublicHoliday, isSunday } from '@/modules/timesheet/lib/timeUtils';
import { workerIsNotInCompany } from '@/modules/timesheet/lib/workerEmploymentPay';
import { AdminPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

function getTodaySingapore() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function startEndIsoForSingaporeDateRange(startDateStr, endDateStr) {
    const startSg = `${startDateStr}T00:00:00+08:00`;
    const startIso = new Date(startSg).toISOString();
    const endSg = `${endDateStr}T00:00:00+08:00`;
    const endIso = new Date(new Date(endSg).getTime() + 24 * 60 * 60 * 1000).toISOString();
    return { startIso, endIso };
}

function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate();
}

function ymd(year, month1to12, day1to31) {
    return `${String(year)}-${String(month1to12).padStart(2, '0')}-${String(day1to31).padStart(2, '0')}`;
}

function getMonthKey(dateStr /* YYYY-MM-DD */) {
    return dateStr.slice(0, 7);
}

function parseMonthKey(monthKey /* YYYY-MM */) {
    const [y, m] = monthKey.split('-').map((x) => Number(x));
    return { y, m };
}

function summarizeDay({ hasWorkShift, hasLeave, isWeekend, isHoliday }) {
    if (isHoliday) return { code: 'H', label: 'Public holiday', tone: 'bg-violet-50 border-violet-200 text-violet-800' };
    if (isWeekend) return { code: 'S', label: 'Sunday', tone: 'bg-slate-50 border-slate-200 text-slate-500' };
    if (hasLeave) return { code: 'L', label: 'Leave', tone: 'bg-amber-50 border-amber-200 text-amber-800' };
    if (hasWorkShift) return { code: 'P', label: 'Present', tone: 'bg-emerald-50 border-emerald-200 text-emerald-800' };
    return { code: 'A', label: 'Absent', tone: 'bg-rose-50 border-rose-200 text-rose-800' };
}

function compareEmployeeId(a, b) {
    const ax = String(a?.id ?? '');
    const bx = String(b?.id ?? '');
    const an = Number(ax);
    const bn = Number(bx);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum && an !== bn) return an - bn;
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    return ax.localeCompare(bx, undefined, { numeric: true, sensitivity: 'base' });
}

export default function AttendanceReport() {
    const today = getTodaySingapore();
    const defaultMonth = getMonthKey(today);
    const [monthKey, setMonthKey] = useState(defaultMonth);
    const [workerId, setWorkerId] = useState('all');

    const { y, m } = useMemo(() => parseMonthKey(monthKey), [monthKey]);
    const dim = useMemo(() => daysInMonth(y, m), [y, m]);

    const monthStart = `${monthKey}-01`;
    const monthEnd = ymd(y, m, dim);
    const { startIso, endIso } = useMemo(() => startEndIsoForSingaporeDateRange(monthStart, monthEnd), [monthStart, monthEnd]);

    const workersQuery = useQuery({
        queryKey: ['attendance-workers'],
        queryFn: async () => {
            const [locals, foreigns] = await Promise.all([
                supabase
                    .from('local_worker_details')
                    .select('employee_id, employee_name, in_company'),
                supabase
                    .from('worker_details')
                    .select('employee_id, employee_name, in_company'),
            ]);
            if (locals.error) throw locals.error;
            if (foreigns.error) throw foreigns.error;

            const seen = new Set();
            const rows = [];
            for (const r of [...(locals.data || []), ...(foreigns.data || [])]) {
                if (!r?.employee_id || workerIsNotInCompany(r)) continue;
                const id = String(r.employee_id);
                if (seen.has(id)) continue;
                seen.add(id);
                rows.push({
                    id,
                    name: r.employee_name || id,
                });
            }
            rows.sort(compareEmployeeId);
            return rows;
        },
    });

    const activeWorkerIds = useMemo(
        () => (workersQuery.data || []).map((w) => w.id),
        [workersQuery.data],
    );

    const shiftsQuery = useQuery({
        queryKey: ['attendance-shifts', monthKey, workerId, activeWorkerIds],
        enabled: workersQuery.isSuccess,
        queryFn: async () => {
            let q = supabase
                .from('shifts')
                .select('id, worker_id, work_date, has_left, leave_type')
                .gte('work_date', monthStart)
                .lte('work_date', monthEnd);
            if (workerId !== 'all') {
                q = q.eq('worker_id', workerId);
            } else if (activeWorkerIds.length > 0) {
                q = q.in('worker_id', activeWorkerIds);
            }
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        },
    });

    const leavesQuery = useQuery({
        queryKey: ['attendance-leaves', monthKey, workerId, activeWorkerIds],
        enabled: workersQuery.isSuccess,
        queryFn: async () => {
            // Only approved leaves count as leave-days in the calendar.
            let q = supabase
                .from('leave_requests')
                .select('id, employee_id, from_date, to_date, status')
                .eq('status', 'approved')
                .gte('from_date', monthStart)
                .lte('to_date', monthEnd);
            if (workerId !== 'all') {
                q = q.eq('employee_id', workerId);
            } else if (activeWorkerIds.length > 0) {
                q = q.in('employee_id', activeWorkerIds);
            }
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        },
    });

    const derived = useMemo(() => {
        const workers = workersQuery.data || [];
        const shifts = shiftsQuery.data || [];
        const leaves = leavesQuery.data || [];

        const shiftByWorkerDate = new Map(); // `${wid}|${date}` -> {hasWorkShift, hasLeaveShift}
        for (const s of shifts) {
            const wid = String(s.worker_id || '');
            const d = String(s.work_date || '');
            if (!wid || !d) continue;
            const key = `${wid}|${d}`;
            const prev = shiftByWorkerDate.get(key) || { hasWorkShift: false, hasLeaveShift: false };
            if (s.leave_type) prev.hasLeaveShift = true;
            else prev.hasWorkShift = true;
            shiftByWorkerDate.set(key, prev);
        }

        // Expand leave ranges into day set per worker
        const leaveDaysByWorker = new Map(); // wid -> Set(YYYY-MM-DD)
        for (const lr of leaves) {
            const wid = String(lr.employee_id || '');
            const from = String(lr.from_date || '');
            const to = String(lr.to_date || '');
            if (!wid || !from || !to) continue;
            const set = leaveDaysByWorker.get(wid) || new Set();
            const start = new Date(`${from}T00:00:00+08:00`).getTime();
            const end = new Date(`${to}T00:00:00+08:00`).getTime();
            for (let t = start, guard = 0; t <= end && guard < 370; guard++) {
                const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date(t));
                set.add(d);
                t += 24 * 60 * 60 * 1000;
            }
            leaveDaysByWorker.set(wid, set);
        }

        const days = Array.from({ length: dim }, (_, i) => i + 1);

        const base = workerId === 'all' ? workers : workers.filter((w) => w.id === String(workerId));
        base.sort(compareEmployeeId);

        const rows = base.map((w) => {
            const wid = w.id;
            let present = 0;
            let absent = 0;
            let leaveCount = 0;

            const cells = days.map((day) => {
                const dateStr = ymd(y, m, day);
                const weekend = isSunday(dateStr);
                const holiday = isPublicHoliday(dateStr, y);
                const leaveSet = leaveDaysByWorker.get(wid);
                const hasLeave = !!leaveSet?.has(dateStr);
                const s = shiftByWorkerDate.get(`${wid}|${dateStr}`) || { hasWorkShift: false, hasLeaveShift: false };
                const hasWorkShift = s.hasWorkShift;

                const summary = summarizeDay({ hasWorkShift, hasLeave, isWeekend: weekend, isHoliday: holiday });
                if (!weekend && !holiday) {
                    if (summary.code === 'P') present += 1;
                    else if (summary.code === 'L') leaveCount += 1;
                    else if (summary.code === 'A') absent += 1;
                }
                return { day, dateStr, ...summary };
            });

            return { worker: w, present, absent, leaveCount, cells };
        });

        return { rows };
    }, [workersQuery.data, shiftsQuery.data, leavesQuery.data, workerId, dim, y, m]);

    const isLoading = workersQuery.isLoading || shiftsQuery.isLoading || leavesQuery.isLoading;
    const reportQueries = [workersQuery, shiftsQuery, leavesQuery];
    const failedQuery = reportQueries.find((q) => q.isError);

    const exportPdf = async () => {
        const el = document.getElementById('akk-attendance-report-print');
        if (!el) return;
        const opt = {
            margin: 8,
            filename: `attendance_${monthKey}_${workerId === 'all' ? 'all' : workerId}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        };
        const { default: html2pdf } = await import('html2pdf.js');
        await html2pdf().set(opt).from(el).save();
    };

    return (
        <AdminPageShell
            title="Attendance"
            subtitle={`Monthly summary · ${monthKey}`}
            icon={Calendar}
            tone="emerald"
            actions={
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-full border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100"
                    onClick={exportPdf}
                    disabled={isLoading}
                >
                    <Download className="mr-2 h-4 w-4" />
                    Export PDF
                </Button>
            }
        >
                <div className={cn(glassPanel, 'grid grid-cols-1 gap-3 p-4 sm:grid-cols-3')}>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Month</p>
                            <input
                                type="month"
                                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                                value={monthKey}
                                onChange={(e) => setMonthKey(e.target.value)}
                            />
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Worker</p>
                            <select
                                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                                value={workerId}
                                onChange={(e) => setWorkerId(e.target.value)}
                            >
                                <option value="all">All workers</option>
                                {(workersQuery.data || []).map((w) => (
                                    <option key={w.id} value={w.id}>
                                        {w.name} ({w.id})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Legend</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                                <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-800">P Present</span>
                                <span className="rounded-lg bg-rose-50 px-2 py-1 text-rose-800">A Absent</span>
                                <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">L Leave</span>
                                <span className="rounded-lg bg-violet-50 px-2 py-1 text-violet-800">H Holiday</span>
                                <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">S Sunday</span>
                            </div>
                        </div>
                </div>

                {NATIVE_APP && isLoading ? (
                    <NativeListSkeleton rows={3} label="Loading report" />
                ) : NATIVE_APP && failedQuery ? (
                    <NativeErrorState
                        error={failedQuery.error}
                        onRetry={() => reportQueries.forEach((q) => q.isError && q.refetch())}
                        retrying={reportQueries.some((q) => q.isFetching)}
                    />
                ) : isLoading ? (
                    <div className={cn(glassPanel, 'p-6 text-slate-700')}>
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                                Loading report…
                            </div>
                    </div>
                ) : (
                    <div id="akk-attendance-report-print" className="space-y-4">
                        {derived.rows.length === 0 ? (
                            <div className={cn(glassPanel, 'p-6 text-slate-700')}>No workers found.</div>
                        ) : (
                            derived.rows.map((row) => (
                                <div key={row.worker.id} className={cn(glassPanel, 'p-5')}>
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-base font-bold text-slate-900">
                                                    {row.worker.name} ({row.worker.id})
                                                </p>
                                                <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500">
                                                    <span className="font-medium text-emerald-700">Present: {row.present}</span>
                                                    <span className="font-medium text-rose-700">Absent: {row.absent}</span>
                                                    <span className="font-medium text-amber-700">Leave: {row.leaveCount}</span>
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 text-emerald-700">
                                                <Users className="h-4 w-4" />
                                                <Calendar className="h-4 w-4" />
                                            </div>
                                        </div>

                                        <div className="mt-4 max-h-56 space-y-1 overflow-y-auto md:hidden">
                                            {row.cells.map((c) => (
                                                <div
                                                    key={c.dateStr}
                                                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs ${c.tone}`}
                                                >
                                                    <span className="font-medium tabular-nums text-slate-700">{c.dateStr}</span>
                                                    <span className="font-bold">{c.code}</span>
                                                    <span className="min-w-0 flex-1 truncate text-right text-[11px] font-medium opacity-80">{c.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-4 hidden grid-cols-7 gap-1 md:grid sm:gap-2">
                                            {row.cells.map((c) => (
                                                <div
                                                    key={c.dateStr}
                                                    className={`flex min-h-[2.75rem] flex-col items-center justify-center rounded-lg border p-1 sm:min-h-0 sm:rounded-xl sm:p-2 ${c.tone}`}
                                                    title={`${c.dateStr}: ${c.label}`}
                                                >
                                                    <div className="text-[10px] font-bold sm:text-[11px]">{c.day}</div>
                                                    <div className="text-[10px] font-extrabold sm:text-[11px]">{c.code}</div>
                                                </div>
                                            ))}
                                        </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
        </AdminPageShell>
    );
}

