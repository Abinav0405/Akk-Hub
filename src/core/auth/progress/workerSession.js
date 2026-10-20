import { supabaseProgress as supabase } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { isTransportError } from '@/modules/progress/lib/networkError';
import { cachedVerify, forgetVerified } from '@/core/auth/verifyCache';

const K = (key) => storageKey('progress', key);

/** Employee/technician session length (12 hours), mirrored server-side in role_sessions.expires_at. */
export const SESSION_MS = 12 * 60 * 60 * 1000;

const TOKEN_KEY = K('workerSessionToken');
const EXPIRED_FLAG = K('workerSessionExpired');

function removeKeys(keys) {
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
}

export function clearWorkerSession({ expired = false } = {}) {
  forgetVerified('pr:worker:');
  removeKeys([TOKEN_KEY, K('workerLoggedIn'), K('workerName'), K('workerId')]);
  if (expired) {
    try {
      sessionStorage.setItem(EXPIRED_FLAG, 'true');
    } catch {
      /* ignore */
    }
  }
}

export function consumeWorkerSessionExpiredMessage() {
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

function persistWorkerSession(token, profile) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(K('workerLoggedIn'), 'true');
  localStorage.setItem(K('workerName'), profile.name || '');
  localStorage.setItem(K('workerId'), profile.employeeCode || '');
}

export function setStoredWorkerName(name) {
  try {
    localStorage.setItem(K('workerName'), name || '');
  } catch {
    /* ignore */
  }
}

export function getWorkerSessionToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function isWorkerAuthenticated() {
  try {
    return localStorage.getItem(K('workerLoggedIn')) === 'true' && !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

/** Log in against the `verify_worker_login` RPC (see supabase/migrations/0001_init.sql). */
export async function signInWorker({ employeeCode, password }) {
  const { data, error } = await supabase.rpc('verify_worker_login', {
    p_employee_code: employeeCode.trim(),
    p_password: password,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.session_token) {
    return { ok: false, error: 'Invalid Employee ID or password' };
  }
  const profile = { name: row.display_name, employeeCode: row.employee_code };
  persistWorkerSession(row.session_token, profile);
  // Admin JWT stays in this browser — do not signOut() here.
  return { ok: true, profile };
}

/** Re-validate against the server on app load — a spoofed localStorage flag alone won't pass. */
export async function verifyWorkerSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  return cachedVerify(`pr:worker:${token}`, () => fetchWorkerSession(token), { isValid: (r) => !!r?.user_id && r.user_id !== 'local' });
}

async function fetchWorkerSession(token) {

  try {
    const { data, error } = await supabase.rpc('verify_role_session', { p_session_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    if (error) {
      if (isTransportError(error)) {
        return {
          user_id: localStorage.getItem(K('workerId')) || 'local',
          display_name: localStorage.getItem(K('workerName')) || 'Employee/Technician',
          employee_code: localStorage.getItem(K('workerId')) || '',
        };
      }
      clearWorkerSession({ expired: true });
      return null;
    }
    if (!row?.user_id) {
      clearWorkerSession({ expired: true });
      return null;
    }
    persistWorkerSession(token, { name: row.display_name, employeeCode: row.employee_code });
    return row;
  } catch (e) {
    if (isTransportError(e)) {
      return {
        user_id: localStorage.getItem(K('workerId')) || 'local',
        display_name: localStorage.getItem(K('workerName')) || 'Employee/Technician',
        employee_code: localStorage.getItem(K('workerId')) || '',
      };
    }
    clearWorkerSession({ expired: true });
    return null;
  }
}

export async function signOutWorker() {
  // Dynamic import avoids a static circular dependency (pushNotifications.js reads this module's token getter).
  try {
    const { unregisterPushDevice } = await import('@/core/push');
    await unregisterPushDevice();
  } catch {
    /* ignore */
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    try {
      await supabase.rpc('revoke_role_session', { p_session_token: token });
    } catch {
      /* ignore */
    }
  }
  clearWorkerSession();
}
