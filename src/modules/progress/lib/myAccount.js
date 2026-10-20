import { supabaseProgress } from '@/core/supabase'
import { getWorkerSessionToken, setStoredWorkerName } from '@/core/auth/progress/workerSession';
import { getManagerSessionToken, setStoredManagerName } from '@/core/auth/progress/managerSession';
import { getExporterSessionToken, setStoredExporterName } from '@/core/auth/progress/exporterSession';
import { getAdminSession, setStoredAdminName } from '@/core/auth/progress/adminSession';

const MIN_PASSWORD = 6;

function rpcName(data, fallback) {
  if (typeof data === 'string' && data.trim()) return data.trim();
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row === 'string' && row.trim()) return row.trim();
  return fallback;
}

function requireToken(token) {
  if (!token) {
    const err = new Error('Not authenticated');
    throw err;
  }
  return token;
}

export function assertNewPassword(newPassword, confirmPassword) {
  if (!newPassword || newPassword.length < MIN_PASSWORD) {
    throw new Error('New password must be at least 6 characters.');
  }
  if (newPassword !== confirmPassword) {
    throw new Error('New passwords do not match.');
  }
}

export async function updateOwnDisplayName(role, displayName) {
  const name = (displayName || '').trim();
  if (!name) throw new Error('Display name is required.');

  if (role === 'worker') {
    const { data, error } = await supabaseProgress.rpc('worker_update_own_display_name', {
      p_session_token: requireToken(getWorkerSessionToken()),
      p_display_name: name,
    });
    if (error) throw error;
    const next = rpcName(data, name);
    setStoredWorkerName(next);
    return next;
  }

  if (role === 'manager') {
    const { data, error } = await supabaseProgress.rpc('manager_update_own_display_name', {
      p_session_token: requireToken(getManagerSessionToken()),
      p_display_name: name,
    });
    if (error) throw error;
    const next = rpcName(data, name);
    setStoredManagerName(next);
    return next;
  }

  if (role === 'exporter') {
    const { data, error } = await supabaseProgress.rpc('exporter_update_own_display_name', {
      p_session_token: requireToken(getExporterSessionToken()),
      p_display_name: name,
    });
    if (error) throw error;
    const next = rpcName(data, name);
    setStoredExporterName(next);
    return next;
  }

  if (role === 'admin') {
    const { data, error } = await supabaseProgress.rpc('admin_update_own_display_name', {
      p_display_name: name,
    });
    if (error) throw error;
    const next = rpcName(data, name);
    setStoredAdminName(next);
    return next;
  }

  throw new Error('Not authenticated');
}

function mapAuthPasswordError(error) {
  const text = `${error?.message || ''} ${error?.code || ''}`;
  if (/invalid login|invalid credentials|invalid email or password/i.test(text)) {
    return new Error('Current password is incorrect.');
  }
  if (/password should be at least|at least 6 character/i.test(text)) {
    return new Error('New password must be at least 6 characters.');
  }
  return error;
}

export async function updateOwnPassword(role, { currentPassword, newPassword, confirmPassword }) {
  assertNewPassword(newPassword, confirmPassword);
  if (!currentPassword) throw new Error('Current password is incorrect.');

  if (role === 'worker') {
    const { error } = await supabaseProgress.rpc('worker_update_own_password', {
      p_session_token: requireToken(getWorkerSessionToken()),
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });
    if (error) throw error;
    return;
  }

  if (role === 'manager') {
    const { error } = await supabaseProgress.rpc('manager_update_own_password', {
      p_session_token: requireToken(getManagerSessionToken()),
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });
    if (error) throw error;
    return;
  }

  if (role === 'exporter') {
    const { error } = await supabaseProgress.rpc('exporter_update_own_password', {
      p_session_token: requireToken(getExporterSessionToken()),
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });
    if (error) throw error;
    return;
  }

  if (role === 'admin') {
    const session = await getAdminSession();
    if (!session?.email) throw new Error('Not authenticated');
    const { error: reauthError } = await supabaseProgress.auth.signInWithPassword({
      email: session.email,
      password: currentPassword,
    });
    if (reauthError) throw mapAuthPasswordError(reauthError);
    const { error } = await supabaseProgress.auth.updateUser({ password: newPassword });
    if (error) throw mapAuthPasswordError(error);
    return;
  }

  throw new Error('Not authenticated');
}
