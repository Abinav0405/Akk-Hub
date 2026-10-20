import React, { useMemo, useState } from 'react';
import { CalendarDays, User } from 'lucide-react';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    countRequestedLeaveDays,
    getLeaveStatusLabel,
    normalizeLeaveType,
} from '@/modules/timesheet/lib/leaveService';
import { parseDateOnly, toSingaporeDateStr } from '@/modules/timesheet/lib/timeUtils';
import { glassPanel, glassDialog } from '@/ui/glass';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_DOT = {
    approved: 'bg-emerald-500',
    pending_admin: 'bg-orange-400',
    pending_manager: 'bg-amber-400',
    pending: 'bg-yellow-400',
    rejected: 'bg-red-400',
    cancelled: 'bg-slate-400',
};

const STATUS_BADGE = {
    approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    pending_admin: 'border-orange-200 bg-orange-50 text-orange-700',
    pending_manager: 'border-amber-200 bg-amber-50 text-amber-700',
    pending: 'border-yellow-200 bg-yellow-50 text-yellow-700',
};

function leaveTypeShort(leaveType) {
    const n = normalizeLeaveType(leaveType);
    if (n === 'Annual Leave') return 'AL';
    if (n === 'Medical Leave' || n === 'Hospitalization Leave') return 'MC';
    return n.split(' ')[0] || n;
}

function leaveDurationLabel(leaveDuration) {
    if (leaveDuration === 'half_day_morning') return 'Half day (AM)';
    if (leaveDuration === 'half_day_afternoon') return 'Half day (PM)';
    return 'Full day';
}

function formatDayLong(dateStr) {
    const d = parseDateOnly(dateStr);
    if (!d || Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-SG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

function formatDayShort(dateStr) {
    const d = parseDateOnly(dateStr);
    if (!d || Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function LeaveCalendar({ leaveRequests = [], onSelectLeave }) {
    const [monthYear, setMonthYear] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [selectedDate, setSelectedDate] = useState(null);

    const todayStr = toSingaporeDateStr(new Date());

    const { year, month, weeks } = useMemo(() => {
        const [y, m] = monthYear.split('-').map(Number);
        if (!y || !m) return { year: 0, month: 0, weeks: [] };

        const daysInMonth = new Date(y, m, 0).getDate();
        const firstWeekday = new Date(y, m - 1, 1).getDay();
        const cells = [];

        for (let i = 0; i < firstWeekday; i++) cells.push(null);
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const leaves = (leaveRequests || []).filter((r) => {
                if (['rejected', 'cancelled'].includes(r.status)) return false;
                return dateStr >= r.from_date && dateStr <= r.to_date;
            });
            cells.push({ dateStr, day, leaves });
        }

        const padded = [...cells];
        while (padded.length % 7 !== 0) padded.push(null);

        const weekRows = [];
        for (let i = 0; i < padded.length; i += 7) {
            weekRows.push(padded.slice(i, i + 7));
        }

        return { year: y, month: m, weeks: weekRows };
    }, [monthYear, leaveRequests]);

    const monthLabel = year && month
        ? new Date(year, month - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })
        : '';

    const selectedDayLeaves = useMemo(() => {
        if (!selectedDate) return [];
        return (leaveRequests || [])
            .filter((r) => {
                if (['rejected', 'cancelled'].includes(r.status)) return false;
                return selectedDate >= r.from_date && selectedDate <= r.to_date;
            })
            .sort((a, b) => {
                if (a.status === 'approved' && b.status !== 'approved') return -1;
                if (b.status === 'approved' && a.status !== 'approved') return 1;
                return String(a.employee_name || '').localeCompare(String(b.employee_name || ''));
            });
    }, [selectedDate, leaveRequests]);

    return (
        <div className={`${glassPanel} p-4 sm:p-5`}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-slate-900">Leave calendar</h3>
                    <p className="text-xs text-slate-500">{monthLabel} — tap a day to see who is on leave</p>
                </div>
                <Input
                    type="month"
                    value={monthYear}
                    onChange={(e) => setMonthYear(e.target.value)}
                    className="h-9 w-full max-w-[180px] border-slate-200 bg-white"
                />
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
                {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="py-1">{label}</div>
                ))}
            </div>

            <div className="mt-1 space-y-1">
                {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1">
                        {week.map((cell, ci) => {
                            if (!cell) {
                                return <div key={ci} className="min-h-[72px] rounded-md bg-slate-50/50" />;
                            }

                            const { day, dateStr, leaves } = cell;
                            const isWeekend = new Date(year, month - 1, day).getDay() === 0;
                            const isToday = dateStr === todayStr;

                            return (
                                <button
                                    key={dateStr}
                                    type="button"
                                    onClick={() => setSelectedDate(dateStr)}
                                    className={`min-h-[72px] rounded-md border p-1 text-left transition-colors hover:border-orange-300 hover:bg-orange-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${
                                        isToday
                                            ? 'border-orange-300 bg-orange-50/50 ring-1 ring-orange-200'
                                            : isWeekend
                                                ? 'border-slate-100 bg-slate-50'
                                                : 'border-slate-200 bg-white'
                                    }`}
                                >
                                    <span className="flex items-center justify-between">
                                        <span className={`text-xs font-semibold ${isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white' : 'text-slate-700'}`}>
                                            {day}
                                        </span>
                                        {leaves.length > 0 && (
                                            <span className="rounded-full bg-orange-100 px-1.5 text-[10px] font-semibold leading-4 text-orange-700">
                                                {leaves.length}
                                            </span>
                                        )}
                                    </span>
                                    <span className="mt-1 block space-y-0.5">
                                        {leaves.slice(0, 3).map((leave) => (
                                            <span
                                                key={leave.id}
                                                className="flex w-full items-center gap-1 rounded px-0.5 py-0.5"
                                                title={`${leave.employee_name || leave.employee_id} — ${getLeaveStatusLabel(leave.status)}`}
                                            >
                                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[leave.status] || 'bg-slate-400'}`} />
                                                <span className="truncate text-[10px] leading-tight text-slate-700">
                                                    {leaveTypeShort(leave.leave_type)}
                                                </span>
                                            </span>
                                        ))}
                                        {leaves.length > 3 && (
                                            <span className="block text-[10px] text-slate-500">+{leaves.length - 3} more</span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(STATUS_DOT).map(([status, cls]) => (
                    <Badge key={status} variant="outline" className="gap-1 text-[10px] font-normal">
                        <span className={`h-2 w-2 rounded-full ${cls}`} />
                        {getLeaveStatusLabel(status)}
                    </Badge>
                ))}
            </div>

            <Dialog open={!!selectedDate} onOpenChange={(open) => { if (!open) setSelectedDate(null); }}>
                <DialogContent className={`${glassDialog} max-w-md`}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-slate-900">
                            <CalendarDays className="h-5 w-5 text-orange-500" />
                            {selectedDate ? formatDayLong(selectedDate) : ''}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedDayLeaves.length === 0
                                ? 'Leave overview for this day'
                                : `${selectedDayLeaves.length} worker${selectedDayLeaves.length === 1 ? '' : 's'} on leave`}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedDayLeaves.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
                            <User className="h-8 w-8 text-slate-300" />
                            <p className="text-sm font-medium text-slate-600">No one on leave this day</p>
                        </div>
                    ) : (
                        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                            {selectedDayLeaves.map((leave) => (
                                <button
                                    key={leave.id}
                                    type="button"
                                    onClick={() => onSelectLeave?.(leave)}
                                    className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-orange-300 hover:bg-orange-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">
                                                {leave.employee_name || leave.employee_id}
                                            </p>
                                            <p className="text-xs text-slate-500">{leave.employee_id}</p>
                                        </div>
                                        <Badge
                                            variant="outline"
                                            className={`shrink-0 text-[10px] font-medium ${STATUS_BADGE[leave.status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}
                                        >
                                            {getLeaveStatusLabel(leave.status)}
                                        </Badge>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[leave.status] || 'bg-slate-400'}`} />
                                            {normalizeLeaveType(leave.leave_type)}
                                        </span>
                                        <span>{leaveDurationLabel(leave.leave_duration)}</span>
                                        <span className="text-slate-500">
                                            {leave.from_date === leave.to_date
                                                ? formatDayShort(leave.from_date)
                                                : `${formatDayShort(leave.from_date)} – ${formatDayShort(leave.to_date)}`}
                                            {' · '}
                                            {countRequestedLeaveDays(leave)} day{countRequestedLeaveDays(leave) === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
