/**
 * Live Material Tracker + Site Progress numbers for the merged Employee home.
 * Read-only, cached for a minute, refreshed when the app comes back to the foreground —
 * no fast polling (the old Material Tracker screen polled every 3 s).
 */
import { useQuery } from '@tanstack/react-query';
import { supabaseMaterials } from '@/core/supabase';
import { getWorkerSession } from '@/core/auth/materialsSession';
import { isWorkerAuthenticated as isProgressWorker } from '@/core/auth/progress/workerSession';
import { useIdentity } from '@/core/auth/identity';
import { useModuleConnection } from '@/core/auth/bridges';

const STALE = 60 * 1000;

export function useMaterialsSummary() {
    const identity = useIdentity();
    const status = useModuleConnection(identity?.role, 'materials');
    const token = status === 'connected' ? getWorkerSession()?.token : null;
    const query = useQuery({
        queryKey: ['hub', 'materials-summary', token],
        enabled: !!token,
        staleTime: STALE,
        refetchOnWindowFocus: true,
        queryFn: async () => {
            const { data, error } = await supabaseMaterials.rpc('get_worker_transactions', { p_token: token });
            if (error) throw error;
            let pending = 0;
            let itemsOut = 0;
            let decided = 0; // approved + declined: a new decision lights the tab badge
            for (const t of data || []) {
                if (t.approval_status === 'pending') pending += 1;
                else if (t.approval_status === 'approved' || t.approval_status === 'declined') decided += 1;
                if (t.transaction_type === 'take' && t.approval_status === 'approved') {
                    for (const m of t.materials || []) if (m.reference_number && !m.returned) itemsOut += 1;
                }
            }
            return { pending, itemsOut, decided, total: (data || []).length };
        },
    });
    return { status, ...query };
}

export function useProgressSummary() {
    const identity = useIdentity();
    const status = useModuleConnection(identity?.role, 'progress');
    const enabled = status === 'connected' && isProgressWorker();
    const query = useQuery({
        queryKey: ['hub', 'progress-summary', enabled],
        enabled,
        staleTime: STALE,
        refetchOnWindowFocus: true,
        queryFn: async () => {
            const { listMyPackages } = await import('@/modules/progress/lib/packages');
            const rows = await listMyPackages();
            let declined = 0;
            let drafts = 0;
            let waiting = 0;
            let reviewed = 0; // approved + declined: a new review lights the tab badge
            for (const p of rows) {
                if (p.approval_status === 'approved' || p.approval_status === 'declined') reviewed += 1;
                if (p.approval_status === 'declined') declined += 1;
                else if (!p.submitted_to_staff) drafts += 1;
                else if (p.approval_status === 'pending') waiting += 1;
            }
            return { declined, drafts, waiting, reviewed, total: rows.length };
        },
    });
    return { status, ...query };
}
