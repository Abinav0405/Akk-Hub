/**
 * Managers and supervisors never see local workers (their shifts, timesheets, leave, forms,
 * Materials requests, site photos, deployments). Admins see everyone.
 *
 * Local workers are identified by the Attendance `local_worker_details` ID list (read once and
 * cached). Use `withoutLocalWorkers(rows, row => row.employee_id)` on a list a manager or
 * supervisor is about to see; it is a no-op for every other role.
 */
import { supabaseTimesheet } from '@/core/supabase';
import { getIdentity } from '@/core/auth/identity';

const TTL_MS = 5 * 60 * 1000;
let cache = null; // { at, promise }

/** True when the signed-in person must not see local workers. */
export function hidesLocalWorkers() {
    const role = getIdentity()?.role;
    return role === 'manager' || role === 'supervisor';
}

export function getLocalWorkerIds() {
    if (!cache || Date.now() - cache.at > TTL_MS) {
        const promise = supabaseTimesheet
            .from('local_worker_details')
            .select('employee_id')
            .then(({ data, error }) => {
                if (error) {
                    cache = null;
                    throw error;
                }
                return new Set((data || []).map((r) => String(r.employee_id).trim()));
            });
        cache = { at: Date.now(), promise };
    }
    return cache.promise;
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
