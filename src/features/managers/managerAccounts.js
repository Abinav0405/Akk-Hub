/**
 * One manager = one email + one password across the three places a manager signs in:
 *   hub      — attendance.managers (the hub's own manager login)
 *   materials — Supabase Auth user + materials.staff_profiles (via the mat-manage-staff function)
 *   progress — progress.manager_users (Site work; login ID = the email)
 * Every action runs in all three and reports per area, so a half-done change is visible and can be finished.
 */
import { UNIFIED, supabaseCore, supabaseMaterials, supabaseTimesheet, FN } from '@/core/supabase';
import { adminSetManagerPassword } from '@/core/auth/timesheetSession';
import {
    createManager as createProgressManager,
    deleteManager as deleteProgressManager,
    listManagers as listProgressManagers,
    resetManagerPassword as resetProgressPassword,
    updateManager as updateProgressManager,
} from '@/modules/progress/lib/accounts';

export const AREAS = [
    { key: 'hub', label: 'Hub login' },
    { key: 'materials', label: 'Materials' },
    { key: 'progress', label: 'Site work' },
];
export const MIN_PASSWORD = 8; // Materials requires 8; the same rule everywhere
const norm = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(e));

/** Prefer the hub (Attendance) admin JWT — Materials keeps a separate sb-auth key that can be stale. */
async function adminToken() {
    for (const client of UNIFIED ? [supabaseTimesheet, supabaseMaterials] : [supabaseMaterials]) {
        const { data } = await client.auth.getSession();
        if (data?.session?.access_token) return data.session.access_token;
        const { data: refreshed } = await client.auth.refreshSession();
        if (refreshed?.session?.access_token) return refreshed.session.access_token;
    }
    return null;
}

export async function invokeStaff(body) {
    const token = await adminToken();
    if (!token) throw new Error('Admin session required — sign in again and retry.');
    const { data, error } = await supabaseMaterials.functions.invoke(FN.manageStaff, { body, headers: { Authorization: `Bearer ${token}` } });
    if (error) {
        let message = error.message || 'Manager service request failed';
        try {
            const payload = await error.context?.json();
            message = payload?.error || payload?.message || message;
        } catch {
            /* response body was unavailable */
        }
        throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
}

/** Everyone who is a manager anywhere, merged by email. `errors` names an area that could not be read. */
export async function loadManagers() {
    const errors = {};
    const safe = (area, p) =>
        p.catch((e) => {
            errors[area] = e?.message || 'Could not load';
            return [];
        });
    const [hub, mat, prg] = await Promise.all([
        safe(
            'hub',
            supabaseTimesheet
                .from('managers')
                .select('id, email, name, created_at')
                .then(({ data, error }) => {
                    if (error) throw error;
                    return data || [];
                }),
        ),
        safe(
            'materials',
            supabaseMaterials
                .from('staff_profiles')
                .select('user_id, display_name, email, role, roles, is_active, created_at')
                .contains('roles', ['manager'])
                .then(({ data, error }) => {
                    if (error) throw error;
                    return data || [];
                }),
        ),
        safe('progress', listProgressManagers()),
    ]);
    const byEmail = new Map();
    const row = (email) => {
        const k = norm(email);
        if (!byEmail.has(k)) byEmail.set(k, { email: k, hub: null, materials: null, progress: null });
        return byEmail.get(k);
    };
    hub.forEach((m) => (row(m.email).hub = m));
    // A removed Materials manager stays as an inactive (banned) profile — that is "no access".
    mat.filter((m) => m.is_active).forEach((m) => (row(m.email).materials = m));
    mat.filter((m) => !m.is_active).forEach((m) => (row(m.email).materialsRemoved = m));
    prg.forEach((m) => (row(m.login_id).progress = m));
    const list = [...byEmail.values()]
        .filter((r) => r.hub || r.materials || r.progress)
        .map((r) => ({
            ...r,
            name: r.hub?.name || r.materials?.display_name || r.progress?.display_name || r.email,
            alsoAdmin: Boolean(r.materials?.roles?.includes('admin')),
            siteWorkDisabled: r.progress ? r.progress.is_active === false : false,
            missing: AREAS.filter((a) => !r[a.key]).map((a) => a.key),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const removed = new Map(mat.filter((m) => !m.is_active).map((m) => [norm(m.email), m]));
    return { list, errors, removed };
}

/**
 * Create or update a manager everywhere.
 *   existing — a row from loadManagers() (null for a new manager)
 *   password — optional when editing; required to set up an area the manager is missing from
 * Returns { done: [area], skipped: [area], failed: [{ area, message }] }.
 */
export async function saveManager(existing, { name, email, password }, { list: all = [], removed = new Map() } = {}) {
    const n = String(name || '').trim();
    const e = norm(email);
    const pw = String(password || '');
    if (!n) throw new Error('Enter the manager’s name.');
    if (!validEmail(e)) throw new Error('Enter a valid email — it is the login for every area.');
    if (pw && pw.length < MIN_PASSWORD) throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
    if (!existing && !pw) throw new Error('Set a password for the new manager.');
    const owner = all.find((r) => r.email === e);
    if (owner && owner !== existing && owner.email !== existing?.email) {
        throw new Error(`${e} is already ${owner.name}’s login.`);
    }

    const out = { done: [], skipped: [], failed: [] };
    const step = async (area, fn) => {
        try {
            const r = await fn();
            if (r === 'skip') out.skipped.push(area);
            else if (r !== 'same') out.done.push(area);
        } catch (err) {
            out.failed.push({ area, message: err?.message || 'Failed' });
        }
    };

    // Materials first: it has the strictest checks (email already used by another sign-in, etc.).
    await step('materials', async () => {
        const m = existing?.materials;
        if (m) {
            if (m.display_name === n && norm(m.email) === e && !pw) return 'same';
            await invokeStaff({ action: 'update', user_id: m.user_id, display_name: n, email: e, ...(pw ? { password: pw } : {}) });
            return 'ok';
        }
        if (!pw) return 'skip';
        const gone = existing?.materialsRemoved || removed.get(e);
        await invokeStaff({ action: 'create', display_name: n, email: e, password: pw });
        // Re-adding someone removed earlier: "remove" banned their sign-in — lift it (needed until the function is redeployed).
        if (gone) {
            const { error } = await supabaseCore.rpc('admin_staff_unban', { p_user_id: gone.user_id });
            if (error) throw new Error(`Account restored but sign-in still blocked: ${error.message}`);
        }
        return 'ok';
    });

    await step('hub', async () => {
        const h = existing?.hub;
        if (h) {
            let changed = false;
            if (h.name !== n || norm(h.email) !== e) {
                const { error } = await supabaseTimesheet.from('managers').update({ name: n, email: e, updated_at: new Date().toISOString() }).eq('id', h.id);
                if (error) throw error;
                changed = true;
            }
            if (pw) {
                await adminSetManagerPassword({ managerId: h.id, newPassword: pw, email: e });
                changed = true;
            }
            return changed ? 'ok' : 'same';
        }
        if (!pw) return 'skip';
        // The table trigger hashes the plain password on insert.
        const now = new Date().toISOString();
        const { error } = await supabaseTimesheet.from('managers').insert([{ email: e, name: n, password_hash: pw, created_at: now, updated_at: now }]);
        if (error) throw error;
        return 'ok';
    });

    await step('progress', async () => {
        const p = existing?.progress;
        if (p) {
            let changed = false;
            if (p.display_name !== n || norm(p.login_id) !== e) {
                await updateProgressManager(p.id, { loginId: e, displayName: n });
                changed = true;
            }
            if (pw) {
                await resetProgressPassword(p.id, pw);
                changed = true;
            }
            return changed ? 'ok' : 'same';
        }
        if (!pw) return 'skip';
        await createProgressManager({ loginId: e, displayName: n, password: pw }); // starts view-only in JSR
        return 'ok';
    });

    return out;
}

/** Take ONE area away from a manager (the others stay). Materials keeps an Admin account's Admin access. */
export async function revokeArea(row, area) {
    if (area === 'materials' && row.materials) return invokeStaff({ action: 'delete', user_id: row.materials.user_id });
    if (area === 'progress' && row.progress) return deleteProgressManager(row.progress.id);
    if (area === 'hub' && row.hub) {
        const { error } = await supabaseTimesheet.from('managers').delete().eq('id', row.hub.id);
        if (error) throw error;
    }
    return null;
}

/** Remove manager access everywhere (an account that is also Admin keeps its Admin access). */
export async function removeManager(row) {
    const out = { done: [], skipped: [], failed: [] };
    const step = async (area, has, fn) => {
        if (!has) return;
        try {
            await fn();
            out.done.push(area);
        } catch (err) {
            out.failed.push({ area, message: err?.message || 'Failed' });
        }
    };
    await step('materials', row.materials, () => invokeStaff({ action: 'delete', user_id: row.materials.user_id }));
    await step('progress', row.progress, () => deleteProgressManager(row.progress.id));
    await step('hub', row.hub, async () => {
        const { error } = await supabaseTimesheet.from('managers').delete().eq('id', row.hub.id);
        if (error) throw error;
    });
    return out;
}

/** A throwaway password for a brand-new Materials sign-in — replaced by their real one straight away, never shown. */
function throwawayPassword() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#%'[b % 58]).join('');
}

/**
 * Give one missing area to a manager, keeping the password they already use (the database copies the
 * stored, scrambled password across). Returns 'added' | 'added-own-password' | 'already'.
 */
export async function grantArea(row, area) {
    if (area === 'materials') {
        const { data: exists, error } = await supabaseCore.rpc('admin_signin_exists', { p_email: row.email });
        if (error) throw error;
        // An existing sign-in (e.g. their admin login) only gets the manager role and keeps its password.
        await invokeStaff({ action: 'create', display_name: row.name, email: row.email, ...(exists ? {} : { password: throwawayPassword() }) });
    }
    const { data, error } = await supabaseCore.rpc('admin_manager_grant', { p_email: row.email, p_area: area });
    if (error) throw error;
    return data;
}

export const areaLabel = (k) => AREAS.find((a) => a.key === k)?.label || k;
/** "Saved in Hub login, Materials · Site work failed: …" */
export function summarize(out, verb = 'Saved') {
    const parts = [];
    if (out.done.length) parts.push(`${verb} in ${out.done.map(areaLabel).join(', ')}`);
    if (out.failed.length) parts.push(out.failed.map((f) => `${areaLabel(f.area)} failed: ${f.message}`).join(' · '));
    if (out.skipped.length) parts.push(`${out.skipped.map(areaLabel).join(', ')} not set up — enter a password to add them`);
    return parts.join(' · ') || 'Nothing changed';
}
