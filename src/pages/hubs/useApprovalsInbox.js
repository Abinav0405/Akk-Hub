/**
 * "Needs your attention" — pending approvals across all three modules for managers,
 * supervisors and admins. Counts only (head requests where possible), cached for a minute,
 * refreshed on focus. Each count links to the screen where the items are handled.
 */
import { useQuery } from '@tanstack/react-query';
import { supabaseMaterials, supabaseTimesheet } from '@/core/supabase';
import { useIdentity } from '@/core/auth/identity';
import { useModuleConnection } from '@/core/auth/bridges';

const STALE = 60 * 1000;

function sgtDaysAgo(days) {
    const d = new Date(Date.now() + 8 * 3600 * 1000 - days * 86400 * 1000);
    return d.toISOString().slice(0, 10);
}

async function countPendingShifts({ siteId }) {
    let q = supabaseTimesheet
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('has_left', true)
        .is('leave_type', null)
        .or('approval_status.is.null,approval_status.eq.pending')
        .gte('work_date', sgtDaysAgo(35));
    if (siteId) q = q.eq('site_id', siteId);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
}

async function countPendingLeave(role) {
    const statuses = role === 'admin' ? ['pending', 'pending_admin'] : ['pending_manager'];
    const { count, error } = await supabaseTimesheet
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', statuses);
    if (error) throw error;
    return count || 0;
}

async function countPendingMaterials() {
    const { count, error } = await supabaseMaterials
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending');
    if (error) throw error;
    return count || 0;
}

async function countPendingPackages() {
    const { listAllPackages } = await import('@/modules/progress/lib/staffPackages');
    const rows = await listAllPackages();
    return rows.filter((p) => p.approval_status === 'pending' && p.submitted_to_staff !== false).length;
}

function useCount(key, enabled, fn) {
    return useQuery({
        queryKey: ['hub', 'inbox', ...key],
        enabled,
        staleTime: STALE,
        refetchOnWindowFocus: true,
        retry: 0,
        queryFn: fn,
    });
}

export function useApprovalsInbox() {
    const identity = useIdentity();
    const role = identity?.role;
    const staff = role === 'manager' || role === 'admin';
    const materials = useModuleConnection(role, 'materials');
    const progress = useModuleConnection(role, 'progress');

    const shifts = useCount(['shifts', role, identity?.siteId], !!role && role !== 'worker', () =>
        countPendingShifts({ siteId: role === 'supervisor' ? identity.siteId : null }),
    );
    const leave = useCount(['leave', role], staff, () => countPendingLeave(role));
    const requests = useCount(['materials', role], staff && materials === 'connected', countPendingMaterials);
    const packages = useCount(['packages', role], staff && progress === 'connected', countPendingPackages);

    return { role, shifts, leave, requests, packages, materials, progress };
}
