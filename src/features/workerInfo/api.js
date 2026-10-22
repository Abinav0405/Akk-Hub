/**
 * Worker information API (core.* functions in migration/sql/80_worker_info.sql).
 * Admin calls carry the admin's sign-in; worker calls carry the worker's hub session token.
 * One AKK Hub backend only.
 */
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';

async function rpc(fn, args = {}) {
    if (!UNIFIED) throw new Error('Worker information needs the one AKK Hub backend.');
    const { data, error } = await supabaseCore.rpc(fn, args);
    if (error) throw new Error(error.message || 'Something went wrong.');
    return data;
}
const token = () => getRoleSessionToken() || null;

export const workerInfoAdmin = {
    directory: (scope = 'all') => rpc('admin_worker_directory', { p_scope: scope }),
    profile: (id) => rpc('admin_worker_profile', { p_employee_id: id }),
    save: (id, values) => rpc('admin_save_worker_info', { p_employee_id: id, p_values: values }),
    /** items: [{ employee_id, fields: string[], custom: string[] }] — each worker gets their own list. */
    requestItems: (items, message) => rpc('admin_request_worker_info_items', { p_items: items, p_message: message || null }),
    customLabels: () => rpc('admin_info_custom_labels'),
    reviewRequest: (id, approve, note) => rpc('admin_review_info_request', { p_request_id: id, p_approve: approve, p_note: note || null }),
    cancelRequest: (id) => rpc('admin_cancel_info_request', { p_request_id: id }),
    sendChecks: (ids) => rpc('admin_send_info_checks', { p_employee_ids: ids }),
    cancelCheck: (id) => rpc('admin_cancel_info_check', { p_check_id: id }),
    resolveCheck: (id, note) => rpc('admin_resolve_info_check', { p_check_id: id, p_note: note || null }),
    activity: () => rpc('admin_info_activity'),
    setSettings: (required, auto) => rpc('admin_set_info_settings', { p_required: required, p_auto: auto }),
    requestMissing: () => rpc('admin_request_missing_info'),
    exportWorkers: (ids, scope, fields) => rpc('admin_export_workers', { p_employee_ids: ids, p_scope: scope, p_fields: fields }),
};

export const workerInfoMe = {
    card: () => rpc('my_info_card', { p_token: token() }),
    tasks: () => rpc('my_info_tasks', { p_token: token() }),
    submit: (requestId, values) => rpc('submit_info_request', { p_token: token(), p_request_id: requestId, p_values: values }),
    respondCheck: (checkId, approve, reason, fields) =>
        rpc('respond_info_check', { p_token: token(), p_check_id: checkId, p_approve: approve, p_reason: reason || null, p_fields: fields || null }),
};
