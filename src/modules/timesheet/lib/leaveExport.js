import { countRequestedLeaveDays, getLeaveStatusLabel, normalizeLeaveType } from '@/modules/timesheet/lib/leaveService';

/**
 * Build and download a monthly (or filtered) leave report workbook.
 */
export async function exportLeaveReportExcel(leaveRequests = [], {
    filename = 'leave-report.xlsx',
    workerNameById = {},
    siteNameById = {},
} = {}) {
    const rows = (leaveRequests || []).map((r) => {
        const days = countRequestedLeaveDays(r);
        return {
            'Employee ID': r.employee_id,
            'Employee Name': workerNameById[r.employee_id] || r.employee_name || '',
            'Leave Type': normalizeLeaveType(r.leave_type),
            Duration: r.leave_duration || 'full_day',
            'From': r.from_date,
            'To': r.to_date,
            Days: days,
            Status: getLeaveStatusLabel(r.status),
            Site: siteNameById[r.site_id] || r.site_id || '',
            'Attachment': r.attachment_path ? 'Yes' : 'No',
            'Rejection Reason': r.rejection_reason || '',
            'Admin Notes': r.admin_notes || '',
            Submitted: r.created_at ? new Date(r.created_at).toLocaleString('en-SG') : '',
            Updated: r.updated_at ? new Date(r.updated_at).toLocaleString('en-SG') : '',
        };
    });

    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Employee ID': '' }]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Leave');
    XLSX.writeFile(book, filename);
}
