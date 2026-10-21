import { supabaseTimesheet, DB_SCHEMA } from '@/core/supabase'
import {
    hasRoleSessionMarker,
    verifyAdminSession,
} from '@/core/auth/timesheetSession';
import { isAdminShiftRefreshPaused } from '@/modules/timesheet/lib/adminShiftRefreshPause';

/**
 * SECURITY (FCM-05 / SEC-15): Client-side Realtime filters are UX only — they are NOT
 * authorization. Postgres RLS (and Realtime authorization) must enforce which rows a
 * connection can receive. Do not treat `filter: worker_id=eq.…` as a security boundary.
 */

/** @type {import('@supabaseTimesheet/supabaseTimesheet-js').RealtimeChannel | null} */
let workerChannel = null;
/** @type {import('@supabaseTimesheet/supabaseTimesheet-js').RealtimeChannel | null} */
let adminChannel = null;
/** @type {import('@supabaseTimesheet/supabaseTimesheet-js').RealtimeChannel | null} */
let adminVehicleChannel = null;

let workerRetryTimer = null;
let adminRetryTimer = null;

function logRealtimeStatus(scope, status, err) {
    if (status === 'SUBSCRIBED') {
        console.debug(`[Realtime] ${scope} connected`);
        return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.warn(`[Realtime] ${scope} ${status}`, err?.message || err || '');
    }
}

function scheduleWorkerRetry(workerId) {
    if (workerRetryTimer) return;
    workerRetryTimer = window.setTimeout(() => {
        workerRetryTimer = null;
        void startWorkerRealtimeNotifications(workerId, { isRetry: true });
    }, 8000);
}

function scheduleAdminRetry() {
    if (adminRetryTimer) return;
    adminRetryTimer = window.setTimeout(() => {
        adminRetryTimer = null;
        void startAdminRealtimeNotifications({ isRetry: true });
    }, 8000);
}

/** Show a toast via sonner (dynamic import keeps this module lightweight). */
async function showToast(message, options = {}) {
    try {
        const { toast } = await import('sonner');
        toast(message, options);
    } catch {
        // sonner unavailable — silently skip
    }
}

/** Invalidate a React Query key if the app's query client is exposed on window. */
function invalidateQuery(queryKey) {
    if (
        isAdminShiftRefreshPaused() &&
        Array.isArray(queryKey) &&
        (queryKey[0] === 'shifts' || queryKey[0] === 'supervisor-shifts')
    ) {
        return;
    }
    const qc = window.__akkQueryClient;
    if (qc) {
        qc.invalidateQueries({ queryKey });
    }
}

export function stopWorkerRealtimeNotifications() {
    if (workerRetryTimer) {
        window.clearTimeout(workerRetryTimer);
        workerRetryTimer = null;
    }
    if (workerChannel) {
        try {
            supabaseTimesheet.removeChannel(workerChannel);
        } catch (e) {
            console.warn('removeChannel worker', e);
        }
        workerChannel = null;
    }
}

export function stopAdminRealtimeNotifications() {
    if (adminRetryTimer) {
        window.clearTimeout(adminRetryTimer);
        adminRetryTimer = null;
    }
    if (adminVehicleChannel) {
        try {
            supabaseTimesheet.removeChannel(adminVehicleChannel);
        } catch (e) {
            console.warn('removeChannel admin vehicle', e);
        }
        adminVehicleChannel = null;
    }
    if (adminChannel) {
        try {
            supabaseTimesheet.removeChannel(adminChannel);
        } catch (e) {
            console.warn('removeChannel admin', e);
        }
        adminChannel = null;
    }
}

/**
 * Supabase Realtime → local notifications for the signed-in worker.
 * Enable replication for `leave_requests`, `passed_out_payslips`, `passed_out_timesheets`,
 * `shifts` (worker filters); admin channel uses the same tables without worker filter where needed.
 *
 * Requires a local worker role-session marker before subscribe (defense in depth; RLS is still required).
 */
export async function startWorkerRealtimeNotifications(workerId, { isRetry = false } = {}) {
    stopWorkerRealtimeNotifications();
    const wid = String(workerId || '').trim();
    if (!wid) return;

    if (!hasRoleSessionMarker('worker')) {
        console.warn('[Realtime] Skipping worker subscribe — no valid worker role session marker');
        return;
    }

    const ch = supabaseTimesheet
        .channel(`worker-rt-${wid}${isRetry ? '-r' : ''}`)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: DB_SCHEMA.timesheet,
                table: 'leave_requests',
                filter: `employee_id=eq.${wid}`,
            },
                (payload) => {
                const n = payload.new;
                const o = payload.old;
                if (!n) return;
                if (o && n.status !== o.status && n.status) {
                    const statusMessages = {
                        approved: 'Your leave request was approved.',
                        rejected: 'Your leave request was rejected.',
                        cancelled: 'Your leave request was cancelled.',
                        pending: 'Your leave request is pending review.',
                        pending_manager: 'Your leave request was sent to your manager.',
                        pending_admin: 'Your leave request was forwarded to admin for final approval.',
                    };
                    const statusLabel =
                        statusMessages[n.status] ??
                        `Leave status updated: ${n.status.replace(/_/g, ' ')}.`;
                    showToast(statusLabel);
                    invalidateQuery(['leaveRequests']);
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: DB_SCHEMA.timesheet,
                table: 'passed_out_payslips',
                filter: `worker_id=eq.${wid}`,
            },
            (payload) => {
                const row = payload.new;
                if (!row) return;
                const label = row.month_year ? `Payslip for ${row.month_year} is ready.` : 'A new payslip is available.';
                showToast(label);
                invalidateQuery(['passedOutPayslips']);
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: DB_SCHEMA.timesheet,
                table: 'shifts',
                filter: `worker_id=eq.${wid}`,
            },
            (payload) => {
                const n = payload.new;
                const o = payload.old;
                if (!n || !o) return;
                const changed =
                    n.has_left !== o.has_left ||
                    n.leave_type !== o.leave_type ||
                    (n.edited_by && n.edited_by !== o.edited_by) ||
                    n.time_in !== o.time_in ||
                    n.time_out !== o.time_out;
                if (!changed) return;
                if (n.edited_by && n.edited_by !== o.edited_by) {
                    showToast('Your shift has been updated by an admin.');
                } else if (n.has_left && !o.has_left) {
                    showToast('Your shift check-out has been recorded.');
                } else {
                    showToast('Your shift record was updated.');
                }
                invalidateQuery(['currentShift']);
                invalidateQuery(['shiftHistory']);
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: DB_SCHEMA.timesheet,
                table: 'passed_out_timesheets',
                filter: `worker_id=eq.${wid}`,
            },
            (payload) => {
                const row = payload.new;
                if (!row) return;
                const label = row.month_year
                    ? `Timesheet for ${row.month_year} has been issued.`
                    : 'A new timesheet is available for review.';
                showToast(label);
                invalidateQuery(['passedOutTimesheets']);
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: DB_SCHEMA.timesheet,
                table: 'passed_out_timesheets',
                filter: `worker_id=eq.${wid}`,
            },
            (payload) => {
                const n = payload.new;
                const o = payload.old;
                if (!n || !o || n.status === o.status) return;
                const statusLabel = {
                    approved: 'Your timesheet has been approved.',
                    rejected: 'Your timesheet was rejected. Please check the comments.',
                    returned_to_worker: 'Your timesheet was returned — please review and resubmit.',
                }[n.status] ?? `Timesheet status updated to: ${n.status}.`;
                showToast(statusLabel);
                invalidateQuery(['passedOutTimesheets']);
            }
        );

    ch.subscribe((status, err) => {
        logRealtimeStatus('worker', status, err);
        if (status === 'SUBSCRIBED') {
            if (workerRetryTimer) {
                window.clearTimeout(workerRetryTimer);
                workerRetryTimer = null;
            }
            return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            scheduleWorkerRetry(wid);
        }
    });
    workerChannel = ch;
}

function subscribeAdminVehicleChannel({ isRetry = false } = {}) {
    if (adminVehicleChannel) {
        try {
            supabaseTimesheet.removeChannel(adminVehicleChannel);
        } catch {
            /* ignore */
        }
        adminVehicleChannel = null;
    }

    const ch = supabaseTimesheet
        .channel(`admin-rt-vehicles${isRetry ? '-r' : ''}`)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: DB_SCHEMA.timesheet, table: 'vehicle_journeys' },
            (payload) => {
                const row = payload.new;
                if (!row) return;
                showToast(`${row.worker_name || 'Driver'} started journey (${row.worker_id})`);
                invalidateQuery(['vehicleJourneys']);
            }
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: DB_SCHEMA.timesheet, table: 'vehicle_journeys' },
            (payload) => {
                const n = payload.new;
                const o = payload.old;
                if (!n || !o) return;
                if (n.status !== o.status) {
                    if (n.status === 'completed') {
                        showToast(`Journey completed — ${n.worker_name || 'driver'}`);
                    } else if (n.status === 'on_break') {
                        showToast(`${n.worker_name || 'Driver'} is on a vehicle break`);
                    }
                    invalidateQuery(['vehicleJourneys']);
                }
            }
        )
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: DB_SCHEMA.timesheet, table: 'vehicle_location_points' },
            () => {
                invalidateQuery(['vehicleJourneys', 'active']);
            }
        );

    ch.subscribe((status, err) => {
        logRealtimeStatus('admin-vehicles', status, err);
        /* Vehicle tables may be missing until migration — do not retry endlessly */
        if (status === 'CHANNEL_ERROR') {
            console.warn(
                '[Realtime] Vehicle tracking live updates unavailable. Run migration_enable_realtime_publication.sql'
            );
        }
    });
    adminVehicleChannel = ch;
}

/**
 * Unfiltered admin channel — gated behind verified Supabase Auth admin session.
 * Filters are still not security; RLS must restrict Realtime payloads.
 */
export async function startAdminRealtimeNotifications({ isRetry = false } = {}) {
    stopAdminRealtimeNotifications();

    const adminOk = await verifyAdminSession();
    if (!adminOk) {
        console.warn('[Realtime] Skipping admin subscribe — no verified admin Auth session');
        return;
    }

    const ch = supabaseTimesheet
        .channel(`admin-rt-global${isRetry ? '-r' : ''}`)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: DB_SCHEMA.timesheet, table: 'shifts' },
            () => {
                invalidateQuery(['shifts']);
                invalidateQuery(['supervisor-shifts']);
            }
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: DB_SCHEMA.timesheet, table: 'shifts' },
            (payload) => {
                const n = payload.new;
                const o = payload.old;
                if (!n || !o) return;
                if (
                    n.has_left !== o.has_left ||
                    n.time_in !== o.time_in ||
                    n.time_out !== o.time_out ||
                    n.leave_type !== o.leave_type
                ) {
                    invalidateQuery(['shifts']);
                    invalidateQuery(['supervisor-shifts']);
                    invalidateQuery(['currentShift']);
                }
            }
        )
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: DB_SCHEMA.timesheet, table: 'leave_requests' },
            () => {
                invalidateQuery(['leaveRequests']);
            }
        )
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: DB_SCHEMA.timesheet, table: 'passed_out_payslips' },
            () => {
                invalidateQuery(['passedOutPayslips']);
            }
        )
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: DB_SCHEMA.timesheet, table: 'passed_out_timesheets' },
            () => {
                invalidateQuery(['adminPassedOutTimesheets']);
                invalidateQuery(['managerPassedOutTimesheets']);
                invalidateQuery(['passedOutTimesheets']);
            }
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: DB_SCHEMA.timesheet, table: 'passed_out_timesheets' },
            (payload) => {
                const n = payload.new;
                const o = payload.old;
                if (!n || !o || n.status === o.status) return;
                const attention = new Set([
                    'awaiting_admin',
                    'awaiting_manager',
                    'declined_by_worker',
                    'declined_by_manager',
                    'returned_to_worker',
                ]);
                if (!attention.has(n.status)) return;
                invalidateQuery(['adminPassedOutTimesheets']);
                invalidateQuery(['managerPassedOutTimesheets']);
                invalidateQuery(['passedOutTimesheets']);
            }
        );

    ch.subscribe((status, err) => {
        logRealtimeStatus('admin', status, err);
        if (status === 'SUBSCRIBED') {
            if (adminRetryTimer) {
                window.clearTimeout(adminRetryTimer);
                adminRetryTimer = null;
            }
            subscribeAdminVehicleChannel({ isRetry });
            return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            scheduleAdminRetry();
        }
    });
    adminChannel = ch;
}
