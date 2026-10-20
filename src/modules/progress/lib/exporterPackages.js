import { supabaseProgress } from '@/core/supabase'
import { getExporterSessionToken, isExporterAuthenticated } from '@/core/auth/progress/exporterSession';
import { portalExporterToken } from '@/core/auth/progress/portalAuth';
import { reuseUnchangedPackages } from '@/modules/progress/lib/staffPackages';

function exporterToken() {
  return portalExporterToken();
}

function mapPackage(p) {
  return {
    id: p.id,
    display_id: p.display_id || null,
    lcb_id: p.lcb_id,
    section_label: p.section_label,
    package_date: p.package_date,
    has_before: p.has_before,
    has_during: p.has_during,
    has_after: p.has_after,
    has_completion: p.has_completion,
    completion_pct: p.completion_pct == null ? null : Number(p.completion_pct),
    photo_count: Number(p.photo_count || 0),
    before_count: Number(p.before_count || 0),
    during_count: Number(p.during_count || 0),
    after_count: Number(p.after_count || 0),
    completion_count: Number(p.completion_count || 0),
    approval_status: p.approval_status,
    decline_reason: p.decline_reason,
    created_at: p.created_at,
    reviewed_by_name: p.reviewed_by_name || null,
    reviewed_by_role: p.reviewed_by_role || null,
    exported_by_name: p.exported_by_name || null,
    exported_at: p.exported_at || null,
    exported_format: p.exported_format || null,
    export_count: Number(p.export_count || 0),
    description: p.description || '',
    street_name: p.street_name || '',
    site: p.site_id ? { id: p.site_id, name: p.site_name } : null,
    worker: p.worker_id
      ? { id: p.worker_id, employee_code: p.worker_employee_code, display_name: p.worker_display_name }
      : null,
  };
}

export { isExporterAuthenticated, reuseUnchangedPackages };

export async function listApprovedPackages() {
  const { data, error } = await supabaseProgress.rpc('exporter_list_approved_packages', {
    p_exporter_token: exporterToken(),
  });
  if (error) throw error;
  return (data || []).map(mapPackage);
}

export async function getExporterPackagesHeadTimestamp() {
  const { data, error } = await supabaseProgress.rpc('exporter_packages_head_timestamp', {
    p_exporter_token: exporterToken(),
  });
  if (error) throw error;
  return data;
}

export async function getExporterPackageImages(packageId) {
  const { data, error } = await supabaseProgress.rpc('exporter_get_package_images', {
    p_package_id: packageId,
    p_exporter_token: exporterToken(),
  });
  if (error) throw error;
  return data || [];
}

export async function recordExporterPackageExport(packageId, format) {
  const { error } = await supabaseProgress.rpc('exporter_record_export', {
    p_exporter_token: exporterToken(),
    p_package_id: packageId,
    p_format: format,
  });
  if (error) throw error;
}

export { getExporterSessionToken };
