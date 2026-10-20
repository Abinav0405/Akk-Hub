// TODO(claude): ensure @/ui/PortalShell exports WorkerPageShell / AdminPageShell / ManagerPageShell
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageKey } from '@/core/storage';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import {
    History as HistoryIcon,
    Clock,
    MapPin,
    Coffee,
    CheckCircle,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { formatTime, formatDate, calculateShiftHours, isSunday, isPublicHoliday } from '@/modules/timesheet/lib/timeUtils';
import {
    isShiftApproved,
    shiftNeedsApprovalActions,
} from '@/modules/timesheet/lib/shiftApproval';
import { ShiftApprovalStatusBadge } from '@/modules/timesheet/components/ShiftApprovalActions';
import { verifyRoleSession } from '@/core/auth/timesheetSession';
import { WorkerPageShell } from '@/ui/PortalShell';
import { glassPanel } from '@/ui/glass';
import { isNativeApp } from '@/core/platform';
import { NativeSegmented } from '@/ui/native/NativeChrome';
import { NativeEmptyState, NativeErrorState, NativeListSkeleton, NativeSkeleton } from '@/ui/native/NativeStates';

const NATIVE_APP = isNativeApp();
const FILTERS = [
    { id: 'all', label: 'All shifts' },
    { id: 'approved', label: 'Approved' },
    { id: 'pending', label: 'Pending approval' },
];

export default function ShiftHistory() {
    const navigate = useNavigate();
    const [expandedCards, setExpandedCards] = useState(new Set());
    const [filter, setFilter] = useState('all');

    const [workerId, setWorkerId] = React.useState(() => localStorage.getItem(storageKey('timesheet', 'workerId')) || '');
    const [workerName, setWorkerName] = React.useState(() => localStorage.getItem(storageKey('timesheet', 'workerName')) || '');

    React.useEffect(() => {
        verifyRoleSession({ keepOnNetworkError: true }).then((session) => {
            if (session?.networkError) return;
            if (session?.role === 'worker') {
                if (session.subject_id) setWorkerId(session.subject_id);
                if (session.session_data?.workerName) setWorkerName(session.session_data.workerName);
            } else if (!localStorage.getItem(storageKey('timesheet', 'workerLoggedIn'))) {
                navigate('/login', { replace: true });
            }
        });
    }, [navigate]);

    const { data: shifts = [], isLoading, isError, error, refetch, isRefetching } = useQuery({
        queryKey: ['shiftHistory', workerId],
        queryFn: async () => {
            if (!workerId) return [];

            // Narrow columns (no select('*')); sites + breaks in parallel after shifts.
            const SHIFT_COLS =
                'id, worker_id, site_id, work_date, entry_time, leave_time, has_left, approval_status, approved_by, approved_at, leave_type';
            const { data, error } = await supabase
                .from('shifts')
                .select(SHIFT_COLS)
                .eq('worker_id', workerId)
                .is('leave_type', null)
                .order('work_date', { ascending: false })
                .order('entry_time', { ascending: false })
                .limit(365);

            if (error) throw error;
            if (!data?.length) return [];

            const siteIds = [...new Set(data.map((s) => s.site_id).filter(Boolean))];
            const shiftIds = data.map((s) => s.id);

            const [{ data: sites }, { data: breaks }] = await Promise.all([
                siteIds.length
                    ? supabase.from('sites').select('id, site_name').in('id', siteIds)
                    : Promise.resolve({ data: [] }),
                supabase
                    .from('breaks')
                    .select('id, shift_id, break_start, break_end')
                    .in('shift_id', shiftIds)
                    .order('break_start', { ascending: true }),
            ]);

            const siteById = new Map((sites || []).map((s) => [s.id, s]));
            const breaksByShiftId = {};
            (breaks || []).forEach((b) => {
                if (!breaksByShiftId[b.shift_id]) breaksByShiftId[b.shift_id] = [];
                breaksByShiftId[b.shift_id].push(b);
            });

            return data.map((shift) => ({
                ...shift,
                sites: siteById.get(shift.site_id) || null,
                breaks: breaksByShiftId[shift.id] || [],
            }));
        },
        enabled: !!workerId,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    const filteredShifts = useMemo(() => {
        return shifts.filter((shift) => {
            if (filter === 'approved') return isShiftApproved(shift);
            if (filter === 'pending') return shiftNeedsApprovalActions(shift);
            return true;
        });
    }, [shifts, filter]);

    const toggleCardExpansion = (shiftId) => {
        setExpandedCards((prev) => {
            const next = new Set(prev);
            if (next.has(shiftId)) next.delete(shiftId);
            else next.add(shiftId);
            return next;
        });
    };

    const monthTotals = useMemo(() => {
        const now = new Date();
        const month = now.getMonth();
        const year = now.getFullYear();
        let basic = 0;
        let sunPh = 0;
        let ot = 0;
        let breakH = 0;

        shifts.forEach((shift) => {
            if (!shift.has_left || !isShiftApproved(shift)) return;
            const d = new Date(`${shift.work_date}T12:00:00`);
            if (d.getMonth() !== month || d.getFullYear() !== year) return;
            const recalc = calculateShiftHours(
                shift.entry_time,
                shift.leave_time,
                shift.breaks || [],
                shift.work_date,
            );
            basic += recalc.basicHours;
            sunPh += recalc.sundayHours;
            ot += recalc.otHours;
            breakH += recalc.breakHours;
        });

        return { basic, sunPh, ot, breakH };
    }, [shifts]);

    const monthLabel = new Date().toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });

    return (
        <WorkerPageShell
            title="Shift history"
            subtitle={`${workerName || 'Worker'} · ID ${workerId || '—'}`}
            maxWidth="max-w-6xl"
        >
            <div className="mb-4">
                <h2 className="text-sm font-medium text-slate-500">{monthLabel} — approved hours</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    {[
                        { label: 'Basic', value: monthTotals.basic, color: 'text-sky-700' },
                        { label: 'Sun/PH', value: monthTotals.sunPh, color: 'text-orange-700' },
                        { label: 'OT', value: monthTotals.ot, color: 'text-emerald-700' },
                        { label: 'Break', value: monthTotals.breakH, color: 'text-violet-700' },
                    ].map((item) => (
                        <div key={item.label} className={cn(glassPanel, 'px-3 py-3 text-center')}>
                            <p className={`text-xl font-semibold tracking-tight ${item.color}`}>
                                {NATIVE_APP && isLoading ? (
                                    <NativeSkeleton className="mx-auto h-7 w-14" />
                                ) : NATIVE_APP && isError && !shifts.length ? (
                                    '—'
                                ) : (
                                    item.value.toFixed(2)
                                )}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">{item.label}</p>
                        </div>
                    ))}
                </div>
                {NATIVE_APP ? (
                    <NativeSegmented
                        className="mt-4"
                        ariaLabel="Filter shifts"
                        options={[
                            { id: 'all', label: 'All' },
                            { id: 'approved', label: 'Approved' },
                            { id: 'pending', label: 'Pending' },
                        ]}
                        value={filter}
                        onChange={setFilter}
                    />
                ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                    {FILTERS.map(({ id, label }) => (
                        <Button
                            key={id}
                            size="sm"
                            variant={filter === id ? 'default' : 'outline'}
                            className={cn(
                                'h-9 rounded-xl',
                                filter === id ? 'bg-[#dc6b2f] hover:bg-[#c45d28]' : 'border-slate-200 bg-white/70'
                            )}
                            onClick={() => setFilter(id)}
                        >
                            {label}
                        </Button>
                    ))}
                </div>
                )}
            </div>

            {NATIVE_APP && isLoading ? (
                <NativeListSkeleton rows={4} label="Loading shifts" />
            ) : NATIVE_APP && isError && !shifts.length ? (
                <NativeErrorState error={error} onRetry={() => refetch()} retrying={isRefetching} />
            ) : NATIVE_APP && filteredShifts.length === 0 ? (
                <NativeEmptyState
                    icon={HistoryIcon}
                    title="No shifts found"
                    message={
                        filter === 'all'
                            ? 'Completed shifts will appear here after you clock out.'
                            : 'No shifts match this filter.'
                    }
                />
            ) : isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-[#dc6b2f]" />
                </div>
            ) : filteredShifts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
                    <HistoryIcon className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                    <h3 className="text-base font-semibold text-slate-700">No shifts found</h3>
                    <p className="mt-1 text-sm text-slate-500">
                        {filter === 'all'
                            ? 'Completed shifts will appear here after you clock out.'
                            : 'No shifts match this filter.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredShifts.map((shift) => {
                            const isSundayShift = isSunday(shift.work_date);
                            const isHolidayShift = isPublicHoliday(shift.work_date);
                            const recalc = shift.has_left
                                ? calculateShiftHours(
                                      shift.entry_time,
                                      shift.leave_time,
                                      shift.breaks || [],
                                      shift.work_date,
                                  )
                                : null;

                            return (
                                <div
                                    key={shift.id}
                                    className={cn(
                                        'akk-list-card overflow-hidden rounded-2xl border bg-white/90 p-4',
                                        isSundayShift || isHolidayShift ? 'border-red-200 bg-red-50/70' : 'border-slate-200/80'
                                    )}
                                >
                                            <button
                                                type="button"
                                                onClick={() => toggleCardExpansion(shift.id)}
                                                className="flex min-h-11 w-full items-start gap-3 text-left"
                                            >
                                                <span
                                                    className={cn(
                                                        'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                                                        shift.has_left ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'
                                                    )}
                                                >
                                                    <Clock className="h-5 w-5" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex flex-wrap items-center gap-2">
                                                        <span className="font-semibold text-slate-900">{formatDate(shift.work_date)}</span>
                                                        {expandedCards.has(shift.id) ? (
                                                            <ChevronUp className="h-4 w-4 text-slate-400" />
                                                        ) : (
                                                            <ChevronDown className="h-4 w-4 text-slate-400" />
                                                        )}
                                                    </span>
                                                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                        <MapPin className="h-3 w-3" />
                                                        {shift.sites?.site_name || '—'}
                                                    </span>
                                                </span>
                                            </button>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                    <Badge variant={shift.has_left ? 'default' : 'secondary'}>
                                                        {shift.has_left ? (
                                                            <>
                                                                <CheckCircle className="mr-1 h-3 w-3" />
                                                                Completed
                                                            </>
                                                        ) : (
                                                            'In progress'
                                                        )}
                                                    </Badge>
                                                    {shift.has_left ? <ShiftApprovalStatusBadge shift={shift} /> : null}
                                                    {isSundayShift ? <Badge variant="destructive">Sunday</Badge> : null}
                                                    {isHolidayShift ? <Badge variant="destructive">Holiday</Badge> : null}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
                                                            {shift.entry_time ? (
                                                                <span>Entry: {formatTime(shift.entry_time)}</span>
                                                            ) : null}
                                                            {shift.leave_time ? (
                                                                <span>Exit: {formatTime(shift.leave_time)}</span>
                                                            ) : null}
                                            </div>
                                                        {shift.has_left && shift.approved_by && isShiftApproved(shift) ? (
                                                            <p className="mt-1 text-xs italic text-emerald-800">
                                                                Approved by: {shift.approved_by}
                                                            </p>
                                                        ) : null}
                                                        {shift.has_left && shiftNeedsApprovalActions(shift) ? (
                                                            <p className="mt-1 text-xs italic text-amber-800">
                                                                Waiting for manager/admin approval before this shift counts toward pay.
                                                            </p>
                                                        ) : null}
                                                        {recalc ? (
                                                            <div className="mt-2 flex flex-wrap gap-3 text-sm">
                                                                {recalc.basicHours > 0 ? (
                                                                    <span className="font-medium text-green-600">
                                                                        Basic: {recalc.basicHours.toFixed(2)}h
                                                                    </span>
                                                                ) : null}
                                                                {recalc.sundayHours > 0 ? (
                                                                    <span className="font-medium text-orange-600">
                                                                        Sun/PH: {recalc.sundayHours.toFixed(2)}h
                                                                    </span>
                                                                ) : null}
                                                                {recalc.otHours > 0 ? (
                                                                    <span className="font-medium text-blue-600">
                                                                        OT: {recalc.otHours.toFixed(2)}h
                                                                    </span>
                                                                ) : null}
                                                                {recalc.breakHours > 0 ? (
                                                                    <span className="font-medium text-purple-600">
                                                                        Break: {recalc.breakHours.toFixed(2)}h
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        ) : null}

                                            {expandedCards.has(shift.id) ? (
                                                <div className="mt-4 border-t border-slate-200 pt-4">
                                                    <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                                                        <div>
                                                            <h4 className="mb-2 font-medium text-slate-700">Time details</h4>
                                                            <div className="space-y-1">
                                                                <p>Entry: {shift.entry_time ? formatTime(shift.entry_time) : '—'}</p>
                                                                {(shift.breaks || []).map((b, i) => (
                                                                    <p key={b.id || i} className="flex items-center gap-1">
                                                                        <Coffee className="h-3 w-3" />
                                                                        Break {i + 1}: {formatTime(b.break_start)} – {formatTime(b.break_end)}
                                                                    </p>
                                                                ))}
                                                                <p>Exit: {shift.leave_time ? formatTime(shift.leave_time) : '—'}</p>
                                                            </div>
                                                        </div>
                                                        {recalc ? (
                                                            <div>
                                                                <h4 className="mb-2 font-medium text-slate-700">Hours breakdown</h4>
                                                                <div className="space-y-1">
                                                                    <p>Basic: {recalc.basicHours.toFixed(2)}h</p>
                                                                    <p>Sun/PH: {recalc.sundayHours.toFixed(2)}h</p>
                                                                    <p>OT: {recalc.otHours.toFixed(2)}h</p>
                                                                    <p>Break: {recalc.breakHours.toFixed(2)}h</p>
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            ) : null}
                                </div>
                            );
                        })}
                </div>
            )}
        </WorkerPageShell>
    );
}
