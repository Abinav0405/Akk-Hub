/**
 * Local-worker HR / payroll privacy policy (product intent 2026-10):
 *
 * - Admin: full read/write of local_worker_details HR fields (NRIC, bank, pay rates,
 *   leave limits, passport, etc.) and payslip tables.
 * - Worker: may read their own leave balances / leave-form particulars (including NRIC
 *   on their own printed leave form). Must not read other workers' HR rows.
 * - Manager / supervisor: NO local-worker sensitive HR or payroll. Attendance UIs should
 *   exclude local workers entirely. Safe fields only when a lookup is unavoidable:
 *   employee_id, employee_name, in_company, designation (directory / attendance labels).
 *
 * App-layer gates here are defense in depth. Real enforcement requires Supabase RLS /
 * column grants / admin-only RPCs (see migration/PLAN.md problem #1) — Abinav owns that.
 */
import { getIdentity } from '@/core/auth/identity';

/** Columns that must never be selected or rendered for manager / supervisor. */
export const LOCAL_WORKER_HR_COLUMN_NAMES = [
    'nric_fin',
    'passport_number',
    'bank_account_number',
    'basic_salary_per_day',
    'ot_rate_per_hour',
    'sun_ph_rate_per_day',
    'monthly_allowance',
    'annual_leave_limit',
    'medical_leave_limit',
    'hospitalization_leave_limit',
    'password',
    'password_hash',
    'face_descriptor',
    'face_template',
];

/** Directory / attendance — safe for any authenticated hub role. */
export const SAFE_WORKER_DIRECTORY_COLUMNS = 'employee_id, employee_name, in_company, designation';

/** Leave approval balance fields (foreign workers on manager path; workers for self). */
export const SAFE_LEAVE_BALANCE_COLUMNS =
    'employee_id, annual_leave_balance, medical_leave_balance, hospitalization_leave_balance';

/** Leave application form without NRIC (non-admin printing other people). */
export const SAFE_LEAVE_FORM_COLUMNS = 'employee_id, employee_name, designation, date_joined';

/** Leave application form with NRIC — admin, or worker printing self only. */
export const LEAVE_FORM_COLUMNS_WITH_NRIC = `${SAFE_LEAVE_FORM_COLUMNS}, nric_fin`;

export function hubRole() {
    return getIdentity()?.role || null;
}

export function isHubAdmin() {
    return hubRole() === 'admin';
}

export function isHubManagerOrSupervisor() {
    const role = hubRole();
    return role === 'manager' || role === 'supervisor';
}

/**
 * Whether the signed-in hub user may read full worker HR (including NRIC / bank / pay).
 * @param {{ subjectEmployeeId?: string|number|null }} [opts]
 */
export function canReadWorkerHr(opts = {}) {
    const identity = getIdentity();
    if (!identity) return false;
    if (identity.role === 'admin') return true;
    if (identity.role === 'worker' && opts.subjectEmployeeId != null) {
        return String(identity.id) === String(opts.subjectEmployeeId);
    }
    return false;
}

export function assertCanReadWorkerHr(opts = {}) {
    if (!canReadWorkerHr(opts)) {
        throw new Error('Not allowed to read worker HR or payroll details');
    }
}

/** Managers/supervisors must not query local_worker_details for name maps either. */
export function mayQueryLocalWorkerDetails() {
    return !isHubManagerOrSupervisor();
}

/**
 * Leave-form SELECT list: NRIC only when admin, or when every requested id is the signed-in worker.
 * @param {Array<string|number>} employeeIds
 */
export function leaveFormSelectColumns(employeeIds = []) {
    const identity = getIdentity();
    if (!identity) return SAFE_LEAVE_FORM_COLUMNS;
    if (identity.role === 'admin') return LEAVE_FORM_COLUMNS_WITH_NRIC;
    if (identity.role === 'worker') {
        const ids = [...new Set((employeeIds || []).map((id) => String(id)).filter(Boolean))];
        if (ids.length > 0 && ids.every((id) => id === String(identity.id))) {
            return LEAVE_FORM_COLUMNS_WITH_NRIC;
        }
    }
    return SAFE_LEAVE_FORM_COLUMNS;
}

/**
 * Strip HR fields from a worker row before handing it to manager/supervisor UI.
 * @param {Record<string, unknown>|null|undefined} row
 */
export function stripWorkerHrFields(row) {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    for (const key of LOCAL_WORKER_HR_COLUMN_NAMES) {
        if (key in out) delete out[key];
    }
    return out;
}
