/**
 * Worker information fields.
 *   INFO_FIELDS  — the ten details stored with the worker (mirrors core._wi_fields() in migration/sql/82).
 *                  Askable from the worker, editable by the admin.
 *   BASE_FIELDS  — every other column of the worker's Attendance record (master data). Admins can edit
 *                  most of these from the profile sheet (see EDITABLE_BASE_KEYS); a few stay locked
 *                  (employee ID, worker type, system timestamps / enrollment flags). The password hash
 *                  and face-recognition data are never exposed.
 * `applies`: 'all' | 'foreign' | 'local' (local Singapore / PR staff have no work permit or passport;
 * foreign workers have no CPF / SINDA).
 *
 * Custom details (anything else an admin types into a request) are keyed `x_<slug>`; their names travel
 * with the data as `custom_labels` ({ key: label }).
 */
const f = (key, label, kind, group, applies = 'all') => ({ key, label, kind, group, applies });

export const INFO_FIELDS = [
    f('work_permit_no', 'Work Permit No.', 'text', 'employment', 'foreign'),
    f('permit_expiry_date', 'Work Permit Expiry', 'date', 'employment', 'foreign'),
    f('soc_no', 'SOC No.', 'text', 'employment', 'all'),
    f('soc_expiry_date', 'SOC Expiry', 'date', 'employment', 'all'),
    f('hp_number', 'Mobile (HP) Number', 'tel', 'personal', 'all'),
    f('nationality', 'Nationality', 'text', 'personal', 'all'),
    f('address', 'Residential Address', 'textarea', 'personal', 'all'),
    f('date_of_birth', 'Date of Birth', 'date', 'personal', 'all'),
    f('passport_no', 'Passport No.', 'text', 'passport', 'foreign'),
    f('passport_expiry_date', 'Passport Expiry', 'date', 'passport', 'foreign'),
    f('emergency_contact_number', 'Emergency Contact Number', 'tel', 'emergency', 'all'),
];
export const FIELD_BY_KEY = Object.fromEntries(INFO_FIELDS.map((x) => [x.key, x]));

export const BASE_FIELDS = [
    f('employee_id', 'Employee ID', 'text', 'identification'),
    f('name', 'Full Name', 'text', 'identification'),
    f('nric_fin', 'NRIC / FIN', 'text', 'identification'),
    f('designation', 'Designation', 'text', 'identification'),
    f('worker_type', 'Worker Type', 'text', 'identification'),
    f('in_company', 'Employment Status', 'text', 'identification'),
    f('date_joined', 'Date Joined', 'date', 'identification'),
    f('date_of_cessation', 'Date of Cessation', 'date', 'identification'),
    f('rejoin_dates', 'Rejoin Dates', 'text', 'identification'),
    f('age', 'Age', 'num', 'identification'),
    f('birthday', 'Birthday (payroll record)', 'date', 'identification', 'none'),
    f('created_at', 'Record Created', 'date', 'identification', 'foreign'),
    f('bank_account_number', 'Bank Account Number', 'text', 'pay'),
    f('basic_salary_per_day', 'Basic Salary (per day)', 'money', 'pay'),
    f('ot_rate_per_hour', 'OT Rate (per hour)', 'money', 'pay'),
    f('sun_ph_rate_per_day', 'Sunday / PH Rate (per day)', 'money', 'pay'),
    f('monthly_allowance', 'Monthly Allowance', 'money', 'pay'),
    f('accumulated_net_pay', 'Accumulated Net Pay', 'money', 'pay'),
    f('last_accumulation_date', 'Last Accumulation Date', 'date', 'pay'),
    f('cpf_employee_contribution', 'CPF — Employee', 'money', 'pay', 'local'),
    f('cpf_employer_contribution', 'CPF — Employer', 'money', 'pay', 'local'),
    f('sinda_contribution', 'SINDA Contribution', 'money', 'pay', 'local'),
    f('sinda_eligible', 'SINDA Eligible', 'bool', 'pay', 'local'),
    f('deduction_1_name', 'Deduction 1 — Name', 'text', 'deductions'),
    f('deduction_1_amount', 'Deduction 1 — Amount', 'money', 'deductions'),
    f('deduction_2_name', 'Deduction 2 — Name', 'text', 'deductions'),
    f('deduction_2_amount', 'Deduction 2 — Amount', 'money', 'deductions'),
    f('deduction_3_name', 'Deduction 3 — Name', 'text', 'deductions'),
    f('deduction_3_amount', 'Deduction 3 — Amount', 'money', 'deductions'),
    f('annual_leave_balance', 'Annual Leave Balance', 'num', 'leave'),
    f('annual_leave_limit', 'Annual Leave Limit', 'num', 'leave'),
    f('medical_leave_balance', 'Medical Leave Balance', 'num', 'leave'),
    f('medical_leave_limit', 'Medical Leave Limit', 'num', 'leave'),
    f('hospitalization_leave_balance', 'Hospitalisation Leave Balance', 'num', 'leave'),
    f('hospitalization_leave_limit', 'Hospitalisation Leave Limit', 'num', 'leave'),
    f('biometric_enrolled', 'Biometric Enrolled', 'bool', 'access', 'foreign'),
    f('face_id_set', 'Face ID Set Up', 'bool', 'access'),
    f('face_id_enabled', 'Face ID Enabled', 'bool', 'access'),
];

/** Master-record details a worker can be asked for: the answer waits for admin approval before it is saved. */
export const MASTER_ASKABLE = BASE_FIELDS.filter((x) => ['nric_fin', 'bank_account_number'].includes(x.key)).map((x) => ({ ...x, approval: true }));
/** Everything an admin can ask a worker for (custom questions are typed per request). */
export const ASKABLE_FIELDS = [...INFO_FIELDS, ...MASTER_ASKABLE];
export const ASKABLE_BY_KEY = Object.fromEntries(ASKABLE_FIELDS.map((x) => [x.key, x]));

export const GROUPS = [
    { key: 'identification', label: 'Employee identification' },
    { key: 'employment', label: 'Work permit & SOC' },
    { key: 'personal', label: 'Personal information' },
    { key: 'passport', label: 'Passport' },
    { key: 'emergency', label: 'Emergency contact' },
    { key: 'pay', label: 'Bank & pay (confidential)' },
    { key: 'deductions', label: 'Deductions' },
    { key: 'leave', label: 'Leave' },
    { key: 'access', label: 'Face ID & biometrics' },
    { key: 'custom', label: 'Custom details' },
];

export const EXPORT_FIELDS = [...BASE_FIELDS, ...INFO_FIELDS];
export const FIELD_DEF = Object.fromEntries(EXPORT_FIELDS.map((x) => [x.key, x]));
export const LABEL = Object.fromEntries(EXPORT_FIELDS.map((x) => [x.key, x.label]));

/**
 * Master fields locked in the profile edit form (matches Timesheet Manager where ID rename is a
 * special cascade path, and avoids table moves / system-owned flags).
 * Everything else in BASE_FIELDS is editable for admins when Edit is on.
 */
export const READONLY_BASE_KEYS = new Set([
    'employee_id', // unique key; TM can rename via a cascade path this sheet does not own
    'worker_type', // local ↔ foreign would move the row between tables
    'created_at', // system timestamp
    'biometric_enrolled', // device enrollment state
    'face_id_set', // enrollment state (face_id_enabled remains editable)
]);
export const isEditableBaseKey = (key) => !READONLY_BASE_KEYS.has(key);

export const appliesTo = (field, workerType) => field.applies === 'all' || field.applies === workerType;
/** Show a field for this worker: it applies to them, or it has a value anyway. */
export const showField = (field, workerType, value) => appliesTo(field, workerType) || (value != null && value !== '');

/** Form string for a stored base/info value when entering edit mode. */
export function toFormValue(key, value) {
    if (key === 'rejoin_dates') {
        const list = (Array.isArray(value) ? value : [])
            .map((v) => (typeof v === 'string' ? v : v?.date || v?.rejoin_date || ''))
            .map((v) => String(v).slice(0, 10))
            .filter(Boolean);
        return list.join(', ');
    }
    if (key === 'in_company') return value === false || value === 0 || value === 'false' ? 'false' : 'true';
    const def = FIELD_DEF[key];
    if (def?.kind === 'bool') return value ? 'true' : 'false';
    if (value == null || value === '') return '';
    if (def?.kind === 'date') return String(value).slice(0, 10);
    return String(value);
}

export const isCustomKey = (key) => /^x_[a-z0-9_]{1,40}$/.test(String(key));
/** Field definitions for custom details from a { key: label } map. */
export const customFieldDefs = (labels) =>
    Object.entries(labels || {})
        .map(([key, label]) => ({ key, label, kind: 'text', group: 'custom', applies: 'all', custom: true }))
        .sort((a, b) => a.label.localeCompare(b.label));
/** Label for any key (catalogue or custom). */
export const labelOf = (key, labels) => LABEL[key] || labels?.[key] || key;

const fmtDate = (value) => {
    if (String(value).startsWith('9999')) return 'No expiry';
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};
const money = (v) => `S$ ${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Display a stored value (dates as 21 Mar 2029, 9999-12-31 as "No expiry", empty as null). */
export function formatValue(key, value) {
    if (value == null || value === '') return null;
    if (key === 'in_company') return value ? 'Employed' : 'Not in company';
    if (key === 'worker_type') return value === 'local' ? 'Local (Singapore / PR)' : 'Foreign (work pass)';
    const def = FIELD_DEF[key];
    if (def?.kind === 'bool') return value ? 'Yes' : 'No';
    if (def?.kind === 'money') return money(value);
    if (def?.kind === 'num') return String(Number(value));
    if (key === 'rejoin_dates') {
        const list = (Array.isArray(value) ? value : []).map((v) => (typeof v === 'string' ? v : v?.date || v?.rejoin_date || '')).filter(Boolean);
        return list.length ? list.map((v) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v) : v)).join(', ') : null;
    }
    if (def?.kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return fmtDate(value);
    return String(value);
}

/** Days until a date value (null if not a real date). */
export function daysUntil(value) {
    if (!value || String(value).startsWith('9999')) return null;
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
    if (!y) return null;
    const ms = new Date(y, m - 1, d) - new Date(new Date().toDateString());
    return Math.round(ms / 86400000);
}

/** Input type for a field kind. */
export const inputType = (kind) => (kind === 'date' ? 'date' : kind === 'tel' ? 'tel' : 'text');
