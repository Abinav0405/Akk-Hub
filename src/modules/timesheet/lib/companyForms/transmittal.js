/**
 * Transmittal Form helpers: the running transmittal number and the "address book" built from
 * earlier transmittals (company → attn / address / tel, project → project ref).
 *
 * Numbering: AKK/TRN/<year>/<3 digits>. The next number continues from the most recently sent
 * transmittal (rejected ones are ignored), whatever that number was — so if someone edits a
 * number, the next form follows on from it. A number already in use is never offered.
 */
import { supabaseTimesheet } from '@/core/supabase';

export const TRANSMITTAL_KEY = 'transmittal';
const STANDARD = /^AKK\/TRN\/(\d{4})\/(\d+)$/i;

export const normNo = (no) => String(no || '').trim().toUpperCase();
const normText = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s) => String(s || '').trim();

export function firstTransmittalNo(year) {
    return `AKK/TRN/${year}/001`;
}

/** The number after `no`: last run of digits + 1, same zero padding. Null when `no` has no digits. */
export function incrementNo(no) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(clean(no));
    if (!m) return null;
    const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
    return `${m[1]}${n}${m[3]}`;
}

/**
 * @param {string|null} latestNo number on the most recent (not rejected) transmittal
 * @param {Set<string>} used normalised numbers already taken
 * @param {number} year current year (Singapore)
 */
export function nextTransmittalNo(latestNo, used, year) {
    let next;
    const std = STANDARD.exec(clean(latestNo));
    if (!clean(latestNo)) next = firstTransmittalNo(year);
    else if (std && Number(std[1]) < year) next = firstTransmittalNo(year); // new year → 001
    else next = incrementNo(latestNo) || firstTransmittalNo(year);
    for (let guard = 0; used.has(normNo(next)) && guard < 5000; guard += 1) next = incrementNo(next);
    return next;
}

/** Earlier transmittals, newest first: [{ id, status, created_at, fields }]. */
export async function fetchTransmittalHistory({ limit = 500 } = {}) {
    const { data, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .select('id, status, created_at, fields:payload->fields')
        .eq('form_key', TRANSMITTAL_KEY)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return (data || []).map((r) => ({ ...r, fields: r.fields && typeof r.fields === 'object' ? r.fields : {} }));
}

async function fetchSiteNames() {
    try {
        const { data } = await supabaseTimesheet.from('sites').select('site_name').order('site_name');
        return (data || []).map((s) => clean(s.site_name)).filter(Boolean);
    } catch {
        return [];
    }
}

/** Everything the form needs: numbering state and the address book. */
export async function loadTransmittalDirectory() {
    const [rows, sites] = await Promise.all([fetchTransmittalHistory(), fetchSiteNames()]);
    const live = rows.filter((r) => r.status !== 'rejected');
    const used = new Map(); // normalised no → row
    for (const r of live) {
        const no = normNo(r.fields.transmittal_no);
        if (no && !used.has(no)) used.set(no, r);
    }
    const latestNo = live.find((r) => clean(r.fields.transmittal_no))?.fields.transmittal_no || null;

    // Newest first, so the first entry seen for a company / project is its latest details.
    // Rejected forms are left out: their details may be the reason they were rejected.
    const companies = new Map();
    const projects = new Map();
    for (const r of live) {
        const f = r.fields;
        const company = clean(f.company_name);
        if (company && !companies.has(normText(company))) {
            companies.set(normText(company), {
                company_name: company,
                attn: clean(f.attn),
                address: clean(f.address),
                tel_email: clean(f.tel_email),
            });
        }
        const project = clean(f.project);
        if (project && !projects.has(normText(project))) {
            projects.set(normText(project), {
                project,
                project_ref: clean(f.project_ref),
                company_name: company,
            });
        }
    }
    return { rows: live, used, latestNo, companies, projects, sites };
}

export const lookupCompany = (dir, name) => dir?.companies.get(normText(name)) || null;
export const lookupProject = (dir, name) => dir?.projects.get(normText(name)) || null;

const uniq = (list) => {
    const seen = new Set();
    return list.filter((s) => {
        const k = normText(s);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
};

/** Suggestion lists per field, with the chosen company's own entries first. */
export function transmittalSuggestions(dir, fields) {
    if (!dir) return {};
    const company = normText(fields?.company_name);
    const mine = (r) => normText(r.fields.company_name) === company;
    const ours = company ? dir.rows.filter(mine) : [];
    const pick = (list, key) => list.map((r) => clean(r.fields[key]));
    return {
        company_name: uniq([...dir.companies.values()].map((c) => c.company_name)).slice(0, 200),
        attn: uniq([...pick(ours, 'attn'), ...pick(dir.rows, 'attn')]).slice(0, 100),
        project: uniq([...pick(ours, 'project'), ...pick(dir.rows, 'project'), ...dir.sites]).slice(0, 200),
        project_ref: uniq([...pick(ours, 'project_ref'), ...pick(dir.rows, 'project_ref')]).slice(0, 100),
    };
}
