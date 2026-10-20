import { applySysOverridesToExtracted } from '@/modules/timesheet/lib/payslipOverrides';
import { formatDate } from '@/modules/timesheet/lib/timeUtils';
import { workerIsNotInCompany, parseRejoinDatesFromWorker } from '@/modules/timesheet/lib/workerEmploymentPay';
import { printOrShareHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';

const COMPANY = {
    name: 'AKK Engineering Pte. Ltd.',
    address: '15 Kaki Bukit Rd 4, #01-50, Singapore 417808',
};

function esc(value) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function n(x) {
    const v = parseFloat(x);
    return Number.isFinite(v) ? v : 0;
}

export function formatMoney(amount) {
    const v = n(amount);
    return `$${v.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse payslip HTML into numeric line items (shared with payslip report logic). */
export function extractPayslipValuesFromHtml(payslipHTML) {
    if (!payslipHTML) {
        return emptyPayslipRow();
    }

    const values = emptyPayslipRow();

    const parseMoney = (text) => {
        if (text == null || text === '') return 0;
        const s = String(text).replace(/,/g, '');
        const m = s.match(/-?\s*\$?\s*([\d.]+)/);
        return m ? Math.abs(parseFloat(m[1])) : 0;
    };

    const extractAmount = (text) => parseMoney(text);

    let htmlSlice = payslipHTML;
    const page2 = payslipHTML.indexOf('<!-- PAGE 2: PAYSLIP -->');
    if (page2 !== -1) htmlSlice = payslipHTML.slice(page2);

    const getAmountFromLabel = (doc, labelPattern) => {
        const labels = doc.querySelectorAll('.amount-label');
        for (const label of labels) {
            const txt = label.textContent.trim();
            if (labelPattern.test(txt)) {
                const box = label.closest('.salary-box') || label.parentElement;
                const amountEl = box?.querySelector('.amount-large') || label.nextElementSibling;
                if (amountEl) return extractAmount(amountEl.textContent);
            }
        }
        return 0;
    };

    const getItemRowAmount = (doc, labelPattern) => {
        const candidates = doc.querySelectorAll('.earnings-row .item-label, .deductions-row .item-label');
        for (const lab of candidates) {
            if (labelPattern.test(lab.textContent.trim())) {
                const row = lab.closest('.earnings-row, .deductions-row') || lab.parentElement;
                const amt = row?.querySelector('.item-amount') || lab.nextElementSibling;
                if (amt?.textContent) return extractAmount(amt.textContent);
            }
        }
        return 0;
    };

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlSlice, 'text/html');

        values.basic_pay = getAmountFromLabel(doc, /^Basic Pay/i) || getItemRowAmount(doc, /^Basic Pay$/i);
        values.ot_pay = getAmountFromLabel(doc, /^OT Pay/i) || getItemRowAmount(doc, /^OT Pay$/i);
        values.sun_ph_pay = getAmountFromLabel(doc, /^Sun\/PH/i) || getItemRowAmount(doc, /^Sunday\/PH Pay$/i);
        values.monthly_allowance = getAmountFromLabel(doc, /^Monthly Allowance/i) || getItemRowAmount(doc, /^Monthly Allowance$/i);
        values.incentive_allowance = getAmountFromLabel(doc, /^Incentive(\s+Allowance)?$/i) || getItemRowAmount(doc, /^Incentive Allowance$/i);
        values.bonus = getAmountFromLabel(doc, /^Bonus$/i) || getItemRowAmount(doc, /^Bonus$/i);
        values.cpf_employee = getAmountFromLabel(doc, /^CPF Employee/i) || getItemRowAmount(doc, /^CPF Employee/i);
        values.cpf_employer = getAmountFromLabel(doc, /^CPF Employer/i) || getItemRowAmount(doc, /^CPF Employer/i);
        values.sinda = getAmountFromLabel(doc, /^SINDA$/i) || getItemRowAmount(doc, /^SINDA$/i);
        values.sdl = getAmountFromLabel(doc, /^SDL/i) || getItemRowAmount(doc, /^SDL/i);

        const amountLabels = doc.querySelectorAll('.amount-label');
        const amountFromTotalLabel = (labelText) => {
            for (const el of amountLabels) {
                if (el.textContent.trim() !== labelText) continue;
                const box = el.closest('.salary-box') || el.parentElement;
                const amountEl = box?.querySelector('.amount-large') || el.nextElementSibling || el.previousElementSibling;
                if (amountEl) return extractAmount(amountEl.textContent);
            }
            return 0;
        };
        values.total_additions = amountFromTotalLabel('TOTAL ADDITIONS');
        values.total_deductions = amountFromTotalLabel('TOTAL DEDUCTIONS');
        values.net_pay = amountFromTotalLabel('NET PAY');

        if (!values.total_additions) values.total_additions = getItemRowAmount(doc, /^Total Additions$/i);
        if (!values.total_deductions) values.total_deductions = getItemRowAmount(doc, /^Total Deductions$/i);
        if (!values.net_pay) {
            const totalAmt = doc.querySelector('.total-section .total-amount');
            if (totalAmt) values.net_pay = extractAmount(totalAmt.textContent);
        }

        const pick = (re) => {
            const m = htmlSlice.match(re);
            return m ? parseMoney(m[1] || m[0]) : 0;
        };
        const hasModernSalaryGrid = !!doc.querySelector('.salary-box.addition-box');
        if (!hasModernSalaryGrid) {
            if (!values.basic_pay) values.basic_pay = pick(/Basic Pay[^$]*\$([\d,]+\.?\d*)/i);
            if (!values.ot_pay) values.ot_pay = pick(/OT Pay[^$]*\$([\d,]+\.?\d*)/i);
            if (!values.sun_ph_pay) {
                values.sun_ph_pay = pick(/Sun\/PH[^$]*\$([\d,]+\.?\d*)/i) || pick(/Sunday\/PH Pay[^$]*\$([\d,]+\.?\d*)/i);
            }
            if (!values.cpf_employee) values.cpf_employee = pick(/CPF Employee[^$]*\$([\d,]+\.?\d*)/i);
            if (!values.cpf_employer) values.cpf_employer = pick(/CPF Employer[^$]*\$([\d,]+\.?\d*)/i);
            if (!values.sinda) values.sinda = pick(/\bSINDA[^$]*\$([\d,]+\.?\d*)/i);
            if (!values.sdl) values.sdl = pick(/\bSDL[^$]*\$([\d,]+\.?\d*)/i);
            if (!values.net_pay) {
                values.net_pay = pick(/NET PAY[^$]*\$([\d,]+\.?\d*)/i) || pick(/Total Salary[^$]*\$([\d,]+\.?\d*)/i);
            }
        }
    } catch {
        /* return partial zeros */
    }

    return values;
}

function emptyPayslipRow() {
    return {
        basic_pay: 0,
        ot_pay: 0,
        sun_ph_pay: 0,
        monthly_allowance: 0,
        incentive_allowance: 0,
        bonus: 0,
        total_additions: 0,
        cpf_employee: 0,
        cpf_employer: 0,
        sinda: 0,
        sdl: 0,
        other_deductions: 0,
        total_deductions: 0,
        net_pay: 0,
    };
}

function sumCustomDeductions(deductions) {
    if (!Array.isArray(deductions)) return 0;
    return deductions.reduce((s, d) => {
        const type = String(d?.type || '').toLowerCase();
        if (!type || type.includes('cpf') || type.includes('sinda')) return s;
        return s + n(d?.amount);
    }, 0);
}

/** Normalize one passed_out_payslips row into summary numbers. */
export function parsePassedOutPayslipRecord(payslip) {
    const extracted = extractPayslipValuesFromHtml(payslip?.payslip_html);
    const merged = applySysOverridesToExtracted(
        {
            basic_pay: extracted.basic_pay,
            ot_pay: extracted.ot_pay,
            sun_ph_pay: extracted.sun_ph_pay,
            monthly_allowance: extracted.monthly_allowance,
            incentive_allowance: extracted.incentive_allowance,
            bonus: extracted.bonus,
            total_additions: extracted.total_additions,
            total_deductions: extracted.total_deductions,
            net_pay: extracted.net_pay,
            cpf_employee_deduction: extracted.cpf_employee,
            sinda_deduction: extracted.sinda,
        },
        payslip?.additions || [],
    );

    const otherDed = sumCustomDeductions(payslip?.deductions);

    const row = {
        basic_pay: n(merged.basic_pay),
        ot_pay: n(merged.ot_pay),
        sun_ph_pay: n(merged.sun_ph_pay),
        monthly_allowance: n(merged.monthly_allowance),
        incentive_allowance: n(merged.incentive_allowance),
        bonus: n(merged.bonus),
        cpf_employee: n(merged.cpf_employee_deduction) || extracted.cpf_employee,
        cpf_employer: extracted.cpf_employer,
        sinda: n(merged.sinda_deduction) || extracted.sinda,
        sdl: extracted.sdl,
        other_deductions: otherDed,
        total_additions: n(merged.total_additions),
        total_deductions: n(merged.total_deductions) || (n(merged.cpf_employee_deduction) + n(merged.sinda_deduction) + otherDed),
        net_pay: n(merged.net_pay),
    };

    if (!row.total_additions) {
        row.total_additions =
            row.basic_pay + row.ot_pay + row.sun_ph_pay + row.monthly_allowance + row.incentive_allowance + row.bonus;
    }
    if (!row.net_pay && row.total_additions) {
        row.net_pay = row.total_additions - row.total_deductions;
    }

    return row;
}

function payslipYear(payslip) {
    const d = payslip?.start_date || payslip?.end_date || payslip?.salary_paid_date;
    if (!d) return null;
    const y = parseInt(String(d).slice(0, 4), 10);
    return Number.isNaN(y) ? null : y;
}

function payslipMonth(payslip) {
    const d = payslip?.start_date || payslip?.end_date;
    if (!d) return null;
    const m = parseInt(String(d).slice(5, 7), 10);
    return Number.isNaN(m) ? null : m;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addRows(a, b) {
    const keys = Object.keys(emptyPayslipRow());
    const out = {};
    for (const k of keys) out[k] = n(a[k]) + n(b[k]);
    return out;
}

/**
 * Build monthly rows + year totals from passed-out payslips for a calendar year.
 */
export function aggregateYearlyPaySummary(payslips, year) {
    const y = parseInt(year, 10);
    const filtered = (payslips || []).filter((p) => payslipYear(p) === y);

    const byMonth = new Map();
    for (const p of filtered) {
        const m = payslipMonth(p) || 1;
        const parsed = parsePassedOutPayslipRecord(p);
        const existing = byMonth.get(m);
        byMonth.set(m, existing ? addRows(existing, parsed) : parsed);
    }

    const months = [...byMonth.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([monthNum, values]) => ({
            month: monthNum,
            label: MONTH_NAMES[monthNum - 1] || `M${monthNum}`,
            periodLabel: `${MONTH_NAMES[monthNum - 1] || monthNum} ${y}`,
            ...values,
        }));

    let totals = emptyPayslipRow();
    for (const row of months) {
        totals = addRows(totals, row);
    }

    return { year: y, months, totals, payslipCount: filtered.length };
}

function documentStyles() {
    return `
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #0f172a;
      font-size: 11pt;
      line-height: 1.45;
      margin: 0;
      padding: 24px;
    }
    .doc-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 2px solid #1e293b;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .doc-header img { max-height: 56px; max-width: 140px; object-fit: contain; }
    .company-name { font-size: 1.15rem; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
    .company-meta { font-size: 0.8rem; color: #64748b; margin: 0; }
    .doc-title {
      font-size: 1.35rem;
      font-weight: 700;
      text-align: center;
      margin: 0 0 6px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .doc-subtitle {
      text-align: center;
      color: #64748b;
      font-size: 0.85rem;
      margin: 0 0 22px;
    }
    .section-title {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #475569;
      margin: 22px 0 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e2e8f0;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .info-table th,
    .info-table td {
      border: 1px solid #e2e8f0;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .info-table th {
      width: 34%;
      background: #f8fafc;
      font-weight: 600;
      color: #334155;
    }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    .summary-table th,
    .summary-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 5px;
      text-align: right;
    }
    .summary-table th {
      background: #1e293b;
      color: #f8fafc;
      font-weight: 600;
      text-align: center;
    }
    .summary-table td.month-col { text-align: left; font-weight: 600; background: #f8fafc; }
    .summary-table tr.totals-row td {
      background: #fef3c7;
      font-weight: 700;
      border-top: 2px solid #b45309;
    }
    .footer-note {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 0.75rem;
      color: #64748b;
    }
    .signatures {
      display: flex;
      gap: 32px;
      margin-top: 36px;
    }
    .sig-block { flex: 1; text-align: center; font-size: 0.8rem; }
    .sig-line { border-bottom: 1px solid #334155; height: 40px; margin-bottom: 8px; }
    @media print { body { padding: 0; } }
  `;
}

function workerProfileStyles() {
    return `
    ${documentStyles()}
    body.profile-doc {
      padding: 28px 32px;
      background: #fff;
    }
    .profile-top-bar {
      height: 4px;
      background: linear-gradient(90deg, #b45309 0%, #d97706 45%, #1e293b 100%);
      margin: -28px -32px 24px;
      border-radius: 0;
    }
    .profile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 28px;
    }
    .profile-header img {
      max-height: 64px;
      max-width: 150px;
      object-fit: contain;
    }
    .profile-company-name {
      font-size: 1.2rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px;
      letter-spacing: -0.01em;
    }
    .profile-company-meta {
      font-size: 0.82rem;
      color: #64748b;
      margin: 0;
      line-height: 1.4;
    }
    .profile-hero {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border: 1px solid #e2e8f0;
      border-left: 4px solid #b45309;
      border-radius: 10px;
      padding: 20px 24px;
      margin-bottom: 28px;
    }
    .profile-hero-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #b45309;
      margin: 0 0 6px;
    }
    .profile-hero-name {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px;
      letter-spacing: -0.02em;
    }
    .profile-hero-meta {
      font-size: 0.9rem;
      color: #475569;
      margin: 0;
    }
    .profile-hero-badge {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #fff;
      border: 1px solid #cbd5e1;
      color: #334155;
    }
    .profile-hero-badge.active { border-color: #86efac; background: #f0fdf4; color: #166534; }
    .profile-hero-badge.inactive { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    .profile-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    @media (max-width: 640px) { .profile-grid { grid-template-columns: 1fr; } }
    .profile-card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .profile-card-title {
      margin: 0;
      padding: 10px 14px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #fff;
      background: #1e293b;
    }
    .profile-card table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    .profile-card th,
    .profile-card td {
      padding: 9px 14px;
      border-bottom: 1px solid #f1f5f9;
      text-align: left;
      vertical-align: top;
    }
    .profile-card tr:last-child th,
    .profile-card tr:last-child td { border-bottom: none; }
    .profile-card th {
      width: 42%;
      font-weight: 600;
      color: #64748b;
      background: #fafbfc;
    }
    .profile-card td {
      font-weight: 500;
      color: #0f172a;
    }
    .profile-footer {
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      font-size: 0.72rem;
      color: #94a3b8;
      text-align: center;
    }
  `;
}

function formatRejoinDates(worker) {
    const dates = parseRejoinDatesFromWorker(worker);
    return dates.length ? dates.join(', ') : '—';
}

function profileCard(title, rows) {
    const body = rows
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
        .join('');
    return `
    <div class="profile-card">
      <h2 class="profile-card-title">${esc(title)}</h2>
      <table><tbody>${body}</tbody></table>
    </div>`;
}

export function buildWorkerProfilePrintHtml({ worker, workerType, logoUrl }) {
    const displayName = worker.employee_name || worker.name || worker.employee_id;
    const notInCompany = workerIsNotInCompany(worker);
    const typeLabel = workerType === 'local' ? 'Local employee (Singapore / PR)' : 'Foreign employee (work pass)';
    const statusBadge = notInCompany
        ? '<span class="profile-hero-badge inactive">Not in company</span>'
        : '<span class="profile-hero-badge active">Active</span>';

    const employmentRows = [
        ['Employee ID', worker.employee_id],
        ['NRIC / FIN', worker.nric_fin],
        ['Designation', worker.designation],
        ['Worker category', typeLabel],
        ['Date joined', worker.date_joined ? formatDate(worker.date_joined) : '—'],
        ['Date of cessation', worker.date_of_cessation ? formatDate(worker.date_of_cessation) : '—'],
        ['Rejoin date(s)', formatRejoinDates(worker)],
    ];

    const compensationRows = [
        ['Basic salary (monthly)', formatMoney(worker.basic_salary_per_day)],
        ['Monthly allowance', formatMoney(worker.monthly_allowance)],
        ['OT rate (per hour)', formatMoney(worker.ot_rate_per_hour)],
        ['Sunday / PH rate (per day)', formatMoney(worker.sun_ph_rate_per_day)],
        ['Bank account', worker.bank_account_number],
    ];

    const leaveRows = [
        ['Annual leave', `${worker.annual_leave_balance ?? '—'} / ${worker.annual_leave_limit ?? '—'}`],
        ['Medical leave', `${worker.medical_leave_balance ?? '—'} / ${worker.medical_leave_limit ?? '—'}`],
    ];

    const statutoryRows =
        workerType === 'local'
            ? [
                  ['Date of birth', worker.birthday ? formatDate(worker.birthday) : '—'],
                  ['CPF employee rate', worker.cpf_employee_contribution != null ? `${worker.cpf_employee_contribution}%` : '—'],
                  ['CPF employer rate', worker.cpf_employer_contribution != null ? `${worker.cpf_employer_contribution}%` : '—'],
                  ['SINDA (configured)', formatMoney(worker.sinda_contribution)],
              ]
            : [];

    const gridRow1 = `
    <div class="profile-grid">
      ${profileCard('Employment particulars', employmentRows)}
      ${profileCard('Compensation & banking', compensationRows)}
    </div>`;

    const gridRow2 =
        workerType === 'local'
            ? `<div class="profile-grid">
        ${profileCard('Leave entitlements', leaveRows)}
        ${profileCard('Statutory & local records', statutoryRows)}
      </div>`
            : `<div class="profile-grid">
        ${profileCard('Leave entitlements', leaveRows)}
      </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Employee Record — ${esc(displayName)}</title>
  <style>${workerProfileStyles()}</style>
</head>
<body class="profile-doc">
  <div class="profile-top-bar"></div>

  <div class="profile-header">
    <div>
      <p class="profile-company-name">${esc(COMPANY.name)}</p>
      <p class="profile-company-meta">${esc(COMPANY.address)}</p>
    </div>
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="Company logo" />` : ''}
  </div>

  <div class="profile-hero">
    <p class="profile-hero-label">Employee information record</p>
    <h1 class="profile-hero-name">${esc(displayName)}</h1>
    <p class="profile-hero-meta">ID ${esc(worker.employee_id)}${worker.designation ? ` · ${esc(worker.designation)}` : ''}</p>
    ${statusBadge}
  </div>

  ${gridRow1}
  ${gridRow2}

  <p class="profile-footer">Confidential — HR &amp; payroll use only · AKK Timesheet Manager</p>
</body>
</html>`;
}

export function buildYearlyPaySummaryPrintHtml({ worker, workerType, summary, logoUrl }) {
    const displayName = worker.employee_name || worker.name || worker.employee_id;
    const typeLabel = workerType === 'local' ? 'Local' : 'Foreign';
    const generatedAt = new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
    const { year, months, totals, payslipCount } = summary;

    const moneyCols = [
        ['basic_pay', 'Basic'],
        ['ot_pay', 'OT'],
        ['sun_ph_pay', 'Sun/PH'],
        ['monthly_allowance', 'Allow.'],
        ['incentive_allowance', 'Incent.'],
        ['bonus', 'Bonus'],
        ['total_additions', 'Gross'],
        ['cpf_employee', 'CPF (EE)'],
        ['sinda', 'SINDA'],
        ['other_deductions', 'Other ded.'],
        ['total_deductions', 'Total ded.'],
        ['net_pay', 'Net pay'],
    ];

    if (workerType === 'local') {
        moneyCols.splice(11, 0, ['cpf_employer', 'CPF (ER)'], ['sdl', 'SDL']);
    }

    const headerCells = moneyCols.map(([, label]) => `<th>${esc(label)}</th>`).join('');
    const monthRows = months
        .map((row) => {
            const cells = moneyCols.map(([key]) => `<td>${formatMoney(row[key])}</td>`).join('');
            return `<tr><td class="month-col">${esc(row.periodLabel)}</td>${cells}</tr>`;
        })
        .join('');

    const totalCells = moneyCols
        .map(([key]) => `<td>${formatMoney(totals[key])}</td>`)
        .join('');

    const emptyRow =
        months.length === 0
            ? `<tr><td colspan="${moneyCols.length + 1}" style="text-align:center;padding:16px;color:#64748b;">No passed-out payslips found for ${year}.</td></tr>`
            : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Yearly Pay Summary ${year} — ${esc(displayName)}</title>
  <style>${documentStyles()}</style>
</head>
<body>
  <div class="doc-header">
    <div>
      <p class="company-name">${esc(COMPANY.name)}</p>
      <p class="company-meta">${esc(COMPANY.address)}</p>
    </div>
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="Company logo" />` : ''}
  </div>
  <h1 class="doc-title">Yearly Pay Summary</h1>
  <p class="doc-subtitle">Calendar year ${year} · ${esc(displayName)} (${esc(worker.employee_id)}) · ${esc(typeLabel)} · ${payslipCount} passed-out payslip(s) · Generated ${esc(generatedAt)}</p>

  <table class="info-table" style="margin-bottom:18px;">
    <tbody>
      <tr><th>Employee</th><td>${esc(displayName)}</td></tr>
      <tr><th>Employee ID</th><td>${esc(worker.employee_id)}</td></tr>
      <tr><th>Designation</th><td>${esc(worker.designation || '—')}</td></tr>
      <tr><th>Summary year</th><td>${year}</td></tr>
    </tbody>
  </table>

  <h2 class="section-title">Monthly breakdown (from passed-out payslips)</h2>
  <table class="summary-table">
    <thead>
      <tr><th>Month</th>${headerCells}</tr>
    </thead>
    <tbody>
      ${monthRows || emptyRow}
      ${months.length > 0 ? `<tr class="totals-row"><td class="month-col">YEAR TOTAL</td>${totalCells}</tr>` : ''}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-block"><div class="sig-line"></div>Prepared by (Admin)</div>
    <div class="sig-block"><div class="sig-line"></div>Authorised signatory</div>
  </div>

  <p class="footer-note">Figures are aggregated from payslips passed out to the employee portal for ${year}. CPF (ER) and SDL are employer costs where shown. Use individual monthly payslips for audit detail. EE = employee, ER = employer.</p>
</body>
</html>`;
}

export async function openWorkerDocumentPrint(html, options = {}) {
    const { title = 'Print worker document', fileName } = options;
    try {
        return await printOrShareHtmlDocument(html, {
            title,
            fileName,
            printDelayMs: 350,
        });
    } catch (error) {
        throw new Error(error?.message || 'Print could not be prepared in this browser');
    }
}

export async function printWorkerProfile({ worker, workerType, logoUrl }) {
    const displayName = worker.employee_name || worker.name || worker.employee_id;
    const html = buildWorkerProfilePrintHtml({ worker, workerType, logoUrl });
    return openWorkerDocumentPrint(html, {
        title: 'Employee record',
        fileName: `Employee_Record_${String(displayName).replace(/[^\w-]+/g, '_').slice(0, 40)}_${Date.now()}.pdf`,
    });
}

export async function printYearlyPaySummary({ worker, workerType, payslips, year, logoUrl }) {
    const summary = aggregateYearlyPaySummary(payslips, year);
    if (summary.payslipCount === 0) {
        throw new Error(`No passed-out payslips found for ${year}`);
    }
    const displayName = worker.employee_name || worker.name || worker.employee_id;
    const html = buildYearlyPaySummaryPrintHtml({ worker, workerType, summary, logoUrl });
    return openWorkerDocumentPrint(html, {
        title: `Yearly pay summary ${year}`,
        fileName: `Pay_Summary_${year}_${String(displayName).replace(/[^\w-]+/g, '_').slice(0, 40)}.pdf`,
    });
}
