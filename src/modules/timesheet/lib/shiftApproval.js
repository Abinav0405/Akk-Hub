/** Daily shift approval — completed shifts must be approved before payroll/timesheets. */
import { storageKey } from '@/core/storage';

export const SHIFT_APPROVAL = {
    PENDING: 'pending',
    APPROVED: 'approved',
    DECLINED: 'declined',
};

const k = (key) => storageKey('timesheet', key);

function pickFirstNonEmpty(...values) {
    for (const value of values) {
        if (value == null) continue;
        const trimmed = String(value).trim();
        if (trimmed && trimmed !== 'null' && trimmed !== 'undefined') {
            return trimmed;
        }
    }
    return null;
}

function emailDisplayName(email) {
    if (!email || typeof email !== 'string') return null;
    const localPart = email.split('@')[0]?.trim();
    if (!localPart) return null;
    return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function readStorage(localKey, sessionKey) {
    try {
        return pickFirstNonEmpty(
            localStorage.getItem(localKey),
            sessionStorage.getItem(localKey),
            sessionStorage.getItem(sessionKey),
            localStorage.getItem(sessionKey),
        );
    } catch {
        return null;
    }
}

/** Real display name for admin / manager / supervisor (approval + edit labels). */
export function getShiftActorName(role) {
    try {
        if (role === 'admin') {
            return (
                readStorage(k('adminName'), k('adminName')) ||
                emailDisplayName(readStorage(k('adminEmail'), k('adminEmail'))) ||
                null
            );
        }
        if (role === 'supervisor') {
            return (
                readStorage(k('supervisorName'), k('supervisorName')) ||
                readStorage(k('supervisorId'), k('supervisorId')) ||
                null
            );
        }
        return (
            readStorage(k('managerName'), k('managerName')) ||
            emailDisplayName(readStorage(k('managerEmail'), k('managerEmail'))) ||
            null
        );
    } catch {
        return null;
    }
}

export function getShiftApproverName(role) {
    return getShiftActorName(role);
}

export function getShiftEditorName(role) {
    return getShiftActorName(role);
}

/** Resolve who approved — use explicit name, role storage, then edit label from same save. */
export function resolveShiftApproverName(role, { actorName, editedBy } = {}) {
    return pickFirstNonEmpty(
        actorName,
        role ? getShiftActorName(role) : null,
        editedBy,
    );
}

/** Treat completed shifts with no status as pending (needs approval). */
export function getShiftApprovalStatus(shift) {
    if (!shift?.has_left) return shift?.approval_status ?? null;
    if (shift.approval_status == null || String(shift.approval_status).trim() === '') {
        return SHIFT_APPROVAL.PENDING;
    }
    return shift.approval_status;
}

export function isShiftApproved(shift) {
    if (!shift?.has_left) return false;
    return getShiftApprovalStatus(shift) === SHIFT_APPROVAL.APPROVED;
}

/** Completed shift still needs manager/admin/supervisor action. */
export function shiftNeedsApprovalActions(shift) {
    return !!shift?.has_left && getShiftApprovalStatus(shift) !== SHIFT_APPROVAL.APPROVED;
}

export function isShiftDeclined(shift) {
    return getShiftApprovalStatus(shift) === SHIFT_APPROVAL.DECLINED;
}

export function isShiftPendingApproval(shift) {
    return !!shift?.has_left && getShiftApprovalStatus(shift) === SHIFT_APPROVAL.PENDING;
}

/** Only approved completed shifts count toward payslip / timesheet totals. */
export function isShiftApprovedForPayroll(shift) {
    if (!shift?.has_left) return false;
    // Leave rows created from an approved leave request are already authorized for payroll.
    // Older rows may lack approval_status; still include them so timesheets/payslips stay correct.
    if (shift.leave_type != null && String(shift.leave_type).trim() !== '') {
        return getShiftApprovalStatus(shift) !== SHIFT_APPROVAL.DECLINED;
    }
    return getShiftApprovalStatus(shift) === SHIFT_APPROVAL.APPROVED;
}

function isApprovalMigrationError(error) {
    const msg = error?.message || '';
    return /approval_status|approved_by|approved_at/i.test(msg);
}

function formatShiftWriteError(error, action) {
    if (isApprovalMigrationError(error)) {
        return 'Approval columns are missing in Supabase. Run SQL files/active/migration_shift_daily_approval.sql in the SQL Editor, then try again.';
    }
    return error?.message || `Failed to ${action} shift`;
}

export async function approveShiftRecord(supabase, shiftId, approverName) {
    const fields = approveFields(approverName);

    const { data, error } = await supabase
        .from('shifts')
        .update(fields)
        .eq('id', shiftId)
        .select('id, approval_status, approved_by, approved_at')
        .maybeSingle();

    if (error) throw new Error(formatShiftWriteError(error, 'approve'));
    if (!data) {
        throw new Error(
            'Shift not found or update was blocked. Confirm migration_shift_daily_approval.sql has been run and Supabase RLS allows updates on shifts.'
        );
    }
    return data;
}

export async function declineShiftRecord(supabase, shiftId) {
    const { data, error } = await supabase
        .from('shifts')
        .update(declineFields())
        .eq('id', shiftId)
        .select('id, approval_status')
        .maybeSingle();

    if (error) throw new Error(formatShiftWriteError(error, 'decline'));
    if (!data) {
        throw new Error(
            'Shift not found or update was blocked. Confirm migration_shift_daily_approval.sql has been run and Supabase RLS allows updates on shifts.'
        );
    }
    return data;
}

export function filterShiftsForPayroll(shifts) {
    return (shifts || []).filter(isShiftApprovedForPayroll);
}

export function pendingOnCompleteFields() {
    return {
        approval_status: SHIFT_APPROVAL.PENDING,
        approved_by: null,
        approved_at: null,
    };
}

export function approveFields(approverName) {
    const name = pickFirstNonEmpty(approverName);
    return {
        approval_status: SHIFT_APPROVAL.APPROVED,
        approved_by: name,
        approved_at: new Date().toISOString(),
    };
}

export function declineFields() {
    return {
        approval_status: SHIFT_APPROVAL.DECLINED,
        approved_by: null,
        approved_at: null,
    };
}

/**
 * Merge approval fields when saving a shift from the edit dialog.
 */
export function applyApprovalOnShiftSave({
    shiftUpdateData,
    editingShift,
    isCompleted,
    approveAfterSave,
    actorName,
    role,
}) {
    if (!isCompleted) {
        return shiftUpdateData;
    }
    if (getShiftApprovalStatus(editingShift) === SHIFT_APPROVAL.APPROVED) {
        return shiftUpdateData;
    }
    if (approveAfterSave) {
        const approver = resolveShiftApproverName(role, {
            actorName,
            editedBy: shiftUpdateData?.edited_by,
        });
        const approvalFields = approveFields(approver);
        return {
            ...shiftUpdateData,
            ...approvalFields,
            approved_by: approvalFields.approved_by || shiftUpdateData?.edited_by || null,
        };
    }
    if (getShiftApprovalStatus(editingShift) === SHIFT_APPROVAL.DECLINED) {
        return shiftUpdateData;
    }
    return { ...shiftUpdateData, ...pendingOnCompleteFields() };
}

/** Status filter: completed but not approved (pending or declined). */
export function matchesUnapprovedFilter(shift) {
    return shiftNeedsApprovalActions(shift);
}
