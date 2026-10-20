import { useEffect, useRef } from 'react';
import { supabaseTimesheet } from '@/core/supabase'

/**
 * Poll only a lightweight head row (updated_at) and refetch full data when it changes.
 * Same check interval as before, but skips heavy queries when nothing changed.
 */
export function useUpdatedAtHeartbeat({ enabled, intervalMs, queryFn, onChange }) {
    const headRef = useRef(null);

    useEffect(() => {
        if (!enabled) return undefined;

        headRef.current = null;

        const tick = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const head = await queryFn();
                if (!head) return;
                if (headRef.current !== head) {
                    headRef.current = head;
                    onChange();
                }
            } catch {
                /* polling should never break the UI */
            }
        };

        const onVisibility = () => {
            if (!document.hidden) void tick();
        };

        const id = window.setInterval(tick, intervalMs);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, intervalMs, queryFn, onChange]);
}

const WORKER_TIMESHEET_STATUSES = [
    'pending_worker',
    'returned_to_worker',
    'awaiting_manager',
    'awaiting_admin',
    'approved',
];

const MANAGER_TIMESHEET_STATUSES = ['awaiting_manager', 'declined_by_worker'];

/** Head updated_at for a worker's active timesheets. */
export async function fetchWorkerTimesheetHeadTs(workerId) {
    if (!workerId) return null;
    const { data, error } = await supabaseTimesheet
        .from('passed_out_timesheets')
        .select('updated_at')
        .eq('worker_id', workerId)
        .in('status', WORKER_TIMESHEET_STATUSES)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0]?.updated_at ?? null;
}

/** Head updated_at for manager queue timesheets. */
export async function fetchManagerTimesheetHeadTs() {
    const { data, error } = await supabaseTimesheet
        .from('passed_out_timesheets')
        .select('updated_at')
        .eq('worker_type', 'foreign')
        .in('status', MANAGER_TIMESHEET_STATUSES)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0]?.updated_at ?? null;
}

/** Head updated_at for admin timesheet report month. */
export async function fetchAdminTimesheetHeadTs(year, month) {
    if (!year || !month) return null;
    const { data, error } = await supabaseTimesheet
        .from('passed_out_timesheets')
        .select('updated_at')
        .eq('year', year)
        .eq('month', month)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data?.[0]?.updated_at ?? null;
}
