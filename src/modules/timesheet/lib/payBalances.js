/**
 * Pay balances ("vouchers") — money carried between payslips.
 *
 *   owed_to_worker: earned more than was paid (e.g. $1,000 earned, $800 paid → $200).
 *                   Used later as an ADDITION.
 *   owed_by_worker: paid more than was earned, or a cash advance. Used later as a DEDUCTION.
 *
 * NET PAY on a payslip stays "earned this month" — CPF / SINDA / SDL / YTD are untouched.
 * Balances only adjust what is payable:  AMOUNT PAYABLE = NET PAY + owed_to − owed_by.
 * The database (migration 20261019130000) keeps remaining amounts and carry-forwards in step.
 */
import { supabaseTimesheet } from '@/core/supabase'
import { storageKey } from '@/core/storage'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${round2(Math.abs(n)).toFixed(2)}`;

export const DIRECTION_LABEL = {
    owed_to_worker: 'Owed to worker',
    owed_by_worker: 'Owed by worker',
};

export function periodLabel(year, month) {
    if (!year || !month) return '';
    return `${String(month).padStart(2, '0')}/${year}`;
}

/** "Unpaid salary (03/2026)" */
export function balanceTitle(balance) {
    const period = periodLabel(balance.source_year, balance.source_month);
    return period ? `${balance.reason || 'Balance'} (${period})` : balance.reason || 'Balance';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Open balances usable on a payslip for (year, month), grouped by worker_id.
 * A carry-forward from this month or later is never offered (it can't pay itself).
 */
export async function getOpenBalancesForPeriod(workerIds, year, month) {
    const map = new Map();
    if (!workerIds.length) return map;
    const { data, error } = await supabaseTimesheet
        .from('pay_balances')
        .select('*')
        .in('worker_id', workerIds.map(String))
        .eq('status', 'open')
        .order('created_at', { ascending: true });
    if (error) throw error;
    const periodKey = year * 12 + month;
    (data || [])
        .filter((b) => b.source === 'manual' || !b.source_year || b.source_year * 12 + b.source_month < periodKey)
        .forEach((b) => {
            const key = String(b.worker_id);
            map.set(key, [...(map.get(key) || []), b]);
        });
    return map;
}

/** All balances (optionally for one worker), newest first, with their uses. */
export async function listBalances({ workerId, includeClosed = true } = {}) {
    let q = supabaseTimesheet
        .from('pay_balances')
        .select('*, pay_balance_uses(id, amount, payslip_id, created_at)')
        .order('created_at', { ascending: false })
        .limit(500);
    if (workerId) q = q.eq('worker_id', String(workerId));
    if (!includeClosed) q = q.eq('status', 'open');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
}

/** A balance entered by hand (cash advance, money owed outside a payslip). */
export async function createManualBalance({ workerId, workerType, direction, amount, reason }) {
    const value = round2(amount);
    if (!(value > 0)) throw new Error('Enter an amount above $0.');
    const now = new Date();
    const { error } = await supabaseTimesheet.from('pay_balances').insert([{
        worker_id: String(workerId),
        worker_type: workerType,
        direction,
        original_amount: value,
        remaining_amount: value,
        reason: reason?.trim() || (direction === 'owed_by_worker' ? 'Advance' : 'Amount owed'),
        source: 'manual',
        source_year: now.getFullYear(),
        source_month: now.getMonth() + 1,
        created_by: localStorage.getItem(storageKey('timesheet', 'adminEmail')) || 'admin',
    }]);
    if (error) throw error;
}

export async function cancelBalance(balanceId, reason) {
    const { error } = await supabaseTimesheet
        .from('pay_balances')
        .update({ status: 'cancelled', cancel_reason: reason || '', cancelled_at: new Date().toISOString() })
        .eq('id', balanceId);
    if (error) throw error;
}

/**
 * Record the balances a payslip uses and what was actually paid (creates the carry-forward).
 * @param {{ payslipId: number, netPay: number, uses: {balance_id: string, amount: number}[], amountPaid: number|null }} args
 */
export async function applyPayslipBalances({ payslipId, netPay, uses = [], amountPaid = null }) {
    const { data, error } = await supabaseTimesheet.rpc('apply_payslip_balances', {
        p_payslip_id: payslipId,
        p_net_pay: round2(netPay),
        p_uses: uses.filter((u) => round2(u.amount) > 0).map((u) => ({ balance_id: u.balance_id, amount: round2(u.amount) })),
        p_amount_paid: amountPaid === null || amountPaid === '' || amountPaid === undefined ? null : round2(amountPaid),
    });
    if (error) throw error;
    return data;
}

/** Friendly text for errors raised by the balance functions / triggers. */
export function balanceErrorMessage(error) {
    const msg = String(error?.message || '');
    if (msg.includes('carry_balance_in_use')) {
        return 'The balance carried forward from this payslip has already been used on a later payslip. Change that payslip first.';
    }
    if (msg.includes('balance_amount_too_high')) return 'A balance was used for more than what is left on it. Refresh and try again.';
    if (msg.includes('balance_not_usable') || msg.includes('balance_not_found')) {
        return 'One of the selected balances can no longer be used. Refresh and try again.';
    }
    if (msg.includes('not_authorized')) return 'Only an admin can change pay balances.';
    return '';
}

// ---------------------------------------------------------------------------
// Selection → payslip lines
// ---------------------------------------------------------------------------

/**
 * selection: { [balanceId]: amountString } for the balances ticked in the picker.
 * Returns { uses, lines, adjustment } — lines carry the label/sign printed on the payslip.
 */
export function selectionToLines(balances = [], selection = {}) {
    const uses = [];
    const lines = [];
    let adjustment = 0;
    for (const b of balances) {
        if (!(b.id in selection)) continue;
        const amount = Math.min(round2(selection[b.id]), round2(b.remaining_amount));
        if (!(amount > 0)) continue;
        const sign = b.direction === 'owed_to_worker' ? 1 : -1;
        uses.push({ balance_id: b.id, amount });
        lines.push({
            label: b.direction === 'owed_to_worker' ? `Brought forward – ${balanceTitle(b)}` : `Recovery – ${balanceTitle(b)}`,
            amount: sign * amount,
        });
        adjustment += sign * amount;
    }
    return { uses, lines, adjustment: round2(adjustment) };
}

/** Lines from a stored payslip's balances_applied snapshot (used when editing). */
export function appliedToLines(applied = []) {
    return (applied || []).map((a) => ({
        label: a.direction === 'owed_to_worker'
            ? `Brought forward – ${balanceTitle(a)}`
            : `Recovery – ${balanceTitle(a)}`,
        amount: (a.direction === 'owed_to_worker' ? 1 : -1) * round2(a.amount),
    }));
}

// ---------------------------------------------------------------------------
// Payslip HTML block (rendered below NET PAY)
// ---------------------------------------------------------------------------

/**
 * Builds the "Balances" block. Uses its own classes/labels (not .salary-box / NET PAY) so the
 * existing payslip parsers keep reading NET PAY and totals exactly as before.
 * Returns { html, payable, paid, carry } — html is '' when there is nothing to show.
 */
export function buildBalanceSection({ netPay, lines = [], amountPaid = null }) {
    const adjustment = round2(lines.reduce((s, l) => s + l.amount, 0));
    const payable = round2(netPay + adjustment);
    const paid = amountPaid === null || amountPaid === '' || amountPaid === undefined ? payable : round2(amountPaid);
    const carry = round2(payable - paid);
    if (!lines.length && carry === 0) return { html: '', payable, paid, carry };

    const row = (label, value, color, key = '') => `
        <div class="balance-row" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;">
            <span class="balance-label">${label}</span>
            <span class="balance-amount"${key ? ` data-bal="${key}"` : ''} style="font-weight:600;color:${color};">${value}</span>
        </div>`;

    const lineRows = lines
        .map((l) => row(l.label, `${l.amount >= 0 ? '+' : '-'}${money(l.amount)}`, l.amount >= 0 ? '#2e7d32' : '#c62828'))
        .join('');
    const carryText =
        carry > 0
            ? `Carried forward: ${money(carry)} still owed to you`
            : carry < 0
              ? `Carried forward: ${money(carry)} to be recovered from a later payslip`
              : '';

    const html = `
                        <!-- Balances -->
                        <div class="balance-section" data-balance-section="1" style="margin:0 0 12px 0;padding:10px 12px;border:1px solid #cfd8dc;border-radius:8px;background:#fafafa;page-break-inside:avoid;">
                            <div style="font-size:12px;font-weight:600;color:#37474f;margin-bottom:4px;">Balances</div>
                            ${lineRows}
                            <div style="border-top:1px dashed #b0bec5;margin:6px 0 2px 0;"></div>
                            ${row('<strong>AMOUNT PAYABLE</strong>', money(payable), '#0d47a1', 'payable')}
                            ${row('AMOUNT PAID', money(paid), '#0d47a1', 'paid')}
                            ${carryText ? `<p class="balance-carry" data-bal="carry" style="margin:6px 0 0 0;font-size:11px;color:#455a64;font-style:italic;">${carryText}</p>` : ''}
                        </div>`;
    return { html, payable, paid, carry };
}

/** Swap (or add, after NET PAY) the balances block in stored payslip HTML. */
export function replaceBalanceSection(html, sectionHtml) {
    if (!html) return html;
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const existing = doc.querySelector('[data-balance-section]');
        const tmp = doc.createElement('div');
        tmp.innerHTML = sectionHtml || '';
        const fresh = tmp.firstElementChild;
        if (existing) {
            if (fresh) existing.replaceWith(fresh);
            else existing.remove();
        } else if (fresh) {
            const netLabel = [...doc.querySelectorAll('.amount-label')].find((el) => /^NET PAY$/i.test(el.textContent.trim()));
            const netBox = netLabel?.closest('.salary-box');
            if (!netBox) return html;
            netBox.after(fresh);
        } else {
            return html;
        }
        return new XMLSerializer().serializeToString(doc.documentElement);
    } catch {
        return html;
    }
}
