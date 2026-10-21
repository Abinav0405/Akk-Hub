import { supabaseTimesheet } from '@/core/supabase'
import { countLeaveDaysForDisplay, formatDate, parseDateOnly } from '@/modules/timesheet/lib/timeUtils';
import { printOrShareHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { getLeaveAttachmentSignedUrl } from '@/modules/timesheet/lib/leaveService';
import {
    isHubManagerOrSupervisor,
    leaveFormSelectColumns,
    mayQueryLocalWorkerDetails,
} from '@/modules/timesheet/lib/workerPrivacy';

function esc(value) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function leaveDurationLabel(duration) {
    if (duration === 'half_day_morning') return 'Half day (morning)';
    if (duration === 'half_day_afternoon') return 'Half day (afternoon)';
    return 'Full day';
}

/** Leave period overlaps [rangeFrom, rangeTo] (inclusive, YYYY-MM-DD). */
export function filterLeavesByDateRange(requests, rangeFrom, rangeTo) {
    if (!rangeFrom && !rangeTo) return requests || [];
    const from = rangeFrom ? parseDateOnly(rangeFrom) : null;
    const to = rangeTo ? parseDateOnly(rangeTo) : null;
    return (requests || []).filter((r) => {
        const leaveStart = parseDateOnly(r.from_date);
        const leaveEnd = parseDateOnly(r.to_date);
        if (!leaveStart || !leaveEnd) return false;
        if (from && leaveEnd < from) return false;
        if (to && leaveStart > to) return false;
        return true;
    });
}

export async function fetchWorkerProfilesForLeave(employeeIds) {
    const ids = [...new Set((employeeIds || []).filter(Boolean))];
    const map = new Map();
    if (!ids.length) return map;

    // Managers/supervisors must not pull leave-form PII (esp. local-worker NRIC).
    if (isHubManagerOrSupervisor()) {
        throw new Error('Leave form worker particulars are admin or employee only');
    }

    const columns = leaveFormSelectColumns(ids);
    const foreignPromise = supabaseTimesheet
        .from('worker_details')
        .select(columns)
        .in('employee_id', ids);
    const localPromise = mayQueryLocalWorkerDetails()
        ? supabaseTimesheet.from('local_worker_details').select(columns).in('employee_id', ids)
        : Promise.resolve({ data: [], error: null });

    const [foreignRes, localRes] = await Promise.all([foreignPromise, localPromise]);

    for (const w of foreignRes.data || []) {
        map.set(String(w.employee_id), { ...w, worker_category: 'Foreign worker' });
    }
    for (const w of localRes.data || []) {
        const key = String(w.employee_id);
        if (!map.has(key)) {
            map.set(key, { ...w, worker_category: 'Local worker' });
        }
    }
    return map;
}

function buildSingleFormHtml(request, worker, logoSrc, attachmentNote = '') {
    const days = countLeaveDaysForDisplay({
        from_date: request.from_date,
        to_date: request.to_date,
        leave_type: request.leave_type,
        leave_duration: request.leave_duration,
        days_requested: request.days_requested,
    });

    const submitted = request.created_at
        ? new Date(request.created_at).toLocaleDateString('en-SG', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
          })
        : '—';

    return `
    <section class="leave-form page-break">
      <header class="form-header">
        ${logoSrc ? `<img src="${esc(logoSrc)}" alt="Company logo" class="logo" />` : ''}
        <div class="header-text">
          <h1>Leave application form</h1>
          <p class="company">AKK ENGINEERING PTE. LTD.</p>
          <p class="address">15 Kaki Bukit Rd 4, #01-50, Singapore 417808</p>
        </div>
      </header>

      <h2 class="section-title">Employee particulars</h2>
      <table class="info-table">
        <tr><th>Employee name</th><td>${esc(worker?.employee_name || request.employee_name)}</td></tr>
        <tr><th>Employee ID</th><td>${esc(request.employee_id)}</td></tr>
        <tr><th>NRIC / FIN</th><td>${esc(worker?.nric_fin)}</td></tr>
        <tr><th>Designation</th><td>${esc(worker?.designation)}</td></tr>
        <tr><th>Worker type</th><td>${esc(worker?.worker_category)}</td></tr>
        <tr><th>Date joined</th><td>${worker?.date_joined ? esc(formatDate(worker.date_joined)) : '—'}</td></tr>
      </table>

      <h2 class="section-title">Leave application</h2>
      <table class="info-table">
        <tr><th>Application date</th><td>${esc(submitted)}</td></tr>
        <tr><th>Status</th><td>${esc((request.status || 'pending').toUpperCase())}</td></tr>
        <tr><th>Leave type</th><td>${esc(request.leave_type)}</td></tr>
        <tr><th>Duration</th><td>${esc(leaveDurationLabel(request.leave_duration))}</td></tr>
        <tr><th>Leave from</th><td>${esc(formatDate(request.from_date))}</td></tr>
        <tr><th>Leave to</th><td>${esc(formatDate(request.to_date))}</td></tr>
        <tr><th>Total leave days</th><td><strong>${esc(days)} day(s)</strong> <span class="hint">(excludes Sundays for paid leave)</span></td></tr>
        <tr><th>Reason</th><td class="multiline">${esc(request.reason || '—')}</td></tr>
        ${request.admin_notes ? `<tr><th>Admin / HR notes</th><td class="multiline">${esc(request.admin_notes)}</td></tr>` : ''}
        ${request.edited_by ? `<tr><th>Last edited by</th><td>${esc(request.edited_by)}${request.edited_at ? ` · ${esc(formatDate(request.edited_at))}` : ''}</td></tr>` : ''}
        ${attachmentNote ? `<tr><th>Attachment</th><td>${esc(attachmentNote)}</td></tr>` : ''}
      </table>

      <div class="signatures">
        <div class="sig-block">
          <p class="sig-line"></p>
          <p>Employee signature</p>
          <p class="sig-date">Date: _______________</p>
        </div>
        <div class="sig-block">
          <p class="sig-line"></p>
          <p>HR / Management</p>
          <p class="sig-date">Date: _______________</p>
        </div>
      </div>
    </section>`;
}

export function buildLeaveFormsPrintHtml({ requests, workerMap, logoUrl, rangeLabel, attachmentNotes = {} }) {
    const logoSrc = logoUrl?.startsWith('http')
        ? logoUrl
        : logoUrl
          ? new URL(logoUrl, typeof window !== 'undefined' ? window.location.origin : '').href
          : '';

    const forms = (requests || [])
        .map((r) => buildSingleFormHtml(
            r,
            workerMap.get(String(r.employee_id)),
            logoSrc,
            attachmentNotes[r.id] || (r.attachment_path ? 'On file (see digital record)' : '')
        ))
        .join('');

    const title = rangeLabel
        ? `Leave forms — ${rangeLabel}`
        : requests?.length === 1
          ? `Leave form — ${requests[0].employee_name || requests[0].employee_id}`
          : `Leave forms (${requests?.length || 0})`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      margin: 0;
      padding: 16px;
      color: #0f172a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .cover {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #334155;
    }
    .cover h1 { margin: 0 0 8px; font-size: 1.25rem; }
    .cover p { margin: 4px 0; color: #64748b; font-size: 0.9rem; }
    .leave-form {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .form-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #475569;
    }
    .logo { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
    .header-text h1 { margin: 0 0 4px; font-size: 1.2rem; }
    .company { margin: 0; font-weight: 700; font-size: 0.95rem; }
    .address { margin: 2px 0 0; font-size: 0.8rem; color: #64748b; }
    .section-title {
      margin: 16px 0 8px;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      margin-bottom: 12px;
    }
    .info-table th,
    .info-table td {
      border: 1px solid #e2e8f0;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .info-table th {
      width: 32%;
      background: #f8fafc;
      font-weight: 600;
      color: #334155;
    }
    .multiline { white-space: pre-wrap; }
    .hint { font-size: 0.75rem; color: #64748b; font-weight: normal; }
    .signatures {
      display: flex;
      gap: 24px;
      margin-top: 28px;
      padding-top: 12px;
    }
    .sig-block { flex: 1; text-align: center; font-size: 0.8rem; color: #334155; }
    .sig-line {
      border-bottom: 1px solid #334155;
      height: 36px;
      margin: 0 0 8px;
    }
    .sig-date { margin-top: 8px; color: #64748b; }
    @media print {
      body { padding: 0; }
      .leave-form { page-break-after: always; }
      .leave-form:last-child { page-break-after: auto; }
    }
  </style>
</head>
<body>
  ${rangeLabel ? `<div class="cover"><h1>Leave application forms</h1><p>Period: ${esc(rangeLabel)}</p><p>${requests.length} form(s)</p></div>` : ''}
  ${forms}
</body>
</html>`;
}

export async function openLeaveFormsPrint(html, options = {}) {
    const { fileName } = options;
    try {
        return await printOrShareHtmlDocument(html, {
            title: 'Print leave forms',
            fileName: fileName || `Leave_Forms_${Date.now()}.pdf`,
            printDelayMs: 350,
        });
    } catch (error) {
        throw new Error(error?.message || 'Print could not be prepared in this browser');
    }
}

export async function printLeaveForms({ requests, logoUrl, rangeLabel }) {
    if (!requests?.length) {
        throw new Error('No leave requests to print');
    }
    const workerMap = await fetchWorkerProfilesForLeave(requests.map((r) => r.employee_id));
    const attachmentNotes = {};
    for (const request of requests) {
        if (!request.attachment_path) continue;
        const signedUrl = await getLeaveAttachmentSignedUrl(supabaseTimesheet, request.attachment_path, 3600);
        attachmentNotes[request.id] = signedUrl
            ? `Attached — open in app: ${signedUrl}`
            : `File on record: ${request.attachment_path}`;
    }
    const html = buildLeaveFormsPrintHtml({ requests, workerMap, logoUrl, rangeLabel, attachmentNotes });
    return openLeaveFormsPrint(html, {
        fileName: rangeLabel
            ? `Leave_Forms_${String(rangeLabel).replace(/[^\w-]+/g, '_').slice(0, 40)}.pdf`
            : `Leave_Forms_${Date.now()}.pdf`,
    });
}
