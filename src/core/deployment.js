/**
 * Deployment API (one AKK Hub backend, core.dep_* functions). Admins are identified by their
 * Supabase sign-in (carried by supabaseCore); managers / supervisors / workers by their hub
 * role-session token.
 */
import { UNIFIED, supabaseCore } from '@/core/supabase';
import { getRoleSessionToken } from '@/core/auth/timesheetSession';

async function call(fn, args = {}) {
    if (!UNIFIED) throw new Error('Deployment needs the one AKK Hub backend.');
    const { data, error } = await supabaseCore.rpc(fn, { p_token: getRoleSessionToken() || null, ...args });
    if (error) throw new Error(error.message || 'Something went wrong.');
    return data;
}

export const deploymentApi = {
    board: (from, to) => call('dep_board', { p_from: from, p_to: to }),
    saveDay: (day, payload, rev) => call('dep_save_day', { p_day: day, p_payload: payload, p_rev: rev ?? null }),
    discardDay: (day) => call('dep_discard_day', { p_day: day }),
    publish: (day, rev) => call('dep_publish', { p_day: day, p_rev: rev ?? null }),
    copyDay: (from, to) => call('dep_copy_day', { p_from: from, p_to: to }),
    saveTemplate: (name, day) => call('dep_save_template', { p_name: name, p_day: day }),
    applyTemplate: (template, day) => call('dep_apply_template', { p_template: template, p_day: day }),
    deleteTemplate: (template) => call('dep_delete_template', { p_template: template }),
    mine: () => call('dep_my'),
    markSeen: (day) => call('dep_mark_seen', { p_day: day }),
    crew: (day) => call('dep_crew', { p_day: day }),
};

/* ---- dates (Singapore working days; plain YYYY-MM-DD strings) ---- */
export const iso = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const parseDay = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
    const d = parseDay(s);
    d.setDate(d.getDate() + n);
    return iso(d);
};
export const mondayOf = (s) => {
    const d = parseDay(s);
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return iso(d);
};
export const dayLabel = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    parseDay(s).toLocaleDateString('en-SG', opts);

export const toMin = (t) => {
    const [h, m] = String(t || '0:0').split(':').map(Number);
    return h * 60 + m;
};
export const overlaps = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

export function directionsUrl(lat, lng) {
    if (lat == null || lng == null) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
