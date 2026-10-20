import { supabaseProgress } from '@/core/supabase'
import { portalManagerToken } from '@/core/auth/progress/portalAuth';
import { friendlyDbError, isMissingRpcError } from '@/modules/progress/lib/networkError';

/**
 * Per-site section names the employee/technician picks from (in addition to the site's
 * default section name). Stored in site_options (migration 0069). Descriptions and
 * street names are one shared list since 0074 — see packageSuggestions.js.
 */
export const SITE_OPTION_KINDS = [
  { kind: 'section', label: 'Section names', placeholder: 'e.g. Pole' },
];

const MIGRATION_HINT = 'Apply migration 0069_claim_pc_no_site_options_endorsement_fixes.sql in the Supabase SQL editor to use site section names, descriptions and street names.';

function emptyGroups() {
  return { section: [], description: [], street: [] };
}

/** { [siteId]: { section: [{id,value}], description: [...], street: [...] } } */
export function groupSiteOptions(rows) {
  const out = {};
  (rows || []).forEach((row) => {
    if (!row?.site_id || !row.kind) return;
    const site = out[row.site_id] || (out[row.site_id] = emptyGroups());
    (site[row.kind] || (site[row.kind] = [])).push({ id: row.id, value: row.value });
  });
  return out;
}

export function optionsForSite(grouped, siteId) {
  return (siteId && grouped?.[siteId]) || emptyGroups();
}

/** All sites' options (or one site's). Readable by every portal; empty if 0069 is not applied yet. */
export async function listSiteOptions(siteId = null) {
  const { data, error } = await supabaseProgress.rpc('list_site_options', { p_site_id: siteId });
  if (error) {
    if (isMissingRpcError(error)) return [];
    throw new Error(friendlyDbError(error, 'Could not load site options'));
  }
  return data || [];
}

export async function addSiteOption(siteId, kind, value) {
  const { error } = await supabaseProgress.rpc('staff_add_site_option', {
    p_site_id: siteId,
    p_kind: kind,
    p_value: value,
    p_manager_token: portalManagerToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(MIGRATION_HINT);
    throw new Error(friendlyDbError(error, 'Could not add that'));
  }
}

export async function deleteSiteOption(optionId) {
  const { error } = await supabaseProgress.rpc('staff_delete_site_option', {
    p_option_id: optionId,
    p_manager_token: portalManagerToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(MIGRATION_HINT);
    throw new Error(friendlyDbError(error, 'Could not remove that'));
  }
}
