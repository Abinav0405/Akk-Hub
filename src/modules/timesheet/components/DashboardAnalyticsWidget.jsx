import React, { useMemo } from 'react';
import { Card, CardContent } from '@/ui/card';
import { Users, Clock, AlertCircle } from 'lucide-react';
import { calculateShiftHours, getTodaySingapore, getSingaporeWallClock } from '@/modules/timesheet/lib/timeUtils';
import { glassPanel } from '@/ui/PortalShell';
import { cn } from '@/modules/timesheet/lib/utils';
import { useLanguage } from '@/core-i18n';

function toSgMinutesSinceMidnight(dateTime) {
    const p = getSingaporeWallClock(dateTime);
    if (!p) return null;
    return p.hour * 60 + p.minute;
}

function formatHours(n) {
    if (!Number.isFinite(n)) return '0.0h';
    return `${Math.round(n * 10) / 10}h`;
}

export default function DashboardAnalyticsWidget({ shifts, lateCutoffMinutes = 9 * 60, variant = 'header', accent = 'brand' }) {
    const { t } = useLanguage();
    const stats = useMemo(() => {
        const today = getTodaySingapore();
        const list = Array.isArray(shifts) ? shifts : [];
        const todayShifts = list.filter((s) => s && s.work_date === today && !s.leave_type);

        const workerIds = new Set();
        let completedCount = 0;
        let sumNetWorkedHours = 0;
        let lateArrivals = 0;

        for (const s of todayShifts) {
            if (s.worker_id) workerIds.add(String(s.worker_id));

            const entryMin = toSgMinutesSinceMidnight(s.entry_time);
            if (entryMin != null && entryMin > lateCutoffMinutes) lateArrivals += 1;

            if (s.has_left && s.leave_time) {
                completedCount += 1;
                const normalizedBreaks = Array.isArray(s.breaks)
                    ? s.breaks
                          .filter((b) => b?.break_start && b?.break_end)
                          .map((b) => ({ break_start: b.break_start, break_end: b.break_end }))
                    : [];
                const calc = calculateShiftHours(s.entry_time, s.leave_time, normalizedBreaks, s.work_date);
                sumNetWorkedHours += calc.netWorkedHours || 0;
            }
        }

        const avgHours = completedCount ? sumNetWorkedHours / completedCount : 0;

        return {
            today,
            totalWorkers: workerIds.size,
            avgHours,
            lateArrivals,
        };
    }, [shifts, lateCutoffMinutes]);

    const tiles = [
        {
            label: variant === 'glass' || variant === 'app' ? t('ui.onSiteToday') : 'Workers clocked in (today)',
            value: stats.totalWorkers,
            hint: stats.today,
            icon: Users,
            tint: 'sky',
        },
        {
            label: variant === 'glass' || variant === 'app' ? t('ui.avgHours') : 'Average hours (completed)',
            value: formatHours(stats.avgHours),
            hint: t('ui.avgHoursHint'),
            icon: Clock,
            tint: 'emerald',
        },
        {
            label: t('ui.lateArrivals'),
            value: stats.lateArrivals,
            hint: t('ui.lateArrivalsHint'),
            icon: AlertCircle,
            tint: 'amber',
        },
    ];

    /** Native app (Capacitor) summary tiles — styled by src/native/native-app.css. */
    if (variant === 'app') {
        return (
            <div className="akk-stats" role="group" aria-label="Today at a glance">
                {tiles.map((tile) => (
                    <div key={tile.label} className="akk-stat" data-tone={tile.tint === 'amber' && stats.lateArrivals > 0 ? 'warning' : undefined}>
                        <p className="akk-stat__value">{tile.value}</p>
                        <p className="akk-stat__label">{tile.label}</p>
                        <p className="akk-stat__hint">{tile.hint}</p>
                    </div>
                ))}
            </div>
        );
    }

    const glassTints = {
        sky: { panel: 'border-[var(--g-hairline)]', icon: 'text-[var(--g-brand)]' },
        emerald: { panel: 'border-[var(--g-hairline)]', icon: 'text-[var(--g-tone-progress,#2f5d62)]' },
        amber: { panel: 'border-[var(--g-hairline)]', icon: 'text-[var(--g-warning,#b45309)]' },
    };

    if (variant === 'glass') {
        return (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {tiles.map((tile) => {
                    const Icon = tile.icon;
                    const tint = glassTints[tile.tint] || glassTints.sky;
                    return (
                        <div key={tile.label} className={cn(glassPanel, tint.panel, 'px-3 py-3 sm:px-4')}>
                            <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] font-medium leading-snug text-slate-500 sm:text-xs">{tile.label}</p>
                                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tint.icon)} />
                            </div>
                            <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{tile.value}</p>
                            <p className="mt-0.5 text-[10px] text-slate-400 sm:text-[11px]">{tile.hint}</p>
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-7xl px-safe">
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {tiles.map((tile) => {
                    const Icon = tile.icon;
                    return (
                        <Card key={tile.label} className="border-white/20 bg-white/10 text-white shadow-lg backdrop-blur">
                            <CardContent className="flex items-center justify-between p-4">
                                <div>
                                    <p className="text-xs font-semibold text-white/80">{tile.label}</p>
                                    <p className="mt-1 text-2xl font-bold leading-none">{tile.value}</p>
                                    <p className="mt-1 text-[11px] text-white/70">{tile.hint}</p>
                                </div>
                                <Icon className="h-6 w-6 text-white/90" />
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
