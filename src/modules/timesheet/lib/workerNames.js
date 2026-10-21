import { supabaseTimesheet } from '@/core/supabase'
import { mayQueryLocalWorkerDetails } from '@/modules/timesheet/lib/workerPrivacy';

/** Normalize worker IDs for consistent map lookups. */
export function normalizeWorkerId(id) {
    if (id === null || id === undefined) return '';
    return String(id).trim();
}

/**
 * Resolve employee names from worker_details and local_worker_details.
 * Keys are normalized string employee IDs.
 * Managers/supervisors never query local_worker_details (product: local HR is admin-only).
 */
export async function fetchWorkerNameMap(workerIds) {
    const uniqueIds = [...new Set((workerIds || []).map(normalizeWorkerId).filter(Boolean))];
    const nameMap = new Map();
    if (uniqueIds.length === 0) return nameMap;

    const addRows = (rows) => {
        for (const w of rows || []) {
            const key = normalizeWorkerId(w.employee_id);
            if (key && w.employee_name && !nameMap.has(key)) {
                nameMap.set(key, w.employee_name);
            }
        }
    };

    const numericIds = uniqueIds
        .map((id) => parseInt(id, 10))
        .filter((n) => Number.isFinite(n));

    const idVariants = [...new Set([...uniqueIds, ...numericIds.map(String), ...numericIds])];
    const includeLocal = mayQueryLocalWorkerDetails();

    const [foreignRes, localRes] = await Promise.all([
        supabaseTimesheet.from('worker_details').select('employee_id, employee_name').in('employee_id', idVariants),
        includeLocal
            ? supabaseTimesheet.from('local_worker_details').select('employee_id, employee_name').in('employee_id', idVariants)
            : Promise.resolve({ data: [], error: null }),
    ]);

    if (foreignRes.error) console.warn('worker_details name lookup:', foreignRes.error);
    if (localRes.error) console.warn('local_worker_details name lookup:', localRes.error);

    addRows(foreignRes.data);
    addRows(localRes.data);

    const missing = uniqueIds.filter((id) => !nameMap.has(id));
    if (missing.length > 0) {
        // Full-table fallback is admin/worker only — never dump local directory to manager sessions.
        const foreignAll = await supabaseTimesheet.from('worker_details').select('employee_id, employee_name');
        const localAll = includeLocal
            ? await supabaseTimesheet.from('local_worker_details').select('employee_id, employee_name')
            : { data: [] };
        const missingSet = new Set(missing);
        for (const w of [...(foreignAll.data || []), ...(localAll.data || [])]) {
            const key = normalizeWorkerId(w.employee_id);
            if (missingSet.has(key) && w.employee_name) {
                nameMap.set(key, w.employee_name);
            }
        }
    }

    return nameMap;
}

export function getWorkerDisplayName(nameMap, workerId) {
    const key = normalizeWorkerId(workerId);
    return nameMap.get(key) || `Worker ${key || '—'}`;
}
