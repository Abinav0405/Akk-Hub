/**
 * Employee ID cards API (core.* functions in migration/sql/91_cards.sql).
 * Holder / scanner calls carry the hub session token (workers, supervisors, managers); admins and
 * materials staff are recognised by their sign-in. The public verify works with no sign-in.
 */
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';

async function rpc(fn, args = {}) {
    if (!UNIFIED) throw new Error('ID cards need the one AKK Hub backend.');
    const { data, error } = await supabaseCore.rpc(fn, args);
    if (error) throw new Error(error.message || 'Something went wrong.');
    return data;
}
const token = () => getRoleSessionToken() || null;

export const cardsMe = {
    /** employeeId: which linked ID to show (staff logins linked to several IDs) */
    card: (employeeId = null) => rpc('my_card', { p_token: token(), p_employee_id: employeeId }),
    choices: () => rpc('my_card_choices', { p_token: token() }),
    liveCode: (employeeId = null) => rpc('my_card_live_code', { p_token: token(), p_employee_id: employeeId }),
};

export const cardsScan = {
    /** purpose: verify | site | clock | materials | vehicle; place: core.sites id for the site check */
    verify: (code, purpose = 'verify', place = null) => rpc('card_verify', { p_code: code, p_token: token(), p_purpose: purpose, p_place: place }),
    clockContext: (code) => rpc('card_clock_context', { p_code: code, p_token: token() }),
};

export const cardsAdmin = {
    list: () => rpc('admin_cards'),
    detail: (employeeId) => rpc('admin_card_detail', { p_employee_id: employeeId }),
    renew: (employeeId, reason) => rpc('admin_card_renew', { p_employee_id: employeeId, p_reason: reason || null }),
    cancel: (employeeId, reason) => rpc('admin_card_void', { p_employee_id: employeeId, p_reason: reason }),
    forPrint: (employeeIds) => rpc('admin_cards_for_print', { p_employee_ids: employeeIds }),
    linkable: () => rpc('admin_linkable_accounts'),
    link: (employeeId, login) => rpc('admin_link_account', { p_employee_id: employeeId, p_login: login }),
    unlink: (login, employeeId) => rpc('admin_unlink_account', { p_login: login, p_employee_id: employeeId }),
    scans: (limit = 200) => rpc('admin_card_scans', { p_limit: limit }),
};
