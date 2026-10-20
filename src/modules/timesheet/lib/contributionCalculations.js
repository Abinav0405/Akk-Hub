// CPF, SINDA, and SDL calculations — Singapore rates effective 1 Jan 2026

/**
 * Paid leave types for which Sundays and public holidays are excluded from day counts.
 */
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

/** CPF Ordinary Wage monthly ceiling (from 1 Jan 2026). */
export const CPF_OW_CEILING = 8000;

/** Combined OW + AW annual ceiling per employer per calendar year (from 1 Jan 2026). */
export const CPF_ANNUAL_WAGE_CEILING = 102000;

/** Parse a YYYY-MM-DD string as midnight Singapore time (avoids device-timezone drift). */
function parseSingaporeDate(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).split('T')[0].trim();
    const d = new Date(`${s}T00:00:00+08:00`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Today as YYYY-MM-DD in Singapore timezone. */
function todaySgt() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

/** Last calendar day of the month containing dateStr (YYYY-MM-DD), as YYYY-MM-DD SGT. */
export function endOfMonthSgt(dateStr) {
    const d = parseSingaporeDate(dateStr);
    if (!d) return null;
    const y = d.getFullYear();
    const m = d.getMonth();
    const last = new Date(Date.UTC(y, m + 1, 0));
    const dd = String(last.getUTCDate()).padStart(2, '0');
    const mm = String(m + 1).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
}

/**
 * Strip half-day suffix so "Annual Leave_HALF_MORNING" matches paid-leave lists.
 */
export function baseLeaveTypeName(leaveType) {
    return String(leaveType || '')
        .replace(/_HALF_MORNING$/i, '')
        .replace(/_HALF_AFTERNOON$/i, '')
        .trim();
}

export function isPaidLeaveTypeName(leaveType) {
    return PAID_LEAVE_TYPES.includes(baseLeaveTypeName(leaveType));
}

export function isUnpaidLeaveTypeName(leaveType) {
    const base = baseLeaveTypeName(leaveType);
    return base === 'Unpaid Leave' || base === 'Unpaid Infant Care Leave';
}

export function isHalfDayLeaveType(leaveType) {
    return /_HALF_(MORNING|AFTERNOON)$/i.test(String(leaveType || ''));
}

/**
 * Chronological age in years as of a Singapore calendar date.
 */
export function calculateAge(birthday, asOfDate = null) {
    if (!birthday) return 0;

    const birthDate = parseSingaporeDate(birthday);
    if (!birthDate) return 0;

    const refDate = parseSingaporeDate(asOfDate ?? todaySgt());
    if (!refDate) return 0;

    let age = refDate.getFullYear() - birthDate.getFullYear();
    const monthDiff = refDate.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && refDate.getDate() < birthDate.getDate())) {
        age--;
    }

    return age;
}

/**
 * CPF contribution age band age.
 * Rates change from the 1st day of the calendar month FOLLOWING the birthday month.
 * While still in the birthday month, use age as of the last day of the prior month.
 */
export function getCpfContributionAge(birthday, asOfDate = null) {
    const asOf = asOfDate ?? todaySgt();
    const birthDate = parseSingaporeDate(birthday);
    const refDate = parseSingaporeDate(asOf);
    if (!birthDate || !refDate) return 0;

    if (refDate.getMonth() === birthDate.getMonth()) {
        const y = refDate.getFullYear();
        const m = refDate.getMonth(); // 0-based
        const prevLast = new Date(Date.UTC(y, m, 0));
        const dd = String(prevLast.getUTCDate()).padStart(2, '0');
        const mm = String(prevLast.getUTCMonth() + 1).padStart(2, '0');
        const py = prevLast.getUTCFullYear();
        return calculateAge(birthday, `${py}-${mm}-${dd}`);
    }

    return calculateAge(birthday, asOf);
}

/**
 * Compute CPF OW / AW base.
 * OW includes basic + OT + Sun/PH + allowances, capped at CPF_OW_CEILING.
 * AW (bonus) is capped by remaining annual ceiling: 102000 - yearToDateOwSubjectToCpf.
 *
 * @param {{ basicPay?: number, otPay?: number, sunPhPay?: number, allowances?: number, bonus?: number, yearToDateOrdinaryWages?: number }} wages
 */
export function computeCpfWageBase({
    basicPay = 0,
    otPay = 0,
    sunPhPay = 0,
    allowances = 0,
    bonus = 0,
    yearToDateOrdinaryWages = 0,
} = {}) {
    const rawOw =
        (Number(basicPay) || 0) +
        (Number(otPay) || 0) +
        (Number(sunPhPay) || 0) +
        (Number(allowances) || 0);
    const ordinaryWage = Math.min(Math.max(rawOw, 0), CPF_OW_CEILING);

    const ytdOw = Math.max(Number(yearToDateOrdinaryWages) || 0, 0);
    const awCeiling = Math.max(0, CPF_ANNUAL_WAGE_CEILING - ytdOw);
    const additionalWage = Math.min(Math.max(Number(bonus) || 0, 0), awCeiling);

    return {
        ordinaryWage,
        additionalWage,
        totalCpfBase: ordinaryWage + additionalWage,
        awCeiling,
        owCeiling: CPF_OW_CEILING,
    };
}

/** Employee CPF % — 2026 rates (wages above $750 tier). */
export function getCPFEmployeeRate(age) {
    if (age <= 55) return 20.0;
    if (age <= 60) return 18.0; // Above 55 to 60
    if (age <= 65) return 12.5; // Above 60 to 65
    if (age <= 70) return 7.5; // Above 65 to 70
    return 5.0; // Above 70
}

/** Employer CPF % — 2026 rates. */
export function getCPFEmployerRate(age) {
    if (age <= 55) return 17.0;
    if (age <= 60) return 16.0; // Above 55 to 60
    if (age <= 65) return 12.5; // Above 60 to 65
    if (age <= 70) return 9.0; // Above 65 to 70
    return 7.5; // Above 70
}

export function getCpfRatesForBirthday(birthday, asOfDate = null) {
    const age = getCpfContributionAge(birthday, asOfDate);
    return {
        age,
        employeeRate: getCPFEmployeeRate(age),
        employerRate: getCPFEmployerRate(age),
    };
}

/**
 * SINDA brackets (Indian SHG) — monthly total wages → fixed deduction.
 * Only call when worker is SINDA-eligible (Indian descent, not opted out).
 */
export function calculateSINDA(employeeMonthlyWages) {
    const w = Number(employeeMonthlyWages) || 0;
    if (w <= 0) return 0;
    if (w <= 1000) return 1.0;
    if (w <= 1500) return 3.0;
    if (w <= 2500) return 5.0;
    if (w <= 4500) return 7.0;
    if (w <= 7500) return 9.0;
    if (w <= 10000) return 12.0;
    // > 10000 including above 15000 caps at 18
    return 18.0;
}

/**
 * SINDA only when worker.sinda_eligible is true (Indian descent / not opted out).
 * Accepts boolean, Postgres/PostgREST truthy strings, and 1/0.
 */
export function isSindaEligible(workerOrEligible) {
    if (typeof workerOrEligible === 'boolean') return workerOrEligible;
    if (typeof workerOrEligible === 'number') return workerOrEligible === 1;
    if (typeof workerOrEligible === 'string') {
        const s = workerOrEligible.trim().toLowerCase();
        return s === 'true' || s === 't' || s === '1' || s === 'yes';
    }
    if (!workerOrEligible || typeof workerOrEligible !== 'object') return false;
    return isSindaEligible(workerOrEligible.sinda_eligible);
}

export function resolveSindaDeduction(monthlyWages, workerOrEligible) {
    if (!isSindaEligible(workerOrEligible)) return 0;
    return calculateSINDA(monthlyWages);
}

/** Monthly wages used for SINDA brackets (gross additions, including custom lines). */
export function sindaMonthlyWageBase({
    basicPay = 0,
    otPay = 0,
    sunPhPay = 0,
    allowances = 0,
    bonus = 0,
    customAdditions = 0,
} = {}) {
    return (
        (Number(basicPay) || 0) +
        (Number(otPay) || 0) +
        (Number(sunPhPay) || 0) +
        (Number(allowances) || 0) +
        (Number(bonus) || 0) +
        (Number(customAdditions) || 0)
    );
}

export function roundPayslipMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

export const LOCAL_PAYSLIP_YTD_COLUMNS =
    'net_pay, cpf_employee, cpf_employer, sinda_contribution, period_year, period_month, basic_salary, ot_pay, sunday_pay, monthly_allowance, incentive_allowance, bonus, total_additions, total_deductions, additions_json, deductions_json';

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

/** Sum custom line items; ignores admin `_sys_*` override rows. */
export function sumPayslipLineItems(items, nameKey = 'name', valueKey = 'value') {
    return parseJsonArray(items).reduce((sum, item) => {
        const label = String(item?.[nameKey] || '').trim();
        if (!label || label.startsWith('_sys_')) return sum;
        return sum + (parseFloat(item?.[valueKey]) || 0);
    }, 0);
}

export function isPeriodBefore(row, year, month) {
    return Number(row?.period_year) === Number(year) && Number(row?.period_month) < Number(month);
}

/**
 * History `net_pay` sometimes omitted custom additions (Director Fees, etc.).
 * If stored net matches core wages − CPF − SINDA, add those extras back.
 */
export function payslipHistoryNetPay(row) {
    const stored = Number(row?.net_pay) || 0;
    const extras = sumPayslipLineItems(row?.additions_json, 'name', 'value');
    const extraDeductions = sumPayslipLineItems(row?.deductions_json, 'type', 'amount');
    const core =
        (Number(row?.basic_salary) || 0) +
        (Number(row?.ot_pay) || 0) +
        (Number(row?.sunday_pay) || Number(row?.sun_ph_pay) || 0) +
        (Number(row?.monthly_allowance) || 0) +
        (Number(row?.incentive_allowance) || 0) +
        (Number(row?.bonus) || 0) -
        (Number(row?.cpf_employee) || 0) -
        (Number(row?.sinda_contribution) || 0) -
        extraDeductions;

    if (extras > 0.005 && Math.abs(stored - core) <= 2) {
        return roundPayslipMoney(stored + extras);
    }

    const fromTotals = (Number(row?.total_additions) || 0) - (Number(row?.total_deductions) || 0);
    if (fromTotals > stored + 0.5) {
        return roundPayslipMoney(fromTotals);
    }

    return roundPayslipMoney(stored);
}

export function sumLocalYtdFromHistory(historyRows, year, month) {
    let net = 0;
    let cpfEmp = 0;
    let cpfEr = 0;
    (historyRows || []).forEach((row) => {
        if (!isPeriodBefore(row, year, month)) return;
        net += payslipHistoryNetPay(row);
        cpfEmp += Number(row?.cpf_employee) || 0;
        cpfEr += Number(row?.cpf_employer) || 0;
    });
    return {
        net: roundPayslipMoney(net),
        cpfEmp: roundPayslipMoney(cpfEmp),
        cpfEr: roundPayslipMoney(cpfEr),
    };
}

/**
 * SDL: 0.25% of monthly wages, first $4,500 only; min $2 if wages < $800; max $11.25.
 */
export function calculateSDL(monthlyWages) {
    if (monthlyWages <= 0) return 0;

    const cappedWages = Math.min(monthlyWages, 4500);
    const contribution = cappedWages * 0.0025;

    if (monthlyWages < 800) {
        return Math.max(2.0, Math.min(contribution, 11.25));
    }
    return Math.min(contribution, 11.25);
}

export function calculateCPFDeductions(salaryAmount, employeeRate, employerRate) {
    const employeeDeduction = salaryAmount * (employeeRate / 100);
    const employerContribution = salaryAmount * (employerRate / 100);

    return {
        employeeDeduction: Math.round(employeeDeduction * 100) / 100,
        employerContribution: Math.round(employerContribution * 100) / 100,
    };
}

export function calculateAccumulatedTotals(payslipHistory) {
    let totalAccumulatedSalary = 0;
    let accumulatedCPFEmployee = 0;
    let accumulatedEmployerCPF = 0;

    payslipHistory.forEach((payslip) => {
        totalAccumulatedSalary += payslip.total_additions || 0;
        accumulatedCPFEmployee += payslip.cpf_employee_deduction || 0;
        accumulatedEmployerCPF += payslip.cpf_employer_contribution || 0;
    });

    return {
        totalAccumulatedSalary: Math.round(totalAccumulatedSalary * 100) / 100,
        accumulatedCPFEmployee: Math.round(accumulatedCPFEmployee * 100) / 100,
        accumulatedEmployerCPF: Math.round(accumulatedEmployerCPF * 100) / 100,
    };
}

export function validateBirthday(birthday) {
    if (!birthday) {
        return { isValid: false, error: 'Birthday is required for local workers' };
    }

    const birthDate = parseSingaporeDate(birthday);
    if (!birthDate) {
        return { isValid: false, error: 'Invalid birthday date' };
    }

    const todayDate = parseSingaporeDate(todaySgt());

    if (birthDate > todayDate) {
        return { isValid: false, error: 'Birthday cannot be in the future' };
    }

    const age = calculateAge(birthday);
    if (age < 16 || age > 100) {
        return { isValid: false, error: 'Age must be between 16 and 100 years' };
    }

    return { isValid: true, error: '' };
}
