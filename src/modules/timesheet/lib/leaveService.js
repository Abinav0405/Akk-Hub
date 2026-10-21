import { UNIFIED } from '@/core/supabase';
import { getIdentity } from '@/core/auth/identity';
import { fetchMyWorkerRecord } from '@/core/localWorkers';
import {
    addDaysToYmd,
    isPublicHoliday,
    isSunday,
    toSingaporeDateStr,
} from '@/modules/timesheet/lib/timeUtils';
import { approveFields } from '@/modules/timesheet/lib/shiftApproval';
import {
    SAFE_WORKER_DIRECTORY_COLUMNS,
    isHubAdmin,
    mayQueryLocalWorkerDetails,
} from '@/modules/timesheet/lib/workerPrivacy';

export const PAID_LEAVE_TYPES = [
    'Annual Leave',
    'Maternity Leave',
    'Paternity Leave',
    'Shared Parental Leave',
    'Childcare Leave',
    'Medical Leave',
    'Hospitalization Leave',
    'National Service (NS) Leave',
    'Adoption Leave',
    'Non-Statutory Leave (Employer Provided)',
    'Compassionate / Bereavement Leave',
    'Marriage Leave',
    'Study / Exam Leave',
    'Birthday Leave',
    'Mental Health Day',
    'Volunteer Leave',
];

export const UNPAID_LEAVE_TYPES = ['Unpaid Leave', 'Unpaid Infant Care Leave'];
export const BALANCE_TRACKED_LEAVE_TYPES = ['Annual Leave', 'Medical Leave', 'Hospitalization Leave'];

const LEAVE_TYPE_ALIASES = {
    'Sick Leave & Hospitalisation Leave': 'Medical Leave',
    'Sick Leave & Hospitalization Leave': 'Medical Leave',
    AL: 'Annual Leave',
    MC: 'Medical Leave',
};

const PENDING_BALANCE_STATUSES = ['pending', 'pending_manager', 'pending_admin'];

export const INACTIVE_LEAVE_STATUSES = ['rejected', 'cancelled'];

/** Statuses that block overlapping leave (explicit list — reliable in PostgREST). */
export const ACTIVE_LEAVE_STATUSES = [
    'pending',
    'pending_manager',
    'pending_admin',
    'approved',
];

export function normalizeLeaveType(leaveType) {
    return LEAVE_TYPE_ALIASES[leaveType] || leaveType;
}

export function isPaidLeaveType(leaveType) {
    return PAID_LEAVE_TYPES.includes(normalizeLeaveType(leaveType));
}

export function isUnpaidLeaveType(leaveType) {
    return UNPAID_LEAVE_TYPES.includes(normalizeLeaveType(leaveType));
}

export function getBalanceFieldForLeaveType(leaveType) {
    const normalized = normalizeLeaveType(leaveType);
    if (normalized === 'Annual Leave') return 'annual_leave_balance';
    if (normalized === 'Medical Leave') return 'medical_leave_balance';
    if (normalized === 'Hospitalization Leave') return 'hospitalization_leave_balance';
    return null;
}

export function getLimitFieldForLeaveType(leaveType) {
    const normalized = normalizeLeaveType(leaveType);
    if (normalized === 'Annual Leave') return 'annual_leave_limit';
    if (normalized === 'Medical Leave') return 'medical_leave_limit';
    if (normalized === 'Hospitalization Leave') return 'hospitalization_leave_limit';
    return null;
}

export function workerTypeFromTable(table) {
    return table === 'local_worker_details' ? 'local' : 'foreign';
}

/** True for half-day leave by duration flag or leave_type suffix (e.g. Annual Leave_HALF_MORNING). */
export function isHalfDayLeave({ leave_duration, leave_type } = {}) {
    if (leave_duration?.includes('half_day')) return true;
    return String(leave_type || '').includes('_HALF_');
}

/**
 * Atomically adjust leave balance via SECURITY DEFINER RPC.
 * Negative deltas that would drive balance below zero are rejected.
 */
export async function adjustLeaveBalance(supabase, {
    employeeId,
    workerType,
    fieldName,
    delta,
}) {
    const amount = Number(delta) || 0;
    if (!fieldName || amount === 0) return null;

    const { data, error } = await supabase.rpc('adjust_leave_balance', {
        p_employee_id: employeeId,
        p_worker_type: workerType,
        p_field_name: fieldName,
        p_delta: amount,
    });
    if (error) {
        const message = error.message || String(error);
        if (message.includes('insufficient_leave_balance')) {
            throw new Error('Insufficient leave balance for this approval. Please refresh and try again.');
        }
        throw error;
    }
    return Number(data);
}

export async function resolveWorkerWithTable(
    supabase,
    employeeId,
    selectColumns = SAFE_WORKER_DIRECTORY_COLUMNS,
) {
    // Default and non-admin '*' resolve to directory-safe columns (no NRIC/bank/pay).
    // Admins may still pass '*' for HR workflows.
    let columns = selectColumns || SAFE_WORKER_DIRECTORY_COLUMNS;
    if (columns === '*' && !isHubAdmin()) {
        columns = SAFE_WORKER_DIRECTORY_COLUMNS;
    }

    // One backend: the signed-in worker reads their OWN record through a server function (the local
    // HR table is admin-only). Anyone else keeps the normal lookups below.
    if (UNIFIED && getIdentity()?.role === 'worker' && String(getIdentity()?.id) === String(employeeId)) {
        const mine = await fetchMyWorkerRecord();
        if (mine) return { worker: mine, table: mine.worker_type === 'local' ? 'local_worker_details' : 'worker_details' };
    }

    const foreignResult = await supabase
        .from('worker_details')
        .select(columns)
        .eq('employee_id', employeeId)
        .maybeSingle();

    if (!foreignResult.error && foreignResult.data) {
        return { worker: foreignResult.data, table: 'worker_details' };
    }

    // Managers/supervisors must not read local_worker_details (even id-only lookups).
    if (!mayQueryLocalWorkerDetails()) {
        throw foreignResult.error || new Error(`Worker ${employeeId} not found`);
    }

    const localResult = await supabase
        .from('local_worker_details')
        .select(columns)
        .eq('employee_id', employeeId)
        .maybeSingle();

    if (!localResult.error && localResult.data) {
        return { worker: localResult.data, table: 'local_worker_details' };
    }

    throw foreignResult.error || localResult.error || new Error(`Worker ${employeeId} not found`);
}

export async function fetchWorkerDirectoryMap(supabase, employeeIds, columns = 'employee_id, employee_name, in_company') {
    const ids = [...new Set((employeeIds || []).filter(Boolean))];
    const map = new Map();
    if (!ids.length) return map;

    const foreignRes = await supabase.from('worker_details').select(columns).in('employee_id', ids);
    for (const worker of foreignRes.data || []) {
        map.set(worker.employee_id, worker);
    }

    if (mayQueryLocalWorkerDetails()) {
        const localRes = await supabase.from('local_worker_details').select(columns).in('employee_id', ids);
        for (const worker of localRes.data || []) {
            if (!map.has(worker.employee_id)) map.set(worker.employee_id, worker);
        }
    }

    return map;
}

/** Longest leave span the app will expand into days (guards against typos like year 20261). */
export const MAX_LEAVE_SPAN_DAYS = 366;

/** Strict YYYY-MM-DD that is also a real calendar date (rejects 5-digit years, 2026-02-30, ...). */
function isRealYmd(ymd) {
    if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    const [y, m, d] = ymd.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Inclusive list of Dates for the range. Each Date is pinned to 12:00 Singapore time so
 * toSingaporeDateStr()/isSunday()/isPublicHoliday() resolve to the right calendar day
 * regardless of the device's own timezone.
 */
export function buildLeaveDateRange(fromDateInput, toDateInput) {
    const fromYmd = toSingaporeDateStr(fromDateInput);
    const toYmd = toSingaporeDateStr(toDateInput);
    if (!isRealYmd(fromYmd) || !isRealYmd(toYmd) || toYmd < fromYmd) return [];

    const dates = [];
    for (
        let ymd = fromYmd;
        ymd && ymd <= toYmd && dates.length <= MAX_LEAVE_SPAN_DAYS * 2;
        ymd = addDaysToYmd(ymd, 1)
    ) {
        dates.push(new Date(`${ymd}T12:00:00+08:00`));
    }
    return dates;
}

export function getChargeableLeaveDates({ from_date, to_date, leave_type, leave_duration }) {
    const normalizedType = normalizeLeaveType(leave_type);
    const allDates = buildLeaveDateRange(from_date, to_date);
    const chargeable = isPaidLeaveType(normalizedType)
        ? allDates.filter((d) => !(isSunday(d) || isPublicHoliday(d)))
        : allDates;

    if (leave_duration?.includes('half_day')) {
        return chargeable.slice(0, 1);
    }
    return chargeable;
}

/** Day count aligned with getChargeableLeaveDates (half-day → 0.5 × first chargeable date).
 *  Selected from/to dates are the source of truth. A stored days_requested value is only a
 *  fallback when dates are missing, and is never allowed to exceed the date-range count.
 */
export function countRequestedLeaveDays({ from_date, to_date, leave_type, leave_duration, days_requested }) {
    const chargeable = getChargeableLeaveDates({
        from_date,
        to_date,
        leave_type,
        leave_duration,
    });
    const rangeCount = leave_duration?.includes('half_day')
        ? 0.5 * chargeable.length
        : chargeable.length;

    const stored =
        days_requested != null && days_requested !== '' ? Number(days_requested) : NaN;
    if (Number.isFinite(stored) && stored > 0) {
        // Never let a stale/inflated days_requested outgrow the selected date span.
        if (rangeCount > 0) return Math.min(stored, rangeCount);
        return stored;
    }

    return rangeCount;
}

/**
 * Returns all ACTIVE (not rejected/cancelled) leave requests for the employee
 * whose date range overlaps [fromDate, toDate] inclusive. Covers legacy
 * 'pending' as well as 'pending_manager', 'pending_admin' and 'approved'.
 */
export async function findOverlappingLeaveRequests({
    supabase,
    employeeId,
    fromDate,
    toDate,
    excludingLeaveId = null,
    statuses = null,
}) {
    let query = supabase
        .from('leave_requests')
        .select('id, status, from_date, to_date, leave_type')
        .eq('employee_id', employeeId)
        .lte('from_date', toDate)
        .gte('to_date', fromDate);

    if (statuses) {
        query = query.in('status', statuses);
    } else {
        query = query.in('status', ACTIVE_LEAVE_STATUSES);
    }

    if (excludingLeaveId) query = query.neq('id', excludingLeaveId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

export async function hasOverlappingLeaveRequest(params) {
    const overlapping = await findOverlappingLeaveRequests(params);
    return overlapping.length > 0;
}

export async function sumPendingReservedDays({
    supabase,
    employeeId,
    leaveType,
    excludingLeaveId = null,
}) {
    const normalized = normalizeLeaveType(leaveType);
    const { data, error } = await supabase
        .from('leave_requests')
        .select('id, leave_type, leave_duration, from_date, to_date, days_requested, status')
        .eq('employee_id', employeeId)
        .in('status', PENDING_BALANCE_STATUSES);

    if (error) throw error;

    return (data || [])
        .filter((row) => {
            if (excludingLeaveId && row.id === excludingLeaveId) return false;
            return getBalanceFieldForLeaveType(row.leave_type) === getBalanceFieldForLeaveType(normalized);
        })
        .reduce((sum, row) => sum + countRequestedLeaveDays(row), 0);
}

export function computePaidUnpaidSplit({
    leaveType,
    requestedDays,
    availableBalance,
}) {
    const balanceField = getBalanceFieldForLeaveType(leaveType);
    if (!balanceField) {
        return { paidDays: requestedDays, unpaidDays: 0 };
    }

    const safeBalance = Math.max(0, Number(availableBalance) || 0);
    if (requestedDays <= safeBalance) {
        return { paidDays: requestedDays, unpaidDays: 0 };
    }

    return {
        paidDays: safeBalance,
        unpaidDays: Math.max(0, requestedDays - safeBalance),
    };
}

export function buildLeaveShiftRecords({
    employeeId,
    leaveType,
    leaveDuration,
    allDates,
    paidDateKeys = new Set(),
}) {
    const normalizedType = normalizeLeaveType(leaveType);
    const isPaid = isPaidLeaveType(normalizedType);

    return allDates.map((dateObj) => {
        const dateKey = toSingaporeDateStr(dateObj);
        const paidForDay = isPaid && paidDateKeys.has(dateKey);
        const isHalfMorning = leaveDuration === 'half_day_morning';
        const isHalfAfternoon = leaveDuration === 'half_day_afternoon';

        let entry_time = `${dateKey}T00:00:00`;
        let leave_time = `${dateKey}T08:00:00`;
        let worked_hours = paidForDay ? 8 : 0;
        let leave_type = normalizedType;

        if (isHalfMorning) {
            entry_time = `${dateKey}T00:00:00`;
            leave_time = `${dateKey}T12:00:00`;
            worked_hours = paidForDay ? 4 : 0;
            leave_type = `${normalizedType}_HALF_MORNING`;
        } else if (isHalfAfternoon) {
            entry_time = `${dateKey}T12:00:00`;
            leave_time = `${dateKey}T16:00:00`;
            worked_hours = paidForDay ? 4 : 0;
            leave_type = `${normalizedType}_HALF_AFTERNOON`;
        }

        return {
            worker_id: employeeId,
            work_date: dateKey,
            entry_time,
            leave_time,
            has_left: true,
            worked_hours,
            sunday_hours: 0,
            ot_hours: 0,
            leave_type,
            site_id: null,
            // Leave shifts are created only after leave approval — auto-approve for payroll.
            ...approveFields('Leave approval'),
        };
    });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Latest real site (uuid) the worker clocked in at. shifts.site_id is text and can hold
 * non-site values such as "office", but leave_requests.site_id is a uuid column — passing
 * "office" through made leave submission fail with "invalid input syntax for type uuid".
 */
export async function getLatestWorkerSiteId(supabase, employeeId) {
    const { data, error } = await supabase
        .from('shifts')
        .select('site_id')
        .eq('worker_id', employeeId)
        .not('site_id', 'is', null)
        .order('work_date', { ascending: false })
        .limit(20);
    if (error) return null;
    const match = (data || []).find((row) => UUID_RE.test(String(row.site_id)));
    return match ? match.site_id : null;
}

export function dateKeyFromDateObj(dateObj) {
    return toSingaporeDateStr(dateObj);
}

export function getLeaveStatusLabel(status) {
    const labels = {
        pending: 'Pending',
        pending_manager: 'Awaiting manager',
        pending_admin: 'Awaiting admin',
        approved: 'Approved',
        rejected: 'Rejected',
        cancelled: 'Cancelled',
    };
    return labels[status] || String(status || '').replace(/_/g, ' ');
}

// The `leave-attachments` bucket accepts only these types, up to 10 MB.
export const LEAVE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const LEAVE_ATTACHMENT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const LEAVE_ATTACHMENT_EXT_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
    heic: 'image/heic',
    heif: 'image/heif',
};

function resolveAttachmentMime(file) {
    const declared = String(file?.type || '').toLowerCase();
    if (declared) return declared;
    const ext = String(file?.name || '').split('.').pop()?.toLowerCase();
    return LEAVE_ATTACHMENT_EXT_TYPES[ext] || '';
}

async function recompressImageToJpeg(file, { maxSide = 2000, quality = 0.85 } = {}) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('image_decode_failed'));
            el.src = url;
        });
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('image_encode_failed');
        const baseName = String(file.name || 'attachment').replace(/\.[^.]+$/, '');
        return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Validate (and, for big or unsupported photos, shrink) an MC/supporting document before upload,
 * so workers get a clear message instead of a raw storage error after tapping Submit.
 */
export async function prepareLeaveAttachment(file) {
    if (!file) return null;
    const mime = resolveAttachmentMime(file);
    const isImage = mime.startsWith('image/');
    if (mime !== 'application/pdf' && !isImage) {
        throw new Error('Attachment must be a PDF or a photo (JPG, PNG or WEBP).');
    }

    let prepared = file;
    const supported = LEAVE_ATTACHMENT_ALLOWED_TYPES.includes(mime);
    if (isImage && (!supported || file.size > 3 * 1024 * 1024) && typeof document !== 'undefined') {
        try {
            const shrunk = await recompressImageToJpeg(file);
            if (!supported || shrunk.size < file.size) prepared = shrunk;
        } catch {
            if (!supported) {
                throw new Error('This photo format is not supported. Please use a JPG/PNG photo or a PDF.');
            }
        }
    } else if (!supported) {
        throw new Error('Attachment must be a PDF or a photo (JPG, PNG or WEBP).');
    }

    if (prepared.size > LEAVE_ATTACHMENT_MAX_BYTES) {
        throw new Error('Attachment is larger than 10 MB. Please choose a smaller file or photo.');
    }
    return prepared;
}

export async function getLeaveAttachmentSignedUrl(supabase, attachmentPath, expiresIn = 3600) {
    if (!attachmentPath) return null;
    const { data, error } = await supabase.storage
        .from('leave-attachments')
        .createSignedUrl(attachmentPath, expiresIn);
    if (error) return null;
    return data?.signedUrl || null;
}

export async function deleteLeaveShiftsInRange(supabase, employeeId, fromDate, toDate) {
    const { error } = await supabase
        .from('shifts')
        .delete()
        .eq('worker_id', employeeId)
        .gte('work_date', fromDate)
        .lte('work_date', toDate)
        .not('leave_type', 'is', null);
    if (error) throw error;
}

export async function restoreApprovedLeaveBalance(supabase, leaveRequest) {
    const normalizedLeaveType = normalizeLeaveType(leaveRequest.leave_type);
    const balanceField = getBalanceFieldForLeaveType(normalizedLeaveType);
    if (!balanceField) return 0;

    const normalizedPrefix = `${normalizedLeaveType}%`;
    const { data: paidShiftRows, error: paidShiftError } = await supabase
        .from('shifts')
        .select('worked_hours')
        .eq('worker_id', leaveRequest.employee_id)
        .gte('work_date', leaveRequest.from_date)
        .lte('work_date', leaveRequest.to_date)
        .ilike('leave_type', normalizedPrefix);
    if (paidShiftError) throw paidShiftError;

    const paidDaysToRestore = (paidShiftRows || []).reduce(
        (sum, row) => sum + (Number(row.worked_hours || 0) / 8),
        0
    );

    if (paidDaysToRestore > 0) {
        const resolved = await resolveWorkerWithTable(
            supabase,
            leaveRequest.employee_id,
            'employee_id'
        );
        await adjustLeaveBalance(supabase, {
            employeeId: leaveRequest.employee_id,
            workerType: workerTypeFromTable(resolved.table),
            fieldName: balanceField,
            delta: paidDaysToRestore,
        });
    }

    return paidDaysToRestore;
}

function buildPaidDateKeys(datesForShifts, paidDays, leaveDuration) {
    const paidDateKeys = new Set();
    if (leaveDuration?.includes('half_day')) {
        if (paidDays >= 0.5 && datesForShifts[0]) {
            paidDateKeys.add(dateKeyFromDateObj(datesForShifts[0]));
        }
    } else {
        let remaining = paidDays;
        for (const dateObj of datesForShifts) {
            const dateKey = dateKeyFromDateObj(dateObj);
            if (remaining >= 1) {
                paidDateKeys.add(dateKey);
                remaining -= 1;
            }
        }
    }
    return paidDateKeys;
}

/** Approve leave: shifts, balance deduction, paid/unpaid split.
 *  Selected from_date → to_date is the hard boundary — balance never extends leave past to_date.
 */
export async function processLeaveApprovalEffects(supabase, leaveRequest) {
    const normalizedLeaveType = normalizeLeaveType(leaveRequest.leave_type);
    const leaveDuration = leaveRequest.leave_duration;
    const employeeId = leaveRequest.employee_id;

    const allDates = buildLeaveDateRange(leaveRequest.from_date, leaveRequest.to_date);
    const datesForShifts = isPaidLeaveType(normalizedLeaveType)
        ? getChargeableLeaveDates({
            from_date: leaveRequest.from_date,
            to_date: leaveRequest.to_date,
            leave_type: normalizedLeaveType,
            leave_duration: leaveDuration,
        })
        : allDates;

    // Always derive day count from the selected dates (ignore inflated days_requested).
    const rangeDays = leaveDuration?.includes('half_day')
        ? 0.5 * Math.min(1, datesForShifts.length)
        : datesForShifts.length;
    const requestedDays = rangeDays;

    const balanceField = getBalanceFieldForLeaveType(normalizedLeaveType);
    let paidDays = requestedDays;
    let unpaidDays = 0;
    let workerTable = null;
    let worker = null;

    if (balanceField) {
        const resolved = await resolveWorkerWithTable(
            supabase,
            employeeId,
            'employee_id, annual_leave_balance, medical_leave_balance, hospitalization_leave_balance'
        );
        worker = resolved.worker;
        workerTable = resolved.table;

        // The real balance is the only thing that matters at approval time. Other *pending*
        // requests must NOT be subtracted here: they have not been approved, may still be
        // rejected, and will take their own share when (if) they are approved.
        const availableBalance = Number(worker[balanceField] || 0);
        const split = computePaidUnpaidSplit({
            leaveType: normalizedLeaveType,
            requestedDays,
            availableBalance,
        });
        // Cap again so balance can never create more leave days than the selected range.
        paidDays = Math.min(split.paidDays, rangeDays);
        // A full day is either paid or unpaid — a leftover 0.5 would otherwise be deducted from
        // the balance without any leave shift being created for it.
        paidDays = leaveDuration?.includes('half_day')
            ? (paidDays >= 0.5 ? 0.5 : 0)
            : Math.floor(paidDays + 1e-9);
        unpaidDays = Math.max(0, rangeDays - paidDays);
    }

    // Deduct balance atomically before mutating shifts so concurrent approvals
    // cannot overdraw, and so we fail before wiping work shifts.
    let balanceDeducted = false;
    if (balanceField && worker && workerTable && paidDays > 0) {
        await adjustLeaveBalance(supabase, {
            employeeId,
            workerType: workerTypeFromTable(workerTable),
            fieldName: balanceField,
            delta: -paidDays,
        });
        balanceDeducted = true;
    }

    try {
        const paidDateKeys = buildPaidDateKeys(datesForShifts, paidDays, leaveDuration);
        const paidDateObjs = datesForShifts.filter((d) => paidDateKeys.has(dateKeyFromDateObj(d)));
        // Only the next unpaidDays dates become Unpaid Leave — never every leftover day
        // when paidDays was capped for another reason (stale days_requested, etc.).
        const unpaidCandidates = datesForShifts.filter(
            (d) => !paidDateKeys.has(dateKeyFromDateObj(d))
        );
        const unpaidDateObjs =
            unpaidDays > 0
                ? leaveDuration?.includes('half_day')
                    ? unpaidCandidates.slice(0, unpaidDays > 0 ? 1 : 0)
                    : unpaidCandidates.slice(0, Math.floor(unpaidDays))
                : [];

        const shiftDateObjs = [...paidDateObjs, ...unpaidDateObjs];
        const shiftDates = shiftDateObjs.map((d) => dateKeyFromDateObj(d));
        const halfDay = isHalfDayLeave({
            leave_duration: leaveDuration,
            leave_type: leaveRequest.leave_type || normalizedLeaveType,
        });

        if (shiftDates.length > 0) {
            // ATT-03 / #21: wipe work shifts for full-day leave, or half-day when policy disables keep-work.
            const policy = await fetchLeavePolicy(supabase);
            const wipeWork = !halfDay || policy.half_day_keeps_work === false;
            if (wipeWork) {
                const { error: wipeWorkError } = await supabase
                    .from('shifts')
                    .delete()
                    .eq('worker_id', employeeId)
                    .in('work_date', shiftDates)
                    .is('leave_type', null);
                if (wipeWorkError) throw wipeWorkError;
            }

            const { error: wipeLeaveError } = await supabase
                .from('shifts')
                .delete()
                .eq('worker_id', employeeId)
                .in('work_date', shiftDates)
                .not('leave_type', 'is', null);
            if (wipeLeaveError) throw wipeLeaveError;
        }

        const paidShiftRecords = buildLeaveShiftRecords({
            employeeId,
            leaveType: normalizedLeaveType,
            leaveDuration,
            allDates: paidDateObjs,
            paidDateKeys,
        });
        const unpaidShiftRecords = buildLeaveShiftRecords({
            employeeId,
            leaveType: 'Unpaid Leave',
            leaveDuration,
            allDates: unpaidDateObjs,
            paidDateKeys: new Set(),
        });

        const shiftRecords = [...paidShiftRecords, ...unpaidShiftRecords];
        if (shiftRecords.length > 0) {
            const { error: shiftError } = await supabase.from('shifts').insert(shiftRecords);
            if (shiftError) throw shiftError;
        }

        // Keep days_requested aligned with the selected date span (not balance).
        if (leaveRequest.id && Number(leaveRequest.days_requested) !== requestedDays) {
            await supabase
                .from('leave_requests')
                .update({ days_requested: requestedDays, updated_at: new Date().toISOString() })
                .eq('id', leaveRequest.id);
        }
    } catch (shiftMutationError) {
        if (balanceDeducted) {
            try {
                await adjustLeaveBalance(supabase, {
                    employeeId,
                    workerType: workerTypeFromTable(workerTable),
                    fieldName: balanceField,
                    delta: paidDays,
                });
            } catch {
                // Best-effort compensate; surface the original shift failure.
            }
        }
        throw shiftMutationError;
    }

    return { paidDays, unpaidDays, normalizedLeaveType, requestedDays };
}

export async function processLeaveCancellationEffects(supabase, leaveRequest) {
    if (leaveRequest.status !== 'approved') return;
    await restoreApprovedLeaveBalance(supabase, leaveRequest);
    await deleteLeaveShiftsInRange(
        supabase,
        leaveRequest.employee_id,
        leaveRequest.from_date,
        leaveRequest.to_date
    );
}

export async function processLeaveDeletionEffects(supabase, leaveRequest) {
    if (leaveRequest.status === 'approved') {
        await restoreApprovedLeaveBalance(supabase, leaveRequest);
    }
    await deleteLeaveShiftsInRange(
        supabase,
        leaveRequest.employee_id,
        leaveRequest.from_date,
        leaveRequest.to_date
    );
}

export async function updateLeaveRequestFields(supabase, {
    leaveId,
    leaveEditData,
    editorName,
    previousLeave,
}) {
    const normalizedType = normalizeLeaveType(leaveEditData.leave_type);
    const daysRequested = countRequestedLeaveDays({
        ...leaveEditData,
        leave_type: normalizedType,
    });

    const overlap = await hasOverlappingLeaveRequest({
        supabase,
        employeeId: previousLeave.employee_id,
        fromDate: leaveEditData.from_date,
        toDate: leaveEditData.to_date,
        excludingLeaveId: leaveId,
    });
    if (overlap) {
        throw new Error('Edited dates overlap another active leave request.');
    }

    const updatePayload = {
        leave_type: normalizedType,
        leave_duration: leaveEditData.leave_duration,
        from_date: leaveEditData.from_date,
        to_date: leaveEditData.to_date,
        days_requested: daysRequested,
        updated_at: new Date().toISOString(),
        edited_by: editorName || null,
        edited_at: new Date().toISOString(),
    };

    // Always attempt to bump amend_count; retry without it if column is missing.
    updatePayload.amend_count = (Number(previousLeave?.amend_count) || 0) + 1;

    const { error: updateError } = await supabase
        .from('leave_requests')
        .update(updatePayload)
        .eq('id', leaveId);

    // If amend_count column is missing on older DBs, retry without it.
    if (updateError && /amend_count/i.test(updateError.message || '')) {
        delete updatePayload.amend_count;
        const { error: retryError } = await supabase
            .from('leave_requests')
            .update(updatePayload)
            .eq('id', leaveId);
        if (retryError) throw retryError;
    } else if (updateError) {
        throw updateError;
    }

    if (previousLeave.status === 'approved') {
        await restoreApprovedLeaveBalance(supabase, previousLeave);
        await deleteLeaveShiftsInRange(
            supabase,
            previousLeave.employee_id,
            previousLeave.from_date,
            previousLeave.to_date
        );
        await processLeaveApprovalEffects(supabase, {
            ...previousLeave,
            ...leaveEditData,
            leave_type: normalizedType,
            days_requested: daysRequested,
        });
    }

    return { daysRequested, normalizedType };
}

export function buildLeaveCalendarMonth(monthYear, leaveRequests = []) {
    const [yearStr, monthStr] = String(monthYear).split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!year || !month) return { year: 0, month: 0, weeks: [] };

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const cells = [];

    for (let i = 0; i < firstWeekday; i++) {
        cells.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const leaves = (leaveRequests || []).filter((r) => {
            if (INACTIVE_LEAVE_STATUSES.includes(r.status)) return false;
            return dateStr >= r.from_date && dateStr <= r.to_date;
        });
        cells.push({
            dateStr,
            day,
            isSunday: isSunday(dateStr),
            isHoliday: isPublicHoliday(dateStr),
            leaves,
        });
    }

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
        weeks.push(cells.slice(i, i + 7));
    }

    return { year, month, weeks };
}

// ---------------------------------------------------------------------------
// Leave system upgrade helpers (policy, conflicts, preview, withdraw, bulk)
// ---------------------------------------------------------------------------

export const DEFAULT_LEAVE_POLICY = {
    max_concurrent_company: 10,
    max_concurrent_per_site: 5,
    mc_attachment_min_days: 1,
    withdraw_approved_hours: 24,
    half_day_keeps_work: true,
    ph_leave_rule: 'exclude_charge',
};

export async function fetchLeavePolicy(supabase) {
    const { data, error } = await supabase
        .from('leave_policy_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
    if (error || !data) return { ...DEFAULT_LEAVE_POLICY };
    return { ...DEFAULT_LEAVE_POLICY, ...data };
}

export async function saveLeavePolicy(supabase, updates) {
    const payload = { id: 1, ...updates, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
        .from('leave_policy_settings')
        .upsert(payload)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function fetchBlackoutDates(supabase) {
    const { data, error } = await supabase
        .from('leave_blackout_dates')
        .select('*')
        .order('from_date', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function findBlackoutConflicts({
    supabase,
    fromDate,
    toDate,
    siteId = null,
}) {
    const rows = await fetchBlackoutDates(supabase);
    return rows.filter((b) => {
        if (b.to_date < fromDate || b.from_date > toDate) return false;
        if (!b.site_id) return true; // company-wide
        if (siteId && String(b.site_id) === String(siteId)) return true;
        return false;
    });
}

/** Chargeable dates honouring ph_leave_rule from policy. */
export function getChargeableLeaveDatesWithPolicy({
    from_date,
    to_date,
    leave_type,
    leave_duration,
    ph_leave_rule = 'exclude_charge',
}) {
    const normalizedType = normalizeLeaveType(leave_type);
    const allDates = buildLeaveDateRange(from_date, to_date);
    let chargeable = allDates;

    if (isPaidLeaveType(normalizedType)) {
        if (ph_leave_rule === 'charge_leave') {
            chargeable = allDates;
        } else {
            chargeable = allDates.filter((d) => !(isSunday(d) || isPublicHoliday(d)));
        }
    }

    if (leave_duration?.includes('half_day')) {
        return chargeable.slice(0, 1);
    }
    return chargeable;
}

export function phLeaveRuleLabel(rule) {
    const map = {
        exclude_charge:
            'Paid leave skips Sundays & public holidays (balance not charged). Unworked weekday PH may still be credited; Sunday PH is never credited (Monday in lieu).',
        charge_leave: 'Paid leave charges every calendar day including public holidays.',
        ph_credit_only:
            'Paid leave skips PH/Sunday for balance; unworked weekday PH may still show credit. Sunday PH is never credited.',
    };
    return map[rule] || map.exclude_charge;
}

export function halfDayWorkPolicyLabel(keepsWork = true) {
    return keepsWork
        ? 'Half-day leave keeps any same-day work shift (e.g. morning leave + afternoon work).'
        : 'Half-day leave replaces the whole day (work shifts on that date are removed on approval).';
}

export function buildLeaveBalancePreview({
    leaveType,
    fromDate,
    toDate,
    leaveDuration,
    currentBalance,
    pendingReservedDays = 0,
    ph_leave_rule = 'exclude_charge',
}) {
    const dates = getChargeableLeaveDatesWithPolicy({
        from_date: fromDate,
        to_date: toDate,
        leave_type: leaveType,
        leave_duration: leaveDuration,
        ph_leave_rule,
    });
    const requestedDays = leaveDuration?.includes('half_day') ? 0.5 * dates.length : dates.length;
    const availableAfterPending = Math.max(
        0,
        (Number(currentBalance) || 0) - (Number(pendingReservedDays) || 0)
    );
    const split = computePaidUnpaidSplit({
        leaveType,
        requestedDays,
        availableBalance: availableAfterPending,
    });
    const remainingAfter = Math.max(0, availableAfterPending - split.paidDays);

    return {
        requestedDays,
        availableAfterPending,
        remainingAfter,
        ...split,
        tracksBalance: !!getBalanceFieldForLeaveType(leaveType),
    };
}

export function requiresMedicalAttachment({ leaveType, requestedDays, policy }) {
    const normalized = normalizeLeaveType(leaveType);
    if (normalized !== 'Medical Leave' && normalized !== 'Hospitalization Leave') return false;
    const minDays = Number(policy?.mc_attachment_min_days ?? 1);
    return requestedDays >= minDays;
}

/**
 * Peak number of other workers on leave on any day of [fromDate, toDate].
 * Only APPROVED leave counts by default: pending requests are not commitments, and counting
 * them let a handful of unapproved requests lock every other worker out of submitting.
 */
export async function countConcurrentLeaveOnDates({
    supabase,
    fromDate,
    toDate,
    siteId = null,
    excludingLeaveId = null,
    statuses = ['approved'],
}) {
    let query = supabase
        .from('leave_requests')
        .select('id, employee_id, from_date, to_date, site_id, status')
        .in('status', statuses)
        .lte('from_date', toDate)
        .gte('to_date', fromDate);

    if (excludingLeaveId) query = query.neq('id', excludingLeaveId);

    const { data, error } = await query;
    if (error) throw error;

    let filtered = data || [];
    if (siteId) {
        filtered = filtered.filter((r) => !r.site_id || String(r.site_id) === String(siteId));
    }

    const dates = buildLeaveDateRange(fromDate, toDate).map((d) => toSingaporeDateStr(d));
    let maxConcurrent = 0;
    for (const dateKey of dates) {
        const onDay = filtered.filter((r) => dateKey >= r.from_date && dateKey <= r.to_date);
        maxConcurrent = Math.max(maxConcurrent, new Set(onDay.map((r) => r.employee_id)).size);
    }
    return { maxConcurrent, overlappingRequests: filtered };
}

export async function findOpenShiftsInRange({ supabase, employeeId, fromDate, toDate }) {
    const { data, error } = await supabase
        .from('shifts')
        .select('id, work_date, entry_time, leave_time, has_left, leave_type')
        .eq('worker_id', employeeId)
        .gte('work_date', fromDate)
        .lte('work_date', toDate)
        .is('leave_type', null);
    if (error) throw error;
    return data || [];
}

export async function evaluateLeaveConflicts({
    supabase,
    employeeId,
    fromDate,
    toDate,
    leaveType,
    leaveDuration,
    siteId = null,
    attachmentPath = null,
    excludingLeaveId = null,
    policy = null,
}) {
    const pol = policy || (await fetchLeavePolicy(supabase));
    const hard = [];
    const soft = [];

    // Validate the dates first so nothing malformed ever reaches a database query.
    const rangeDates = buildLeaveDateRange(fromDate, toDate);
    if (!rangeDates.length) {
        return {
            hard: ['Please enter a valid date range (the "to" date cannot be before the "from" date).'],
            soft,
            requestedDays: 0,
            policy: pol,
        };
    }

    const overlapping = await findOverlappingLeaveRequests({
        supabase,
        employeeId,
        fromDate,
        toDate,
        excludingLeaveId,
    });
    if (overlapping.length) {
        hard.push('This overlaps an existing leave request (pending or approved).');
    }

    if (rangeDates.length > MAX_LEAVE_SPAN_DAYS) {
        hard.push(`Leave cannot span more than ${MAX_LEAVE_SPAN_DAYS} days. Please check the dates.`);
    }
    // Advisory checks below are skipped (not failed) if their backing tables can't be read,
    // so a missing/locked optional table never stops a worker from submitting leave.
    if (rangeDates.length <= MAX_LEAVE_SPAN_DAYS) {
        try {
            const blackouts = await findBlackoutConflicts({ supabase, fromDate, toDate, siteId });
            if (blackouts.length) {
                hard.push(
                    `Blackout period: ${blackouts
                        .map((b) => `${b.from_date}–${b.to_date}${b.reason ? ` (${b.reason})` : ''}`)
                        .join('; ')}`
                );
            }
        } catch (err) {
            console.warn('[leave] blackout check skipped:', err?.message || err);
        }

        try {
            const { maxConcurrent } = await countConcurrentLeaveOnDates({
                supabase,
                fromDate,
                toDate,
                siteId,
                excludingLeaveId,
            });
            // A limit of 0 (or blank) means "no limit".
            const companyLimit = Number(pol.max_concurrent_company) || 0;
            const siteLimit = Number(pol.max_concurrent_per_site) || 0;
            if (companyLimit > 0 && maxConcurrent + 1 > companyLimit) {
                hard.push(
                    `Too many workers already have approved leave on these dates (company limit ${companyLimit}). Try different dates or ask your manager.`
                );
            } else if (siteId && siteLimit > 0 && maxConcurrent + 1 > siteLimit) {
                hard.push(
                    `Too many workers on your site already have approved leave on these dates (site limit ${siteLimit}). Try different dates or ask your manager.`
                );
            }
        } catch (err) {
            console.warn('[leave] concurrency check skipped:', err?.message || err);
        }
    }

    const dates = getChargeableLeaveDatesWithPolicy({
        from_date: fromDate,
        to_date: toDate,
        leave_type: leaveType,
        leave_duration: leaveDuration,
        ph_leave_rule: pol.ph_leave_rule,
    });
    const requestedDays = leaveDuration?.includes('half_day') ? 0.5 * dates.length : dates.length;

    if (requestedDays <= 0) {
        hard.push(
            'These dates are all Sundays/public holidays, so there is nothing to take leave for. Please choose working days.'
        );
    }

    if (requiresMedicalAttachment({ leaveType, requestedDays, policy: pol }) && !attachmentPath) {
        hard.push(
            `Medical/Hospitalization leave of ${pol.mc_attachment_min_days}+ day(s) requires an attachment (MC/doctor note).`
        );
    }

    if (leaveDuration?.includes('half_day') && fromDate !== toDate) {
        hard.push('Half-day leave must be a single calendar day (from and to dates the same).');
    }

    let openShifts = [];
    try {
        openShifts = rangeDates.length <= MAX_LEAVE_SPAN_DAYS
            ? await findOpenShiftsInRange({ supabase, employeeId, fromDate, toDate })
            : [];
    } catch (err) {
        console.warn('[leave] open-shift check skipped:', err?.message || err);
    }
    if (openShifts.length) {
        if (leaveDuration?.includes('half_day') && pol.half_day_keeps_work) {
            soft.push(
                `You have ${openShifts.length} work shift(s) on these dates. Half-day leave will keep them.`
            );
        } else if (!leaveDuration?.includes('half_day')) {
            soft.push(
                `You have ${openShifts.length} work shift(s) on these dates. Approving full-day leave will remove those work shifts.`
            );
        }
    }

    const phInRange = rangeDates.filter((d) => isPublicHoliday(d) || isSunday(d));
    if (phInRange.length && isPaidLeaveType(leaveType)) {
        soft.push(`Range includes ${phInRange.length} Sunday/PH day(s). ${phLeaveRuleLabel(pol.ph_leave_rule)}`);
    }

    return { hard, soft, requestedDays, policy: pol };
}

export function canWorkerWithdrawLeave(leaveRequest, policy = DEFAULT_LEAVE_POLICY) {
    if (!leaveRequest) return { ok: false, reason: 'Missing request' };
    const status = leaveRequest.status;
    if (['pending', 'pending_manager', 'pending_admin'].includes(status)) {
        return { ok: true, reason: null };
    }
    if (status === 'approved') {
        const hours = Number(policy.withdraw_approved_hours ?? 24);
        if (hours <= 0) return { ok: false, reason: 'Approved leave cannot be withdrawn' };
        const approvedAt = leaveRequest.updated_at || leaveRequest.created_at;
        if (!approvedAt) return { ok: false, reason: 'Unknown approval time' };
        const elapsedMs = Date.now() - new Date(approvedAt).getTime();
        if (elapsedMs <= hours * 3600 * 1000) return { ok: true, reason: null };
        return { ok: false, reason: `Approved leave can only be withdrawn within ${hours} hours` };
    }
    return { ok: false, reason: 'This request cannot be withdrawn' };
}

export async function withdrawLeaveRequest(supabase, leaveRequest, { cancelledBy = 'worker' } = {}) {
    const policy = await fetchLeavePolicy(supabase);
    const gate = canWorkerWithdrawLeave(leaveRequest, policy);
    if (!gate.ok) throw new Error(gate.reason || 'Cannot withdraw');

    if (leaveRequest.status === 'approved') {
        await processLeaveCancellationEffects(supabase, leaveRequest);
    }

    const { error } = await supabase
        .from('leave_requests')
        .update({
            status: 'cancelled',
            cancelled_by: cancelledBy,
            cancelled_at: new Date().toISOString(),
        })
        .eq('id', leaveRequest.id);
    if (error) throw error;
    return true;
}

export async function bulkUpdateLeaveStatus(supabase, {
    leaveIds,
    status,
    rejectionReason = null,
    adminNotes = null,
}) {
    const results = [];
    for (const id of leaveIds) {
        try {
            const { data: leaveRequest, error: fetchErr } = await supabase
                .from('leave_requests')
                .select('*')
                .eq('id', id)
                .single();
            if (fetchErr) throw fetchErr;

            if (status === 'approved') {
                await processLeaveApprovalEffects(supabase, leaveRequest);
            } else if (status === 'cancelled') {
                await processLeaveCancellationEffects(supabase, leaveRequest);
            }

            const patch = { status, updated_at: new Date().toISOString() };
            if (status === 'rejected') {
                patch.rejection_reason = rejectionReason || adminNotes || null;
                patch.admin_notes = rejectionReason || adminNotes || leaveRequest.admin_notes;
            } else if (adminNotes != null) {
                patch.admin_notes = adminNotes;
            }

            const { error: updErr } = await supabase.from('leave_requests').update(patch).eq('id', id);
            if (updErr) throw updErr;
            results.push({ id, ok: true });
        } catch (err) {
            results.push({ id, ok: false, error: err?.message || String(err) });
        }
    }
    return results;
}

export function computeLeaveDashboardStats(leaveRequests = [], { overdueHours = 72 } = {}) {
    const now = Date.now();
    const stats = {
        total: leaveRequests.length,
        pending_manager: 0,
        pending_admin: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        cancelled: 0,
        overdue: 0,
        byType: {},
        bySite: {},
    };

    for (const r of leaveRequests) {
        const st = r.status || 'unknown';
        if (Object.prototype.hasOwnProperty.call(stats, st)) stats[st] += 1;

        const type = normalizeLeaveType(r.leave_type) || 'Other';
        stats.byType[type] = (stats.byType[type] || 0) + 1;
        const site = r.site_id || 'Unassigned';
        stats.bySite[site] = (stats.bySite[site] || 0) + 1;

        if (['pending', 'pending_manager', 'pending_admin'].includes(st) && r.created_at) {
            const ageH = (now - new Date(r.created_at).getTime()) / 3600000;
            if (ageH >= overdueHours) stats.overdue += 1;
        }
    }
    return stats;
}

