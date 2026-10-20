// TODO(claude): ensure @/ui/native/* chrome/states/confirm exist (or remount Timesheet native chrome)
// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import {
    Users,
    Clock,
    MapPin,
    CheckCircle,
    Activity,
    RefreshCcw,
} from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { calculateShiftHours, getTodaySingapore } from '@/modules/timesheet/lib/timeUtils';
import { AdminPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { NativeErrorState, NativeListSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();

function formatHours(n) {
    if (!Number.isFinite(n)) return '0.0h';
    return `${Math.round(n * 10) / 10}h`;
}

function startEndIsoForSingaporeDateRange(startDateStr /* YYYY-MM-DD */, endDateStr /* YYYY-MM-DD */) {
    const startSg = `${startDateStr}T00:00:00+08:00`;
    const startIso = new Date(startSg).toISOString();
    const endSg = `${endDateStr}T00:00:00+08:00`;
    // end is exclusive: next day 00:00+08:00
    const endIso = new Date(new Date(endSg).getTime() + 24 * 60 * 60 * 1000).toISOString();
    return { startIso, endIso };
}

function addDaysSg(dateStr /* YYYY-MM-DD */, days) {
    const base = new Date(`${dateStr}T00:00:00+08:00`);
    const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(next);
}

function firstDayOfMonth(dateStr /* YYYY-MM-DD */) {
    const [y, m] = dateStr.split('-');
    return `${y}-${m}-01`;
}

function enumerateSgDatesInclusive(startDateStr, endDateStr) {
    const dates = [];
    let d = startDateStr;
    // Safety bound: max 370 days
    for (let i = 0; i < 370; i++) {
        dates.push(d);
        if (d === endDateStr) break;
        d = addDaysSg(d, 1);
    }
    return dates;
}

function Sparkline({ values, stroke = '#0f766e', fill = 'rgba(16,185,129,0.18)' }) {
    const pts = Array.isArray(values) ? values : [];
    const w = 240;
    const h = 56;
    const pad = 4;
    const max = Math.max(1, ...pts.map((v) => (Number.isFinite(v) ? v : 0)));
    const min = Math.min(0, ...pts.map((v) => (Number.isFinite(v) ? v : 0)));
    const span = Math.max(1e-6, max - min);
    const xStep = pts.length > 1 ? (w - pad * 2) / (pts.length - 1) : 0;
    const xy = pts.map((v, i) => {
        const vv = Number.isFinite(v) ? v : 0;
        const x = pad + i * xStep;
        const y = pad + (h - pad * 2) * (1 - (vv - min) / span);
        return { x, y };
    });
    const line = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area =
        xy.length >= 2
            ? `${pad},${h - pad} ` + line + ` ${w - pad},${h - pad}`
            : `${pad},${h - pad} ${w - pad},${h - pad}`;

    return (
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="h-14 w-full">
            <polyline points={area} fill={fill} stroke="none" />
            <polyline
                points={line}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

function PieChart({ slices, size = 120 }) {
    const s = Array.isArray(slices) ? slices.filter((x) => x && x.value > 0) : [];
    const total = s.reduce((a, b) => a + (Number.isFinite(b.value) ? b.value : 0), 0);
    const r = size / 2;
    const cx = r;
    const cy = r;
    const strokeWidth = 14;
    const radius = r - strokeWidth / 2;
    const circ = 2 * Math.PI * radius;

    if (!total) {
        return (
            <div className="flex items-center justify-center" style={{ width: size, height: size }}>
                <div className="text-xs font-semibold text-slate-500">No data</div>
            </div>
        );
    }

    let acc = 0;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="rgba(148,163,184,0.25)"
                strokeWidth={strokeWidth}
            />
            {s.map((sl, i) => {
                const v = sl.value;
                const frac = v / total;
                const dash = circ * frac;
                const gap = circ - dash;
                const offset = circ * (1 - acc);
                acc += frac;
                return (
                    <circle
                        key={sl.key || i}
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill="none"
                        stroke={sl.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${dash} ${gap}`}
                        strokeDashoffset={offset}
                        strokeLinecap="butt"
                        transform={`rotate(-90 ${cx} ${cy})`}
                    />
                );
            })}
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a">
                {Math.round(total)}
            </text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fontWeight="600" fill="#64748b">
                total
            </text>
        </svg>
    );
}

async function fetchBreaksByShiftIds(shiftIds) {
    const ids = Array.isArray(shiftIds) ? shiftIds.filter(Boolean) : [];
    if (!ids.length) return {};

    const all = [];
    const batchSize = 100;
    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const { data, error } = await supabase
            .from('breaks')
            .select('*')
            .in('shift_id', batch.length ? batch : [''])
            .order('break_start', { ascending: true });
        if (error) throw error;
        if (data?.length) all.push(...data);
    }

    /** @type {Record<string, any[]>} */
    const byShift = {};
    for (const b of all) {
        if (!b?.shift_id) continue;
        if (!byShift[b.shift_id]) byShift[b.shift_id] = [];
        byShift[b.shift_id].push(b);
    }
    return byShift;
}

export default function Analytics() {
    const [siteFilter, setSiteFilter] = useState('all');
    const [rangeMode, setRangeMode] = useState('today'); // today | last7 | month | custom
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const today = getTodaySingapore();
    const { startDateStr, endDateStr, label } = useMemo(() => {
        if (rangeMode === 'last7') {
            const end = today;
            const start = addDaysSg(today, -6);
            return { startDateStr: start, endDateStr: end, label: 'Last 7 days' };
        }
        if (rangeMode === 'month') {
            const start = firstDayOfMonth(today);
            return { startDateStr: start, endDateStr: today, label: 'This month' };
        }
        if (rangeMode === 'custom') {
            const s = (customStart || '').trim();
            const e = (customEnd || '').trim();
            const start = s || today;
            const end = e || start;
            return { startDateStr: start, endDateStr: end, label: 'Custom' };
        }
        return { startDateStr: today, endDateStr: today, label: 'Today' };
    }, [rangeMode, customStart, customEnd, today]);

    const { startIso, endIso } = useMemo(
        () => startEndIsoForSingaporeDateRange(startDateStr, endDateStr),
        [startDateStr, endDateStr]
    );

    const sitesQuery = useQuery({
        queryKey: ['analytics-sites'],
        queryFn: async () => {
            const { data, error } = await supabase.from('sites').select('id, site_name').order('site_name');
            if (error) throw error;
            return data || [];
        },
    });

    const shiftsQuery = useQuery({
        queryKey: ['analytics-shifts', startDateStr, endDateStr],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('shifts')
                .select('*')
                .gte('work_date', startDateStr)
                .lte('work_date', endDateStr)
                .is('leave_type', null);
            if (error) throw error;
            return data || [];
        },
        refetchInterval: false,
    });

    const breaksQuery = useQuery({
        queryKey: ['analytics-breaks', startDateStr, endDateStr, shiftsQuery.data?.length || 0],
        enabled: !!shiftsQuery.data,
        queryFn: async () => {
            const ids = (shiftsQuery.data || []).map((s) => s.id).filter(Boolean);
            return await fetchBreaksByShiftIds(ids);
        },
    });

    const workersQuery = useQuery({
        queryKey: ['analytics-workers', startDateStr, endDateStr, shiftsQuery.data?.length || 0],
        enabled: !!shiftsQuery.data,
        queryFn: async () => {
            const workerIds = [...new Set((shiftsQuery.data || []).map((s) => s.worker_id).filter(Boolean))];
            if (!workerIds.length) return new Map();

            const [locals, foreigns] = await Promise.all([
                supabase
                    .from('local_worker_details')
                    .select('employee_id, employee_name')
                    .in('employee_id', workerIds),
                supabase
                    .from('worker_details')
                    .select('employee_id, employee_name')
                    .in('employee_id', workerIds),
            ]);
            if (locals.error) throw locals.error;
            if (foreigns.error) throw foreigns.error;

            const m = new Map();
            for (const r of [...(locals.data || []), ...(foreigns.data || [])]) {
                if (r?.employee_id) m.set(String(r.employee_id), r.employee_name || String(r.employee_id));
            }
            return m;
        },
    });

    const activityQuery = useQuery({
        queryKey: ['analytics-activity', startIso, endIso],
        queryFn: async () => {
            const [leaves, payslips, timesheets] = await Promise.all([
                supabase
                    .from('leave_requests')
                    .select('id', { count: 'exact', head: true })
                    .gte('created_at', startIso)
                    .lt('created_at', endIso),
                supabase
                    .from('passed_out_payslips')
                    .select('id', { count: 'exact', head: true })
                    .gte('created_at', startIso)
                    .lt('created_at', endIso),
                supabase
                    .from('passed_out_timesheets')
                    .select('id', { count: 'exact', head: true })
                    .gte('created_at', startIso)
                    .lt('created_at', endIso),
            ]);
            if (leaves.error) throw leaves.error;
            if (payslips.error) throw payslips.error;
            if (timesheets.error) throw timesheets.error;
            return {
                leaves: leaves.count || 0,
                payslips: payslips.count || 0,
                timesheets: timesheets.count || 0,
            };
        },
    });

    const derived = useMemo(() => {
        const sites = sitesQuery.data || [];
        const siteNameById = new Map(sites.map((s) => [String(s.id), s.site_name || String(s.id)]));
        const workersById = workersQuery.data || new Map();
        const breaksByShiftId = breaksQuery.data || {};

        const rawShifts = shiftsQuery.data || [];
        const filtered =
            siteFilter === 'all'
                ? rawShifts
                : rawShifts.filter((s) => String(s.site_id) === String(siteFilter));

        const workerIds = new Set();
        let onSite = 0;
        let completed = 0;
        let totalNetWorkedHours = 0;
        let totalBreakMinutes = 0;
        let totalOtHours = 0;

        /** @type {Array<{workerId:string, workerName:string, siteName:string, netHours:number, otHours:number}>} */
        const longestShifts = [];

        /** @type {Map<string, {siteId:string, siteName:string, onSite:number, completed:number, netHours:number, workers:Set<string>}>} */
        const siteAgg = new Map();

        /** Daily totals (completed only) */
        const dailyNetHours = new Map(); // work_date -> hours
        const dailyCompleted = new Map(); // work_date -> count
        const dailyOtHours = new Map(); // work_date -> hours
        const dailyShiftCount = new Map(); // work_date -> count (all shifts)
        let totalNonOtHours = 0;

        for (const s of filtered) {
            const workerId = s?.worker_id ? String(s.worker_id) : '';
            if (workerId) workerIds.add(workerId);

            const wdAny = String(s.work_date || '');
            if (wdAny) dailyShiftCount.set(wdAny, (dailyShiftCount.get(wdAny) || 0) + 1);

            const sid = String(s.site_id ?? '');
            if (!siteAgg.has(sid)) {
                siteAgg.set(sid, {
                    siteId: sid,
                    siteName: siteNameById.get(sid) || sid || 'Site',
                    onSite: 0,
                    completed: 0,
                    netHours: 0,
                    workers: new Set(),
                });
            }
            const agg = siteAgg.get(sid);
            if (workerId) agg.workers.add(workerId);

            const isCompleted = !!(s.has_left && s.leave_time);
            if (isCompleted) {
                completed += 1;
                agg.completed += 1;

                const brs = Array.isArray(breaksByShiftId[s.id]) ? breaksByShiftId[s.id] : [];
                const normalizedBreaks = brs
                    .filter((b) => b?.break_start && b?.break_end)
                    .map((b) => ({ break_start: b.break_start, break_end: b.break_end }));

                for (const b of brs) {
                    if (!b?.break_start || !b?.break_end) continue;
                    const ms = new Date(b.break_end).getTime() - new Date(b.break_start).getTime();
                    if (Number.isFinite(ms) && ms > 0) totalBreakMinutes += Math.round(ms / 60000);
                }

                const calc = calculateShiftHours(s.entry_time, s.leave_time, normalizedBreaks, s.work_date);
                totalNetWorkedHours += calc.netWorkedHours || 0;
                agg.netHours += calc.netWorkedHours || 0;
                totalOtHours += calc.otHours || 0;
                totalNonOtHours += Math.max(0, (calc.netWorkedHours || 0) - (calc.otHours || 0));

                const wd = String(s.work_date || '');
                if (wd) {
                    dailyNetHours.set(wd, (dailyNetHours.get(wd) || 0) + (calc.netWorkedHours || 0));
                    dailyOtHours.set(wd, (dailyOtHours.get(wd) || 0) + (calc.otHours || 0));
                    dailyCompleted.set(wd, (dailyCompleted.get(wd) || 0) + 1);
                }
                if (workerId) {
                    longestShifts.push({
                        workerId,
                        workerName: workersById.get(workerId) || workerId || 'Worker',
                        siteName: siteNameById.get(String(s.site_id)) || String(s.site_id || ''),
                        netHours: calc.netWorkedHours || 0,
                        otHours: calc.otHours || 0,
                    });
                }
            } else {
                // on-site if shift exists but not clocked out yet
                onSite += 1;
                agg.onSite += 1;
            }
        }

        const avgNetHours = completed ? totalNetWorkedHours / completed : 0;
        const breakHours = totalBreakMinutes / 60;

        const siteUtil = [...siteAgg.values()]
            .map((s) => ({
                ...s,
                workersCount: s.workers.size,
            }))
            .sort((a, b) => b.netHours - a.netHours);

        longestShifts.sort((a, b) => b.netHours - a.netHours);

        const otByWorker = new Map();
        for (const row of longestShifts) {
            if (!row.workerId) continue;
            otByWorker.set(row.workerId, (otByWorker.get(row.workerId) || 0) + (row.otHours || 0));
        }
        const topOtWorkers = [...otByWorker.entries()]
            .map(([workerId, otHours]) => ({
                workerId,
                workerName: workersById.get(workerId) || workerId,
                otHours,
            }))
            .sort((a, b) => b.otHours - a.otHours)
            .slice(0, 8);

        const days = enumerateSgDatesInclusive(startDateStr, endDateStr);
        const dailyNetSeries = days.map((d) => Math.round(((dailyNetHours.get(d) || 0) * 10)) / 10);
        const dailyOtSeries = days.map((d) => Math.round(((dailyOtHours.get(d) || 0) * 10)) / 10);
        const dailyCompletedSeries = days.map((d) => dailyCompleted.get(d) || 0);
        const dailyShiftCountSeries = days.map((d) => dailyShiftCount.get(d) || 0);

        return {
            workersClockedIn: workerIds.size,
            onSite,
            completed,
            totalNetWorkedHours,
            avgNetHours,
            breakHours,
            siteUtil,
            totalOtHours,
            topOtWorkers,
            longestShifts: longestShifts.slice(0, 12),
            days,
            dailyNetSeries,
            dailyOtSeries,
            dailyCompletedSeries,
            dailyShiftCountSeries,
            totalNonOtHours,
        };
    }, [sitesQuery.data, workersQuery.data, breaksQuery.data, shiftsQuery.data, siteFilter, startDateStr, endDateStr]);

    const analyticsQueries = [sitesQuery, shiftsQuery, breaksQuery, workersQuery, activityQuery];
    const failedQuery = analyticsQueries.find((q) => q.isError);
    const isLoading =
        sitesQuery.isLoading ||
        shiftsQuery.isLoading ||
        breaksQuery.isLoading ||
        workersQuery.isLoading ||
        activityQuery.isLoading;

    return (
        <AdminPageShell
            title="Analytics"
            subtitle={`${label} · ${startDateStr === endDateStr ? startDateStr : `${startDateStr} → ${endDateStr}`}`}
            icon={Activity}
            tone="sky"
            actions={
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-full border-sky-200 bg-sky-50/80 text-sky-800 hover:bg-sky-100"
                    onClick={() => {
                        sitesQuery.refetch();
                        shiftsQuery.refetch();
                        breaksQuery.refetch();
                        workersQuery.refetch();
                        activityQuery.refetch();
                    }}
                >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            }
        >
                    <div className={cn(glassPanel, 'grid grid-cols-1 gap-3 p-4 sm:grid-cols-3')}>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date range</p>
                            <select
                                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                                value={rangeMode}
                                onChange={(e) => setRangeMode(e.target.value)}
                            >
                                <option value="today">Today</option>
                                <option value="last7">Last 7 days</option>
                                <option value="month">This month</option>
                                <option value="custom">Custom</option>
                            </select>
                            {rangeMode === 'custom' ? (
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <input
                                        type="date"
                                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs"
                                        value={customStart}
                                        onChange={(e) => setCustomStart(e.target.value)}
                                    />
                                    <input
                                        type="date"
                                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs"
                                        value={customEnd}
                                        onChange={(e) => setCustomEnd(e.target.value)}
                                    />
                                </div>
                            ) : null}
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Site</p>
                            <select
                                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                                value={siteFilter}
                                onChange={(e) => setSiteFilter(e.target.value)}
                            >
                                <option value="all">All sites</option>
                                {(sitesQuery.data || []).map((s) => (
                                    <option key={s.id} value={String(s.id)}>
                                        {s.site_name || s.id}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Overtime (completed)</p>
                            <p className="mt-1 text-lg font-semibold text-slate-900">{formatHours(derived.totalOtHours)}</p>
                            <p className="mt-1 text-[11px] text-slate-500">Top OT workers below</p>
                        </div>
                    </div>

                {NATIVE_APP && isLoading ? (
                    <NativeListSkeleton rows={3} label="Loading analytics" />
                ) : NATIVE_APP && failedQuery ? (
                    <NativeErrorState
                        error={failedQuery.error}
                        onRetry={() => analyticsQueries.forEach((q) => q.isError && q.refetch())}
                        retrying={analyticsQueries.some((q) => q.isFetching)}
                    />
                ) : isLoading ? (
                    <div className={cn(glassPanel, 'p-6 text-slate-700')}>Loading analytics…</div>
                ) : (
                    <>
                        {/* KPI strip */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div className={cn(glassPanel, 'flex items-center justify-between border-sky-200/70 bg-sky-50/50 p-5')}>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500">Workers clocked in</p>
                                        <p className="mt-1 text-3xl font-bold text-slate-900">{derived.workersClockedIn}</p>
                                    </div>
                                    <Users className="h-6 w-6 text-sky-600" />
                            </div>
                            <div className={cn(glassPanel, 'flex items-center justify-between border-amber-200/70 bg-amber-50/50 p-5')}>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500">On-site now</p>
                                        <p className="mt-1 text-3xl font-bold text-slate-900">{derived.onSite}</p>
                                    </div>
                                    <MapPin className="h-6 w-6 text-amber-600" />
                            </div>
                            <div className={cn(glassPanel, 'flex items-center justify-between border-emerald-200/70 bg-emerald-50/50 p-5')}>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500">Average hours (completed)</p>
                                        <p className="mt-1 text-3xl font-bold text-slate-900">{formatHours(derived.avgNetHours)}</p>
                                        <p className="mt-1 text-[11px] text-slate-500">{derived.completed} completed</p>
                                    </div>
                                    <Clock className="h-6 w-6 text-emerald-600" />
                            </div>
                            <div className={cn(glassPanel, 'flex items-center justify-between border-indigo-200/70 bg-indigo-50/50 p-5')}>
                                    <div>
                                        <p className="text-xs font-semibold text-slate-500">Total OT hours (completed)</p>
                                        <p className="mt-1 text-3xl font-bold text-slate-900">{formatHours(derived.totalOtHours)}</p>
                                    </div>
                                    <Clock className="h-6 w-6 text-indigo-600" />
                            </div>
                        </div>

                        <div className={cn(glassPanel, 'p-5')}>
                            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Daily hours</h2>
                            <p className="mt-1 text-xs text-slate-500">Net worked hours and OT across the selected range.</p>
                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
                                    <p className="text-xs font-medium text-sky-800">Net hours</p>
                                    <Sparkline
                                        values={derived.dailyNetSeries}
                                        stroke="#0284c7"
                                        fill="rgba(14,165,233,0.18)"
                                    />
                                </div>
                                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3">
                                    <p className="text-xs font-medium text-indigo-800">OT hours</p>
                                    <Sparkline
                                        values={derived.dailyOtSeries}
                                        stroke="#4f46e5"
                                        fill="rgba(99,102,241,0.18)"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Pie charts */}
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                            <div className={cn(glassPanel, 'p-5')}>
                                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Shift status</h2>
                                    <p className="mt-1 text-xs text-slate-500">Completed vs still on-site.</p>
                                    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                                        <PieChart
                                            slices={[
                                                { key: 'completed', label: 'Completed', value: derived.completed, color: '#10b981' },
                                                { key: 'onSite', label: 'On-site', value: derived.onSite, color: '#f59e0b' },
                                            ]}
                                        />
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3">
                                                <p className="text-sm font-medium text-emerald-800">Completed</p>
                                                <p className="text-sm font-semibold text-slate-900">{derived.completed}</p>
                                            </div>
                                            <div className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-50/70 p-3">
                                                <p className="text-sm font-medium text-amber-800">On-site</p>
                                                <p className="text-sm font-semibold text-slate-900">{derived.onSite}</p>
                                            </div>
                                        </div>
                                    </div>
                            </div>

                            <div className={cn(glassPanel, 'p-5')}>
                                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Hours breakdown</h2>
                                    <p className="mt-1 text-xs text-slate-500">Where time went in the selected range (completed shifts).</p>
                                    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                                        <PieChart
                                            slices={[
                                                {
                                                    key: 'nonOt',
                                                    label: 'Non-OT',
                                                    value: derived.totalNonOtHours,
                                                    color: '#0f766e',
                                                },
                                                { key: 'ot', label: 'OT', value: derived.totalOtHours, color: '#1d4ed8' },
                                                { key: 'breaks', label: 'Breaks', value: derived.breakHours, color: '#64748b' },
                                            ]}
                                        />
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/70 p-3">
                                                <p className="text-sm font-medium text-teal-800">Non-OT hours</p>
                                                <p className="text-sm font-semibold text-slate-900">{formatHours(derived.totalNonOtHours)}</p>
                                            </div>
                                            <div className="flex items-center justify-between rounded-xl border border-indigo-200/80 bg-indigo-50/70 p-3">
                                                <p className="text-sm font-medium text-indigo-800">OT hours</p>
                                                <p className="text-sm font-semibold text-slate-900">{formatHours(derived.totalOtHours)}</p>
                                            </div>
                                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                                                <p className="text-sm font-medium text-slate-700">Break hours</p>
                                                <p className="text-sm font-semibold text-slate-900">{formatHours(derived.breakHours)}</p>
                                            </div>
                                        </div>
                                    </div>
                            </div>
                        </div>

                        {/* Hours + activity */}
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            <div className={cn(glassPanel, 'p-5 lg:col-span-2')}>
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Hours snapshot</h2>
                                        <CheckCircle className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                        <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 p-4">
                                            <p className="text-xs font-medium text-sky-800">Total net hours (completed)</p>
                                            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                                                {formatHours(derived.totalNetWorkedHours)}
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                                            <p className="text-xs font-medium text-slate-500">Total break hours</p>
                                            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{formatHours(derived.breakHours)}</p>
                                        </div>
                                        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-4">
                                            <p className="text-xs font-medium text-emerald-800">Completed shifts</p>
                                            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{derived.completed}</p>
                                        </div>
                                    </div>
                            </div>

                            <div className={cn(glassPanel, 'p-5')}>
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Today activity</h2>
                                        <Activity className="h-5 w-5 text-sky-600" />
                                    </div>
                                    <div className="mt-4 space-y-2">
                                        <div className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-50/70 p-3">
                                            <p className="text-sm font-medium text-amber-800">Leave requests</p>
                                            <p className="text-sm font-semibold">{activityQuery.data?.leaves ?? 0}</p>
                                        </div>
                                        <div className="flex items-center justify-between rounded-xl border border-violet-200/80 bg-violet-50/70 p-3">
                                            <p className="text-sm font-medium text-violet-800">Payslips passed out</p>
                                            <p className="text-sm font-semibold">{activityQuery.data?.payslips ?? 0}</p>
                                        </div>
                                        <div className="flex items-center justify-between rounded-xl border border-teal-200/80 bg-teal-50/70 p-3">
                                            <p className="text-sm font-medium text-teal-800">Timesheets passed out</p>
                                            <p className="text-sm font-semibold">{activityQuery.data?.timesheets ?? 0}</p>
                                        </div>
                                    </div>
                            </div>
                        </div>

                        {/* Site utilization */}
                        <div className={cn(glassPanel, 'p-5')}>
                                <h2 className="text-lg font-semibold tracking-tight text-slate-900">Site utilization (ranked)</h2>
                                <div className="mt-4 space-y-3">
                                    {derived.siteUtil.length === 0 ? (
                                        <p className="text-sm text-slate-600">No shifts found for today.</p>
                                    ) : (
                                        derived.siteUtil.slice(0, 12).map((s) => {
                                            const max = derived.siteUtil[0]?.netHours || 1;
                                            const pct = Math.max(0, Math.min(100, (s.netHours / max) * 100));
                                            return (
                                                <div key={s.siteId} className="rounded-2xl border border-sky-100 bg-white/80 p-4">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className="truncate font-semibold text-slate-900">{s.siteName}</p>
                                                            <p className="text-xs text-slate-500">
                                                                {s.workersCount} workers · {s.onSite} on-site · {s.completed} completed
                                                            </p>
                                                        </div>
                                                        <p className="text-sm font-semibold text-slate-900">{formatHours(s.netHours)}</p>
                                                    </div>
                                                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-sky-100">
                                                        <div
                                                            className="h-2 rounded-full bg-sky-500"
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                        </div>

                        {/* OT + Long shifts */}
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                            <div className={cn(glassPanel, 'p-5')}>
                                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Top OT workers</h2>
                                    <p className="mt-1 text-xs text-slate-500">Ranked by total OT hours in the selected range.</p>
                                    <div className="mt-4 space-y-2">
                                        {derived.topOtWorkers.length === 0 ? (
                                            <p className="text-sm text-slate-600">No OT detected in this range.</p>
                                        ) : (
                                            derived.topOtWorkers.map((w) => (
                                                <div
                                                    key={w.workerId}
                                                    className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50/50 p-3"
                                                >
                                                    <p className="truncate text-sm font-medium text-slate-900">{w.workerName}</p>
                                                    <p className="text-sm font-semibold text-indigo-800">{formatHours(w.otHours)}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                            </div>

                            <div className={cn(glassPanel, 'p-5')}>
                                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Longest shifts (completed)</h2>
                                    <p className="mt-1 text-xs text-slate-500">Ranked by net worked hours.</p>
                                    <div className="mt-4 space-y-2">
                                        {derived.longestShifts.length === 0 ? (
                                            <p className="text-sm text-slate-600">No completed shifts in this range.</p>
                                        ) : (
                                            derived.longestShifts.map((r, idx) => (
                                                <div
                                                    key={`${r.workerId}-${idx}`}
                                                    className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"
                                                >
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium text-slate-900">{r.workerName}</p>
                                                        <p className="truncate text-xs text-slate-500">{r.siteName || '—'}</p>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <p className="text-sm font-semibold text-slate-900">{formatHours(r.netHours)}</p>
                                                        <p className="text-[11px] font-medium text-indigo-700">OT {formatHours(r.otHours)}</p>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                            </div>
                        </div>
                    </>
                )}
        </AdminPageShell>
    );
}

