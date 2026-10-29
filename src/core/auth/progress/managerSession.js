import { supabaseProgress as supabase } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { isTransportError, isMissingRpcError } from '@/modules/progress/lib/networkError';
import { normalizeJsrPerms } from '@/modules/progress/lib/jsrPermissions';
import { cachedVerify, forgetVerified } from '@/core/auth/verifyCache';

const K = (key) => storageKey('progress', key);

/**
 * Manager auth — a self-contained `manager_users` table + session-token RPCs
 * (verify_manager_login / verify_manager_session), same pattern as Employee/Technician.
 * Deliberately NOT Supabase Auth: passwords are set directly when the
 * account is created (Admin dashboard), no Supabase dashboard step needed.
 * Admin is a separate system — see adminSession.js.
 */

const TOKEN_KEY = K('managerSessionToken');
const EXPIRED_FLAG = K('managerSessionExpired');
const PERMS_KEY = K('managerJsrPermissions');
const FLAG_KEYS = [K('managerLoggedIn'), K('managerName'), K('managerLoginId'), PERMS_KEY];

function removeKeys(keys) {
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
}

export function clearManagerSession({ expired = false } = {}) {
  forgetVerified('pr:manager:');
  removeKeys([TOKEN_KEY, ...FLAG_KEYS]);
  if (expired) {
    try {
      sessionStorage.setItem(EXPIRED_FLAG, 'true');
    } catch {
      /* ignore */
    }
  }
}

export function consumeManagerSessionExpiredMessage() {
  try {
    if (sessionStorage.getItem(EXPIRED_FLAG) === 'true') {
      sessionStorage.removeItem(EXPIRED_FLAG);
      return 'Your session expired for security. Please log in again.';
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistJsrPermissions(raw) {
  try {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      localStorage.setItem(PERMS_KEY, JSON.stringify(raw));
    } else {
      localStorage.removeItem(PERMS_KEY);
    }
  } catch {
    /* ignore */
  }
}

function persist(token, profile) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(K('managerLoggedIn'), 'true');
  localStorage.setItem(K('managerName'), profile.name || '');
  localStorage.setItem(K('managerLoginId'), profile.loginId || '');
  persistJsrPermissions(profile.jsrPermissions);
}

export function getStoredManagerJsrPerms() {
  try {
    const raw = localStorage.getItem(PERMS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * UI hint only — the server re-checks the flag on every delete. Reads the map
 * saved at login / on each session verify, so it follows Admin's latest change
 * the next time the manager signs in or reloads.
 */
export function managerCanDeletePackagePhotos() {
  return normalizeJsrPerms(getStoredManagerJsrPerms()).delete_package_photos === true;
}

/** Admin ticked "Send photo packages to clients" for this manager. Enforced again by the database. */
export function managerCanSendPackages() {
  return normalizeJsrPerms(getStoredManagerJsrPerms()).send_packages === true;
}

export function setStoredManagerName(name) {
  try {
    localStorage.setItem(K('managerName'), name || '');
  } catch {
    /* ignore */
  }
}

/** Used by shared Admin/Manager RPCs — always safe to pass, even when signed in as Admin (it'll just be null). */
export function getManagerSessionToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function isManagerAuthenticated() {
  try {
    return localStorage.getItem(K('managerLoggedIn')) === 'true' && !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

export async function signInManager({ loginId, password }) {
  const { data, error } = await supabase.rpc('verify_manager_login', {
    p_login_id: loginId.trim(),
    p_password: password,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.session_token) {
    if (isMissingRpcError(error)) {
      return { ok: false, error: 'Apply migration 0043_manager_jsr_permission_enforce.sql in the Supabase SQL editor, then try again.' };
    }
    return { ok: false, error: 'Invalid login ID or password' };
  }
  persist(row.session_token, {
    name: row.display_name,
    loginId: row.login_id,
    jsrPermissions: row.jsr_permissions,
  });
  // Keep Admin JWT / Export Only session so another tab can stay logged in.
  // Manager pages send only the manager token (see portalAuth); staff actor
  // resolution prefers a non-empty manager token over auth.uid().
  return { ok: true, profile: { name: row.display_name, jsrPermissions: row.jsr_permissions } };
}

export async function verifyManagerSession() {
  const token = getManagerSessionToken();
  if (!token) return null;
  return cachedVerify(`pr:manager:${token}`, () => fetchManagerSession(token), { isValid: (r) => !!r?.manager_id && r.manager_id !== 'local' });
}

async function fetchManagerSession(token) {
  try {
    const { data, error } = await supabase.rpc('verify_manager_session', { p_session_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    if (error) {
      if (isTransportError(error) || isMissingRpcError(error)) {
        return {
          manager_id: 'local',
          display_name: localStorage.getItem(K('managerName')) || 'Manager',
          login_id: localStorage.getItem(K('managerLoginId')) || '',
          jsr_permissions: isMissingRpcError(error) ? null : getStoredManagerJsrPerms(),
        };
      }
      clearManagerSession({ expired: true });
      return null;
    }
    if (!row?.manager_id) {
      clearManagerSession({ expired: true });
      return null;
    }
    persist(token, {
      name: row.display_name,
      loginId: row.login_id,
      jsrPermissions: row.jsr_permissions,
    });
    return row;
  } catch (e) {
    if (isTransportError(e) || isMissingRpcError(e)) {
      return {
        manager_id: 'local',
        display_name: localStorage.getItem(K('managerName')) || 'Manager',
        login_id: localStorage.getItem(K('managerLoginId')) || '',
        jsr_permissions: isMissingRpcError(e) ? null : getStoredManagerJsrPerms(),
      };
    }
    clearManagerSession({ expired: true });
    return null;
  }
}

export async function signOutManager() {
  try {
    const { unregisterPushDevice } = await import('@/core/push');
    await unregisterPushDevice();
  } catch {
    /* ignore */
  }
  const token = getManagerSessionToken();
  if (token) {
    try {
      await supabase.rpc('revoke_manager_session', { p_session_token: token });
    } catch {
      /* ignore */
    }
  }
  clearManagerSession();
}
