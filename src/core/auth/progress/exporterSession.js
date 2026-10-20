import { supabaseProgress as supabase } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { isTransportError } from '@/modules/progress/lib/networkError';
import { cachedVerify, forgetVerified } from '@/core/auth/verifyCache';

const K = (key) => storageKey('progress', key);

const TOKEN_KEY = K('exporterSessionToken');
const EXPIRED_FLAG = K('exporterSessionExpired');
const FLAG_KEYS = [K('exporterLoggedIn'), K('exporterName')];

function removeKeys(keys) {
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
}

export function clearExporterSession({ expired = false } = {}) {
  forgetVerified('pr:exporter:');
  removeKeys([TOKEN_KEY, ...FLAG_KEYS]);
  if (expired) {
    try {
      sessionStorage.setItem(EXPIRED_FLAG, 'true');
    } catch {
      /* ignore */
    }
  }
}

export function consumeExporterSessionExpiredMessage() {
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

function persist(token, profile) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(K('exporterLoggedIn'), 'true');
  localStorage.setItem(K('exporterName'), profile.name || '');
}

export function setStoredExporterName(name) {
  try {
    localStorage.setItem(K('exporterName'), name || '');
  } catch {
    /* ignore */
  }
}

export function getStoredExporterName() {
  try {
    return localStorage.getItem(K('exporterName')) || '';
  } catch {
    return '';
  }
}

export function getExporterSessionToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function isExporterAuthenticated() {
  try {
    return localStorage.getItem(K('exporterLoggedIn')) === 'true' && !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

export async function signInExporter({ displayName, password }) {
  const { data, error } = await supabase.rpc('verify_exporter_login', {
    p_display_name: displayName.trim(),
    p_password: password,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.session_token) {
    return { ok: false, error: 'Invalid name or password' };
  }
  persist(row.session_token, { name: row.display_name });
  // Keep Admin JWT / Manager session so another tab can stay logged in.
  // Export Only RPC args use only the exporter token (see portalAuth); SQL
  // 0073 prefers that token over a leftover Admin JWT when it is sent.
  return { ok: true, profile: { name: row.display_name } };
}

export async function verifyExporterSession() {
  const token = getExporterSessionToken();
  if (!token) return null;
  return cachedVerify(`pr:exporter:${token}`, () => fetchExporterSession(token), { isValid: (r) => !!r?.exporter_id && r.exporter_id !== 'local' });
}

async function fetchExporterSession(token) {
  try {
    const { data, error } = await supabase.rpc('verify_exporter_session', { p_session_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    if (error) {
      if (isTransportError(error)) {
        return {
          exporter_id: 'local',
          display_name: localStorage.getItem(K('exporterName')) || 'Export Only',
        };
      }
      clearExporterSession({ expired: true });
      return null;
    }
    if (!row?.exporter_id) {
      clearExporterSession({ expired: true });
      return null;
    }
    persist(token, { name: row.display_name });
    return row;
  } catch (e) {
    if (isTransportError(e)) {
      return {
        exporter_id: 'local',
        display_name: localStorage.getItem(K('exporterName')) || 'Export Only',
      };
    }
    clearExporterSession({ expired: true });
    return null;
  }
}

export async function signOutExporter() {
  const token = getExporterSessionToken();
  if (token) {
    try {
      await supabase.rpc('revoke_exporter_session', { p_session_token: token });
    } catch {
      /* ignore */
    }
  }
  clearExporterSession();
}
