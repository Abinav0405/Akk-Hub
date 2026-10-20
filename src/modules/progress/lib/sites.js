import { supabaseProgress } from '@/core/supabase'
import { portalManagerToken } from '@/core/auth/progress/portalAuth';
import { friendlyDbError } from '@/modules/progress/lib/networkError';

function managerToken() {
  return portalManagerToken();
}

export async function listAllSites() {
  const { data, error } = await supabaseProgress.rpc('staff_list_sites', { p_manager_token: managerToken() });
  if (error) throw error;
  return data || [];
}

export async function createSite(name, sectionLabel = 'LCB') {
  const { error } = await supabaseProgress.rpc('staff_create_site', {
    p_name: name,
    p_section_label: sectionLabel,
    p_manager_token: managerToken(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not add site'));
}

export async function setSiteActive(siteId, isActive) {
  const { error } = await supabaseProgress.rpc('staff_set_site_active', {
    p_site_id: siteId,
    p_is_active: isActive,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
}

export async function updateSite(siteId, name, sectionLabel) {
  const { error } = await supabaseProgress.rpc('staff_update_site', {
    p_site_id: siteId,
    p_name: name,
    p_section_label: sectionLabel,
    p_manager_token: managerToken(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not update site'));
}

export async function deleteSite(siteId) {
  const { error } = await supabaseProgress.rpc('staff_delete_site', {
    p_site_id: siteId,
    p_manager_token: managerToken(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not delete site'));
}
