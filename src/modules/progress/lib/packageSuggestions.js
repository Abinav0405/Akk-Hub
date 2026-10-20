import { supabaseProgress } from '@/core/supabase'
import { getManagerSessionToken } from '@/core/auth/progress/managerSession';
import { friendlyDbError, isMissingRpcError } from '@/modules/progress/lib/networkError';

/**
 * Shared description / street name list (migration 0074). Employees/technicians type
 * and pick from it; it grows as packages are submitted; Admin can edit it.
 */
export const SUGGESTION_KINDS = [
  { kind: 'description', label: 'Descriptions', singular: 'description', placeholder: 'e.g. Accident pole replacement' },
  { kind: 'street', label: 'Street names', singular: 'street name', placeholder: 'e.g. Phillip Street' },
];

const MIGRATION_HINT = 'Apply migration 0074_jsr_lowest_free_number_package_suggestions.sql in the Supabase SQL editor to use the description / street name list.';

/** { description: [{id, value, use_count}], street: [...] } — most used first. Empty before 0074. */
export async function listPackageSuggestions() {
  const { data, error } = await supabaseProgress.rpc('list_package_suggestions');
  if (error) {
    if (isMissingRpcError(error)) return { description: [], street: [] };
    throw new Error(friendlyDbError(error, 'Could not load the description / street list'));
  }
  const out = { description: [], street: [] };
  (data || []).forEach((row) => {
    if (out[row.kind]) out[row.kind].push({ ...row, use_count: Number(row.use_count) || 0 });
  });
  return out;
}

/** Add (id null) or rename an entry. */
export async function savePackageSuggestion({ id = null, kind = null, value }) {
  const { data, error } = await supabaseProgress.rpc('staff_save_package_suggestion', {
    p_id: id,
    p_kind: kind,
    p_value: value,
    p_manager_token: getManagerSessionToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(MIGRATION_HINT);
    throw new Error(friendlyDbError(error, 'Could not save that'));
  }
  return data;
}

export async function deletePackageSuggestion(id) {
  const { error } = await supabaseProgress.rpc('staff_delete_package_suggestion', {
    p_id: id,
    p_manager_token: getManagerSessionToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(MIGRATION_HINT);
    throw new Error(friendlyDbError(error, 'Could not remove that'));
  }
}

function norm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Entries matching what was typed: every word must appear; ones that start with the
 * text come first, then the most used. An exact match is left out (already typed).
 */
export function matchSuggestions(list, query, limit = 8) {
  const q = norm(query);
  const words = q.split(' ').filter(Boolean);
  const rows = (list || []).filter((row) => {
    const v = norm(row.value);
    if (q && v === q) return false;
    return words.every((w) => v.includes(w));
  });
  rows.sort((a, b) => {
    const as = q && norm(a.value).startsWith(q) ? 0 : 1;
    const bs = q && norm(b.value).startsWith(q) ? 0 : 1;
    if (as !== bs) return as - bs;
    return (b.use_count || 0) - (a.use_count || 0) || String(a.value).localeCompare(String(b.value));
  });
  return rows.slice(0, limit);
}
