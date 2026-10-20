import { supabaseProgress } from '@/core/supabase'
import { getWorkerSessionToken } from '@/core/auth/progress/workerSession';
import { portalManagerToken } from '@/core/auth/progress/portalAuth';

function throwIfRpcError(error) {
  if (!error) return;
  throw new Error(error.message || 'Request failed');
}

function workerToken() {
  const token = getWorkerSessionToken();
  if (!token) throw new Error('Not logged in');
  return token;
}

function managerToken() {
  return portalManagerToken();
}

function mapRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    path: row.path,
    packageId: row.package_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function listNotifications(role) {
  if (role === 'worker') {
    const { data, error } = await supabaseProgress.rpc('worker_list_notifications', {
      p_session_token: workerToken(),
    });
    throwIfRpcError(error);
    return (data || []).map(mapRow);
  }
  const { data, error } = await supabaseProgress.rpc('staff_list_notifications', {
    p_manager_token: managerToken(),
  });
  throwIfRpcError(error);
  return (data || []).map(mapRow);
}

export async function unreadNotificationCount(role) {
  if (role === 'worker') {
    const { data, error } = await supabaseProgress.rpc('worker_unread_notification_count', {
      p_session_token: workerToken(),
    });
    throwIfRpcError(error);
    return Number(data || 0);
  }
  const { data, error } = await supabaseProgress.rpc('staff_unread_notification_count', {
    p_manager_token: managerToken(),
  });
  throwIfRpcError(error);
  return Number(data || 0);
}

export async function markNotificationsRead(role, ids = null) {
  if (role === 'worker') {
    const { error } = await supabaseProgress.rpc('worker_mark_notifications_read', {
      p_session_token: workerToken(),
      p_ids: ids,
    });
    throwIfRpcError(error);
    return;
  }
  const { error } = await supabaseProgress.rpc('staff_mark_notifications_read', {
    p_manager_token: managerToken(),
    p_ids: ids,
  });
  throwIfRpcError(error);
}

/** Permanently remove inbox rows. `ids = null` clears the whole inbox. */
export async function clearNotifications(role, ids = null) {
  if (role === 'worker') {
    const { error } = await supabaseProgress.rpc('worker_clear_notifications', {
      p_session_token: workerToken(),
      p_ids: ids,
    });
    throwIfRpcError(error);
    return;
  }
  const { error } = await supabaseProgress.rpc('staff_clear_notifications', {
    p_manager_token: managerToken(),
    p_ids: ids,
  });
  throwIfRpcError(error);
}
