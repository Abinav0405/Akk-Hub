import { supabaseProgress as supabase, waitForInitialAuthSession } from '@/core/supabase';
import { storageKey } from '@/core/storage';
import { isTransportError } from '@/modules/progress/lib/networkError';
import { cachedVerify, forgetVerified } from '@/core/auth/verifyCache';

const K = (key) => storageKey('progress', key);

/**
 * Admin auth — a real Supabase Auth user (created in the Supabase dashboard
 * under Authentication > Users), linked to admin access via `admin_profiles`.
 * Manager is deliberately a separate, custom system (see managerSession.js).
 */

const FLAG_NAMES = ['adminLoggedIn', 'adminName', 'adminEmail'];

function writeFlags(values) {
  FLAG_NAMES.forEach((name) => {
    const k = K(name);
    try {
      if (values[name] == null) {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
      } else {
        sessionStorage.setItem(k, values[name]);
        localStorage.setItem(k, values[name]);
      }
    } catch {
      /* ignore */
    }
  });
}

export function clearAdminFlags() {
  forgetVerified('pr:admin');
  writeFlags({ adminLoggedIn: null, adminName: null, adminEmail: null });
}

export function isAdminAuthenticated() {
  try {
    return (
      localStorage.getItem(K('adminLoggedIn')) === 'true' ||
      sessionStorage.getItem(K('adminLoggedIn')) === 'true'
    );
  } catch {
    return false;
  }
}

export function setStoredAdminName(name) {
  try {
    const email =
      localStorage.getItem(K('adminEmail')) || sessionStorage.getItem(K('adminEmail')) || '';
    writeFlags({
      adminLoggedIn: 'true',
      adminName: name || '',
      adminEmail: email,
    });
  } catch {
    /* ignore */
  }
}

export async function getAdminAuthUser() {
  try {
    await waitForInitialAuthSession();
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data?.session?.user) return data.session.user;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns { userId, email, name } or null if not signed in / not an admin. */
export async function getAdminSession() {
  return cachedVerify('pr:admin', fetchAdminSession);
}

async function fetchAdminSession() {
  const user = await getAdminAuthUser();
  if (!user) return null;
  const { data: profile, error } = await supabase
    .from('admin_profiles')
    .select('user_id, display_name, email, is_active')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    if (isTransportError(error)) {
      try {
        return {
          userId: user.id,
          email: localStorage.getItem(K('adminEmail')) || sessionStorage.getItem(K('adminEmail')) || user.email || '',
          name: localStorage.getItem(K('adminName')) || sessionStorage.getItem(K('adminName')) || 'Admin',
        };
      } catch {
        return { userId: user.id, email: user.email || '', name: 'Admin' };
      }
    }
    return null;
  }
  if (!profile?.is_active) return null;
  return { userId: profile.user_id, email: profile.email || user.email || '', name: profile.display_name };
}

export async function signInAdmin({ email, password }) {
  forgetVerified('pr:admin');
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    return { ok: false, error: error.message };
  }

  const { data: profile, error: profileError } = await supabase
    .from('admin_profiles')
    .select('display_name, email, is_active')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active) {
    await supabase.auth.signOut();
    return { ok: false, error: 'This account does not have admin access.' };
  }

  const authEmail = profile.email || data.user?.email || email;
  writeFlags({
    adminLoggedIn: 'true',
    adminName: profile.display_name || '',
    adminEmail: authEmail,
  });

  // Keep Manager / Export Only sessions so another tab can stay logged in.
  // Each portal sends only its own credentials (see portalAuth / documentAuthArgs).

  return { ok: true, profile: { name: profile.display_name, email: authEmail } };
}

export async function verifyAdminSession() {
  const session = await getAdminSession();
  if (!session) {
    clearAdminFlags();
    return null;
  }
  writeFlags({
    adminLoggedIn: 'true',
    adminName: session.name || '',
    adminEmail: session.email || '',
  });
  return session;
}

export async function signOutAdmin() {
  try {
    const { unregisterPushDevice } = await import('@/core/push');
    await unregisterPushDevice();
  } catch {
    /* ignore */
  }
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
  clearAdminFlags();
}
