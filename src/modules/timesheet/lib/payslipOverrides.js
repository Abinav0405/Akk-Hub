/**
 * Persist admin payslip edits: JSONB additions store _sys_* rows as source of truth,
 * and patchPayslipHtml updates stored HTML so worker view/print match the report.
 */

export const SYS_PREFIX = '_sys_';

export function stripSysAdditions(additions) {
    if (!Array.isArray(additions)) return [];
    return additions.filter((a) => a && typeof a.name === 'string' && !a.name.startsWith(SYS_PREFIX));
}

function n(x) {
    const v = parseFloat(x);
    return Number.isFinite(v) ? v : 0;
}

/** Sum of user-defined custom addition line items (excludes _sys_* rows). */
export function sumCustomAdditions(additions) {
    return stripSysAdditions(additions || []).reduce((s, a) => s + n(a.value), 0);
}

/**
 * Build persisted override rows so extract + applySysOverrides match admin edits.
 */
export function buildSysOverrideRows(updates) {
    const userAdds = stripSysAdditions(updates.custom_additions || []);
    const totalAdd =
        n(updates.basic_pay) +
        n(updates.ot_pay) +
        n(updates.sun_ph_pay) +
        n(updates.monthly_allowance) +
        n(updates.incentive_allowance) +
        n(updates.bonus) +
        userAdds.reduce((s, a) => s + n(a.value), 0);
    // other_deductions = custom deduction lines (loans, advances, …) kept from the issued payslip.
    const totalDed = n(updates.cpf_employee_deduction) + n(updates.sinda_deduction) + n(updates.other_deductions);
    const net = totalAdd - totalDed;
    return [
        { name: `${SYS_PREFIX}basic_pay`, value: String(n(updates.basic_pay)) },
        { name: `${SYS_PREFIX}ot_pay`, value: String(n(updates.ot_pay)) },
        { name: `${SYS_PREFIX}sun_ph_pay`, value: String(n(updates.sun_ph_pay)) },
        { name: `${SYS_PREFIX}monthly_allowance`, value: String(n(updates.monthly_allowance)) },
        { name: `${SYS_PREFIX}incentive_allowance`, value: String(n(updates.incentive_allowance)) },
        { name: `${SYS_PREFIX}bonus`, value: String(n(updates.bonus)) },
        { name: `${SYS_PREFIX}total_additions`, value: String(totalAdd) },
        { name: `${SYS_PREFIX}total_deductions`, value: String(totalDed) },
        { name: `${SYS_PREFIX}net_pay`, value: String(net) },
        { name: `${SYS_PREFIX}cpf_employee_deduction`, value: String(n(updates.cpf_employee_deduction)) },
        { name: `${SYS_PREFIX}sinda_deduction`, value: String(n(updates.sinda_deduction)) }
    ];
}

export function mergeAdditionsWithSysOverrides(rawAdditions, updates) {
    const user = stripSysAdditions(rawAdditions || []);
    return [...user, ...buildSysOverrideRows({ ...updates, custom_additions: user })];
}

const SYS_KEYS = [
    'basic_pay',
    'ot_pay',
    'sun_ph_pay',
    'monthly_allowance',
    'incentive_allowance',
    'bonus',
    'total_additions',
    'total_deductions',
    'net_pay',
    'cpf_employee_deduction',
    'sinda_deduction'
];

/**
 * Overlay DB-stored admin overrides onto values parsed from HTML.
 */
export function applySysOverridesToExtracted(extracted, additions) {
    const out = { ...(extracted || {}) };
    const arr = additions || [];
    for (const k of SYS_KEYS) {
        const row = arr.find((x) => x?.name === `${SYS_PREFIX}${k}`);
        if (row != null && row.value !== undefined && row.value !== '') {
            const num = parseFloat(row.value);
            if (Number.isFinite(num)) out[k] = num;
        }
    }
    return out;
}

function formatMoney(val) {
    const x = Number(val);
    const safe = Number.isFinite(x) ? x : 0;
    return `$${safe.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setGridAmount(doc, labelRe, value) {
    const labels = doc.querySelectorAll('.amount-label');
    for (const label of labels) {
        const txt = label.textContent.trim();
        if (labelRe.test(txt)) {
            const box = label.closest('.salary-box') || label.parentElement;
            const amountEl = box?.querySelector('.amount-large') || label.nextElementSibling;
            if (amountEl) {
                amountEl.textContent = formatMoney(value);
                return true;
            }
        }
    }
    return false;
}

function setLegacyItemAmount(doc, labelRe, value) {
    const candidates = doc.querySelectorAll('.earnings-row .item-label, .deductions-row .item-label');
    for (const lab of candidates) {
        if (labelRe.test(lab.textContent.trim())) {
            const row = lab.closest('.earnings-row, .deductions-row') || lab.parentElement;
            const amt = row?.querySelector('.item-amount') || lab.nextElementSibling;
            if (amt) {
                amt.textContent = formatMoney(value);
                return true;
            }
        }
    }
    return false;
}

function setAmountBoth(doc, labelReGrid, labelReLegacy, value) {
    if (setGridAmount(doc, labelReGrid, value)) return;
    setLegacyItemAmount(doc, labelReLegacy, value);
}

/**
 * Patch stored payslip HTML so amounts match admin edit form (grid + legacy templates).
 */
export function patchPayslipHtml(html, updates) {
    if (!html || typeof html !== 'string') return html;
    const userAdds = stripSysAdditions(updates.custom_additions || []);
    const totalAdd =
        n(updates.basic_pay) +
        n(updates.ot_pay) +
        n(updates.sun_ph_pay) +
        n(updates.monthly_allowance) +
        n(updates.incentive_allowance) +
        n(updates.bonus) +
        userAdds.reduce((s, a) => s + n(a.value), 0);
    // other_deductions = custom deduction lines (loans, advances, …) kept from the issued payslip.
    const totalDed = n(updates.cpf_employee_deduction) + n(updates.sinda_deduction) + n(updates.other_deductions);
    const net = totalAdd - totalDed;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        setAmountBoth(doc, /^Basic Pay$/i, /^Basic Pay$/i, n(updates.basic_pay));
        setAmountBoth(doc, /^OT Pay$/i, /^OT Pay$/i, n(updates.ot_pay));
        setAmountBoth(doc, /^Sun\/PH/i, /^Sunday\/PH Pay$/i, n(updates.sun_ph_pay));
        setAmountBoth(doc, /^Monthly Allowance$/i, /^Monthly Allowance$/i, n(updates.monthly_allowance));
        setAmountBoth(doc, /^Incentive(\s+Allowance)?$/i, /^Incentive Allowance$/i, n(updates.incentive_allowance));
        setAmountBoth(doc, /^Bonus$/i, /^Bonus$/i, n(updates.bonus));
        setAmountBoth(doc, /^CPF Employee/i, /^CPF Employee/i, n(updates.cpf_employee_deduction));
        setAmountBoth(doc, /^SINDA$/i, /^SINDA$/i, n(updates.sinda_deduction));

        setGridAmount(doc, /^TOTAL ADDITIONS$/i, totalAdd);
        setGridAmount(doc, /^TOTAL DEDUCTIONS$/i, totalDed);
        const netPatched = setGridAmount(doc, /^NET PAY$/i, net);
        if (!netPatched) {
            setLegacyItemAmount(doc, /^Total Additions$/i, totalAdd);
            setLegacyItemAmount(doc, /^Total Deductions$/i, totalDed);
            const totalSalary = doc.querySelector('.total-section .total-amount');
            if (totalSalary) totalSalary.textContent = formatMoney(net);
        }

        const root = doc.documentElement;
        return root ? new XMLSerializer().serializeToString(root) : html;
    } catch {
        return html;
    }
}
