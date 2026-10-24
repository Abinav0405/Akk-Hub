/**
 * Local workers' HR table is admin-only on the database. Everyone else works through server
 * functions (core.worker_type_of / my_worker_record / local_worker_ids).
 *
 * Managers and supervisors never see local workers (their shifts, timesheets, leave, forms,
 * Materials requests, site photos, deployments). Admins see everyone.
 * `withoutLocalWorkers(rows, row => row.employee_id)` is a no-op for every role except
 * manager / supervisor.
 */
import { UNIFIED, supabaseCore, supabaseTimesheet } from '@/core/supabase';
import { getIdentity } from '@/core/auth/identity';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';

const TTL_MS = 5 * 60 * 1000;
let cache = null; // { at, promise }

/** True when the signed-in person must not see local workers. */
export function hidesLocalWorkers() {
    const role = getIdentity()?.role;
    return role === 'manager' || role === 'supervisor';
}

/** IDs of local workers (no names, no HR), for staff sessions. */
export function getLocalWorkerIds() {
    if (!cache || Date.now() - cache.at > TTL_MS) {
        const request = UNIFIED
            ? supabaseCore.rpc('local_worker_ids', { p_token: getRoleSessionToken() || null }).then(({ data, error }) => {
                  if (error) throw error;
                  return data || [];
              })
            : supabaseTimesheet
                  .from('local_worker_details')
                  .select('employee_id')
                  .then(({ data, error }) => {
                      if (error) throw error;
                      return (data || []).map((r) => r.employee_id);
                  });
        const promise = request.then((ids) => new Set(ids.map((id) => String(id).trim()))).catch((e) => {
            cache = null;
            throw e;
        });
        cache = { at: Date.now(), promise };
    }
    return cache.promise;
}

/**
 * Same as getLocalWorkerIds, but never throws. Use on manager/supervisor shift lists so a missing
 * or expired role-session token cannot blank the entire list (foreign workers still show; locals
 * may briefly appear until the session is fixed).
 * @returns {Promise<Set<string>>}
 */
export async function getLocalWorkerIdsSafe() {
    try {
        return await getLocalWorkerIds();
    } catch (e) {
        console.error('[localWorkers] local_worker_ids unavailable; shift lists will not hide locals', e);
        return new Set();
    }
}

export function clearLocalWorkerCache() {
    cache = null;
}

/**
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string | null | undefined} getId employee ID of the row's worker
 * @returns {Promise<T[]>}
 */
export async function withoutLocalWorkers(rows, getId) {
    const list = rows || [];
    if (!list.length || !hidesLocalWorkers()) return list;
    const local = await getLocalWorkerIds();
    return list.filter((row) => {
        const id = getId(row);
        return id == null || !local.has(String(id).trim());
    });
}

/**
 * The signed-in worker's own non-secret record (name, designation, in_company, leave balances and
 * limits) — works for local and foreign workers on the one backend. null when not available.
 */
export async function fetchMyWorkerRecord() {
    if (!UNIFIED) return null;
    const { data, error } = await supabaseCore.rpc('my_worker_record', { p_token: getRoleSessionToken() || null });
    if (error) throw error;
    return data || null;
}
