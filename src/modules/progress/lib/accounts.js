import { supabaseProgress } from '@/core/supabase'
import { withoutLocalWorkers } from '@/core/localWorkers';
import { portalManagerToken } from '@/core/auth/progress/portalAuth';
import { isMissingRpcError } from '@/modules/progress/lib/networkError';
import { JSR_PERM_MIGRATION_HINT } from '@/modules/progress/lib/jsrPermissions';

function managerToken() {
  return portalManagerToken();
}

// --- Employee/technician accounts (both Admin and Manager may manage these) ---

export async function listWorkers() {
  const { data, error } = await supabaseProgress.rpc('staff_list_workers', { p_manager_token: managerToken() });
  if (error) {
    if (/not authenticated|session expired|invalid session/i.test(String(error.message || ''))) {
      import('@/core/auth/bridges').then((m) => m.disconnectModule('progress')).catch(() => {});
    }
    throw error;
  }
  return withoutLocalWorkers(data || [], (w) => w.employee_code);
}

export async function createWorker({ employeeCode, displayName, password }) {
  const { error } = await supabaseProgress.rpc('staff_create_worker', {
    p_employee_code: employeeCode,
    p_display_name: displayName,
    p_password: password,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
}

export async function setWorkerActive(workerId, isActive) {
  const { error } = await supabaseProgress.rpc('staff_set_worker_active', {
    p_worker_id: workerId,
    p_is_active: isActive,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
}

export async function resetWorkerPassword(workerId, newPassword) {
  const { error } = await supabaseProgress.rpc('staff_reset_worker_password', {
    p_worker_id: workerId,
    p_new_password: newPassword,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
}

export async function deleteWorker(workerId) {
  const { error } = await supabaseProgress.rpc('staff_delete_worker', {
    p_worker_id: workerId,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
}

// --- Admin accounts — Admin only (Supabase Auth). Creating a brand-new one
// still needs a one-time step in the Supabase dashboard first. ---

export async function listAdmins() {
  const { data, error } = await supabaseProgress.rpc('admin_list_admins');
  if (error) throw error;
  return data || [];
}

export async function registerAdmin({ email, displayName }) {
  const { error } = await supabaseProgress.rpc('admin_register_admin', { p_email: email, p_display_name: displayName });
  if (error) throw error;
}

export async function setAdminActive(userId, isActive) {
  const { error } = await supabaseProgress.rpc('admin_set_admin_active', { p_user_id: userId, p_is_active: isActive });
  if (error) throw error;
}

export async function deleteAdmin(userId) {
  const { error } = await supabaseProgress.rpc('admin_delete_admin', { p_user_id: userId });
  if (error) throw error;
}

// --- Manager accounts — Admin only, password set directly, no dashboard step ---

export async function listManagers() {
  const { data, error } = await supabaseProgress.rpc('admin_list_managers');
  if (error) {
    if (isMissingRpcError(error)) throw new Error(JSR_PERM_MIGRATION_HINT);
    throw error;
  }
  return data || [];
}

export async function createManager({ loginId, displayName, password, jsrPermissions }) {
  const { error } = await supabaseProgress.rpc('admin_create_manager', {
    p_login_id: loginId,
    p_display_name: displayName,
    p_password: password,
    p_jsr_permissions: jsrPermissions || null,
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(JSR_PERM_MIGRATION_HINT);
    throw error;
  }
}

/** Rename / re-email a Site work manager (login ID = their email). */
export async function updateManager(managerId, { loginId, displayName }) {
  const { error } = await supabaseProgress.rpc('admin_update_manager', {
    p_manager_id: managerId,
    p_login_id: loginId,
    p_display_name: displayName,
  });
  if (error) throw error;
}

export async function setManagerJsrPermissions(managerId, jsrPermissions) {
  const { error } = await supabaseProgress.rpc('admin_set_manager_jsr_permissions', {
    p_manager_id: managerId,
    p_jsr_permissions: jsrPermissions,
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(JSR_PERM_MIGRATION_HINT);
    throw error;
  }
}

export async function setManagerActive(managerId, isActive) {
  const { error } = await supabaseProgress.rpc('admin_set_manager_active', { p_manager_id: managerId, p_is_active: isActive });
  if (error) throw error;
}

export async function resetManagerPassword(managerId, newPassword) {
  const { error } = await supabaseProgress.rpc('admin_reset_manager_password', {
    p_manager_id: managerId,
    p_new_password: newPassword,
  });
  if (error) throw error;
}

export async function deleteManager(managerId) {
  const { error } = await supabaseProgress.rpc('admin_delete_manager', { p_manager_id: managerId });
  if (error) throw error;
}

// --- Export Only accounts — Admin only, name + password ---

export async function listExporters() {
  const { data, error } = await supabaseProgress.rpc('admin_list_exporters');
  if (error) throw error;
  return data || [];
}

export async function createExporter({ displayName, password }) {
  const { error } = await supabaseProgress.rpc('admin_create_exporter', {
    p_display_name: displayName,
    p_password: password,
  });
  if (error) throw error;
}

export async function setExporterActive(exporterId, isActive) {
  const { error } = await supabaseProgress.rpc('admin_set_exporter_active', {
    p_exporter_id: exporterId,
    p_is_active: isActive,
  });
  if (error) throw error;
}

export async function resetExporterPassword(exporterId, newPassword) {
  const { error } = await supabaseProgress.rpc('admin_reset_exporter_password', {
    p_exporter_id: exporterId,
    p_new_password: newPassword,
  });
  if (error) throw error;
}

export async function deleteExporter(exporterId) {
  const { error } = await supabaseProgress.rpc('admin_delete_exporter', { p_exporter_id: exporterId });
  if (error) throw error;
}

export async function listPackageExportStatus() {
  const { data, error } = await supabaseProgress.rpc('admin_list_package_export_status');
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    sent_to_export: Boolean(row.sent_to_export),
    export_count: Number(row.export_count || 0),
  }));
}

export async function listPackageExportEvents() {
  const { data, error } = await supabaseProgress.rpc('admin_list_package_export_events');
  if (error) throw error;
  return data || [];
}
