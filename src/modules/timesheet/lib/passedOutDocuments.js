/**
 * One original document per worker per month.
 *
 * A passed-out timesheet or payslip is never duplicated: passing out again, "recreate", or an
 * edit updates the same row. The version being replaced is archived first into
 * passed_out_timesheet_revisions / passed_out_payslip_revisions, so nothing is lost.
 * (Unique indexes from migration 20261019120000 enforce this in the database.)
 */
import { supabaseTimesheet } from '@/core/supabase'
import { storageKey } from '@/core/storage'

const adminName = () => {
    try {
        return localStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'admin';
    } catch {
        return 'admin';
    }
};

/** Approval fields reset whenever a timesheet goes back to the worker. */
const CLEARED_APPROVALS = {
    worker_approved_at: null,
    worker_declined_at: null,
    worker_decline_reason: null,
    manager_approved_at: null,
    manager_declined_at: null,
    manager_decline_reason: null,
};

// ---------------------------------------------------------------------------
// Timesheets
// ---------------------------------------------------------------------------

/** Existing passed-out timesheets for these workers in one month, keyed by worker_id. */
export async function getTimesheetsForMonth(workerIds, year, month) {
    const map = new Map();
    if (!workerIds.length) return map;
    const { data, error } = await supabaseTimesheet
        .from('passed_out_timesheets')
        .select('*')
        .in('worker_id', workerIds.map(String))
        .eq('year', year)
        .eq('month', month);
    if (error) throw error;
    (data || []).forEach((row) => map.set(String(row.worker_id), row));
    return map;
}

export async function getTimesheetForMonth(workerId, year, month) {
    const map = await getTimesheetsForMonth([String(workerId)], year, month);
    return map.get(String(workerId)) || null;
}

async function archiveTimesheet(row, reason = 'updated') {
    const { error } = await supabaseTimesheet.from('passed_out_timesheet_revisions').insert([{
        timesheet_id: row.id,
        revision: row.revision || 1,
        timesheet_html: row.timesheet_html || '',
        status: row.status,
        worker_approved_at: row.worker_approved_at,
        manager_approved_at: row.manager_approved_at,
        manager_name: row.manager_name,
        original_created_at: row.created_at,
        archived_reason: reason,
        archived_by: adminName(),
    }]);
    if (error) throw error;
}

/**
 * Replace a timesheet's content in place with freshly generated HTML and send it back to the
 * worker. The previous version is archived as a revision.
 */
export async function updateTimesheetInPlace(row, timesheetHtml) {
    await archiveTimesheet(row);
    const { error } = await supabaseTimesheet
        .from('passed_out_timesheets')
        .update({
            ...CLEARED_APPROVALS,
            timesheet_html: timesheetHtml,
            status: 'pending_worker',
            revision: (row.revision || 1) + 1,
            is_stale: false,
            stale_since: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    if (error) throw error;
}

export async function listTimesheetRevisions(timesheetId) {
    const { data, error } = await supabaseTimesheet
        .from('passed_out_timesheet_revisions')
        .select('*')
        .eq('timesheet_id', timesheetId)
        .order('archived_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

export async function getPayslipForPeriod(workerId, startDate, endDate) {
    const { data, error } = await supabaseTimesheet
        .from('passed_out_payslips')
        .select('*')
        .eq('worker_id', String(workerId))
        .eq('start_date', startDate)
        .eq('end_date', endDate)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function archivePayslip(row, reason = 'updated') {
    const { error } = await supabaseTimesheet.from('passed_out_payslip_revisions').insert([{
        payslip_id: row.id,
        revision: row.revision || 1,
        payslip_html: row.payslip_html || '',
        timesheet_html: row.timesheet_html,
        bonus: row.bonus,
        additions: row.additions,
        deductions: row.deductions,
        salary_paid_date: row.salary_paid_date,
        original_created_at: row.created_at,
        archived_reason: reason,
        archived_by: adminName(),
    }]);
    if (error) throw error;
}

/**
 * Pass out a payslip: insert it, or — if this worker already has one for the period — archive
 * the old version and update the same row. Returns the saved row.
 */
export async function savePassedOutPayslip(fields) {
    const existing = await getPayslipForPeriod(fields.worker_id, fields.start_date, fields.end_date);
    if (!existing) {
        const { data, error } = await supabaseTimesheet
            .from('passed_out_payslips')
            .insert([{ ...fields, created_by: adminName() }])
            .select()
            .single();
        if (error) throw error;
        return data;
    }
    await archivePayslip(existing);
    const { data, error } = await supabaseTimesheet
        .from('passed_out_payslips')
        .update({ ...fields, revision: (existing.revision || 1) + 1 })
        .eq('id', existing.id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

/** Archive the current version before an in-place edit (Edit payslip dialog). */
export async function archivePayslipBeforeEdit(payslipId) {
    const { data: row, error } = await supabaseTimesheet.from('passed_out_payslips').select('*').eq('id', payslipId).single();
    if (error) throw error;
    await archivePayslip(row);
    return row;
}

/**
 * The timesheet a payslip should be built on, and whether it's safe to use:
 * { timesheet, problem } where problem is null | 'missing' | 'not_approved' | 'stale'.
 */
export async function checkTimesheetForPayslip(workerId, year, month) {
    const timesheet = await getTimesheetForMonth(workerId, year, month);
    if (!timesheet) return { timesheet: null, problem: 'missing' };
    if (timesheet.is_stale) return { timesheet, problem: 'stale' };
    if (timesheet.status !== 'approved') return { timesheet, problem: 'not_approved' };
    return { timesheet, problem: null };
}

export function describeTimesheetProblem(problem) {
    switch (problem) {
        case 'missing':
            return 'no timesheet has been passed out for this month';
        case 'stale':
            return 'shifts changed after the timesheet was passed out, so it is out of date';
        case 'not_approved':
            return 'the timesheet has not been approved yet';
        default:
            return '';
    }
}
