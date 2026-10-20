import { supabaseProgress } from '@/core/supabase'
import { portalManagerToken } from '@/core/auth/progress/portalAuth';
import { isMissingRpcError } from '@/modules/progress/lib/networkError';
import { PHOTO_DELETE_MIGRATION_HINT } from '@/modules/progress/lib/jsrPermissions';
import { recordDocumentEventSafe } from '@/modules/progress/lib/documentAudit';
import { clearDocumentArtifact } from '@/modules/progress/lib/documentEndorsement';

/**
 * Manager token only on the Manager portal. Admin tabs send null so auth.uid()
 * resolves (a leftover manager token must not make Admin act as Manager).
 */
function managerToken() {
  return portalManagerToken();
}

/** Drop the stored package PDF after content changes so the next export is fresh. */
async function invalidatePackageArtifact(packageId) {
  if (!packageId) return;
  try {
    await clearDocumentArtifact({ kind: 'package', documentId: packageId });
  } catch (e) {
    console.warn('[staffPackages] could not clear package PDF artifact:', e);
  }
}

export async function listAllPackages() {
  const { data, error } = await supabaseProgress.rpc('staff_list_packages', { p_manager_token: managerToken() });
  if (error) throw error;
  return (data || []).map((p) => ({
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
    sent_to_export: Boolean(p.sent_to_export),
    sent_to_export_at: p.sent_to_export_at || null,
    description: p.description || '',
    street_name: p.street_name || '',
    site: p.site_id ? { id: p.site_id, name: p.site_name } : null,
    worker: p.worker_id
      ? { id: p.worker_id, employee_code: p.worker_employee_code, display_name: p.worker_display_name }
      : null,
  }));
}

function samePackageRow(a, b) {
  return (
    a.id === b.id &&
    a.lcb_id === b.lcb_id &&
    a.section_label === b.section_label &&
    a.package_date === b.package_date &&
    a.has_before === b.has_before &&
    a.has_during === b.has_during &&
    a.has_after === b.has_after &&
    a.has_completion === b.has_completion &&
    a.display_id === b.display_id &&
    a.completion_pct === b.completion_pct &&
    a.photo_count === b.photo_count &&
    a.approval_status === b.approval_status &&
    a.decline_reason === b.decline_reason &&
    a.reviewed_by_name === b.reviewed_by_name &&
    a.reviewed_by_role === b.reviewed_by_role &&
    a.sent_to_export === b.sent_to_export &&
    a.sent_to_export_at === b.sent_to_export_at &&
    a.description === b.description &&
    a.street_name === b.street_name &&
    a.exported_by_name === b.exported_by_name &&
    a.exported_at === b.exported_at &&
    a.exported_format === b.exported_format &&
    a.export_count === b.export_count &&
    a.created_at === b.created_at &&
    (a.site?.id || null) === (b.site?.id || null) &&
    (a.site?.name || null) === (b.site?.name || null) &&
    (a.worker?.id || null) === (b.worker?.id || null) &&
    (a.worker?.employee_code || null) === (b.worker?.employee_code || null) &&
    (a.worker?.display_name || null) === (b.worker?.display_name || null)
  );
}

/** Keep previous row/array identity when a refetch returned the same data. */
export function reuseUnchangedPackages(prev, next) {
  if (!prev) return next;
  if (prev.length === next.length && next.every((row, i) => samePackageRow(prev[i], row))) {
    return prev;
  }
  const prevById = new Map(prev.map((row) => [row.id, row]));
  return next.map((row) => {
    const old = prevById.get(row.id);
    return old && samePackageRow(old, row) ? old : row;
  });
}

/** Cheap poll target for the heartbeat — a single timestamp, not the full list. */
export async function getPackagesHeadTimestamp() {
  const { data, error } = await supabaseProgress.rpc('staff_packages_head_timestamp', { p_manager_token: managerToken() });
  if (error) throw error;
  return data;
}

export async function getPackageImages(packageId) {
  const { data, error } = await supabaseProgress.rpc('staff_get_package_images', {
    p_package_id: packageId,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
  return data || [];
}

export async function getSignedUrl(storagePath) {
  const { data, error } = await supabaseProgress.storage.from('progress-photos').createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function approvePackage(id) {
  const { error } = await supabaseProgress.rpc('staff_approve_package', { p_package_id: id, p_manager_token: managerToken() });
  if (error) throw error;
  recordDocumentEventSafe({ kind: 'package', documentId: id, action: 'approved', summary: 'Package approved' });
}

/** Admin only — send the given approved package ids to the Export Only portal. */
export async function sendPackagesToExport(packageIds) {
  const ids = [...new Set((packageIds || []).filter(Boolean))];
  const { data, error } = await supabaseProgress.rpc('admin_send_packages_to_export', {
    p_package_ids: ids,
  });
  if (error) throw error;
  ids.forEach((id) => {
    recordDocumentEventSafe({
      kind: 'package',
      documentId: id,
      action: 'sent_to_export',
      summary: 'Sent to Export Only',
    });
  });
  return Number(data || 0);
}

/** Admin only — pull currently-sent package ids back out of the Export Only queue. */
export async function unsendPackagesFromExport(packageIds) {
  const ids = [...new Set((packageIds || []).filter(Boolean))];
  const { data, error } = await supabaseProgress.rpc('admin_unsend_packages_from_export', {
    p_package_ids: ids,
  });
  if (error) throw error;
  ids.forEach((id) => {
    recordDocumentEventSafe({
      kind: 'package',
      documentId: id,
      action: 'unsent',
      summary: 'Unsent from Export Only',
    });
  });
  return Number(data || 0);
}

export async function declinePackage(id, reason) {
  const { error } = await supabaseProgress.rpc('staff_decline_package', {
    p_package_id: id,
    p_reason: reason,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
  recordDocumentEventSafe({
    kind: 'package',
    documentId: id,
    action: 'declined',
    summary: 'Package declined',
    details: { reason },
  });
}

/**
 * sectionLabel / streetName: null leaves them as they are (migration 0070).
 * Without 0070 the older call still saves everything else.
 */
export async function updatePackageMetadata(id, { siteId, lcbId, packageDate, description, sectionLabel = null, streetName = null }) {
  const base = {
    p_package_id: id,
    p_site_id: siteId,
    p_lcb_id: lcbId,
    p_package_date: packageDate,
    p_manager_token: managerToken(),
    p_description: description ?? '',
  };
  let { error } = await supabaseProgress.rpc('staff_update_package_metadata', {
    ...base,
    p_section_label: sectionLabel,
    p_street_name: streetName,
  });
  if (error && isMissingRpcError(error)) {
    if (sectionLabel != null || streetName != null) {
      throw new Error('Apply migration 0070_staff_edit_package_name.sql in the Supabase SQL editor to change the section name or street name.');
    }
    ({ error } = await supabaseProgress.rpc('staff_update_package_metadata', base));
  }
  if (error) throw error;
  await invalidatePackageArtifact(id);
  recordDocumentEventSafe({
    kind: 'package',
    documentId: id,
    action: 'updated',
    summary: 'Package details updated',
    details: { siteId, lcbId, packageDate, description, sectionLabel, streetName },
  });
}

export async function setPackageCompletion(id, completionPct) {
  const { error } = await supabaseProgress.rpc('staff_set_package_completion', {
    p_package_id: id,
    p_completion_pct: completionPct,
    p_manager_token: managerToken(),
  });
  if (error) throw error;
}

export async function updateImageCaption(imageId, caption, packageId = null) {
  const { error } = await supabaseProgress.rpc('staff_update_image_caption', {
    p_image_id: imageId,
    p_caption: caption ?? '',
    p_manager_token: managerToken(),
  });
  if (error) throw error;
  await invalidatePackageArtifact(packageId);
}

/**
 * Saves a new photo order for ONE stage. `imageIds` must be every photo in that stage, in the
 * new order (the server rejects a stale or partial list). Admin or Manager; every viewer and
 * export (PDF / Excel / Export Only) reads the same order, so this is the only place it is set.
 */
export async function reorderPackageImages(packageId, stage, imageIds) {
  const { error } = await supabaseProgress.rpc('staff_reorder_package_images', {
    p_package_id: packageId,
    p_stage: stage,
    p_image_ids: imageIds,
    p_manager_token: managerToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Apply migration 0064_reorder_package_photos.sql in the Supabase SQL editor to reorder photos.');
    }
    throw error;
  }
  await invalidatePackageArtifact(packageId);
}

export async function uploadStaffPhoto(packageId, stage, file) {
  const path = `packages/${packageId}/${stage}/${Date.now()}_${file.name}`;
  const { error } = await supabaseProgress.storage
    .from('progress-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return path;
}

/** `images` items: { storagePath, verificationCode, sha256, phash }. */
export async function addStaffImages(packageId, stage, images) {
  const { error } = await supabaseProgress.rpc('staff_add_package_images', {
    p_package_id: packageId,
    p_stage: stage,
    p_images: images.map((img) => ({
      storage_path: img.storagePath,
      verification_code: img.verificationCode ?? null,
      sha256_hash: img.sha256 ?? null,
      phash: img.phash ?? null,
      caption: img.caption ?? null,
    })),
    p_manager_token: managerToken(),
  });
  if (error) throw error;
  await invalidatePackageArtifact(packageId);
}

/**
 * Admin, or a manager Admin has granted "delete_package_photos" (enforced server-side) — drop
 * the row first so the UI never keeps a broken path if Storage delete fails. The row deletion is
 * the authoritative, user-visible action, so a Storage cleanup failure afterward is logged
 * and swallowed rather than thrown — the row is already gone either way, and throwing here
 * would misreport a completed deletion as failed. (Only Admin's JWT can remove the Storage
 * file from the client; for a manager the RPC tries the cleanup itself, best effort.)
 */
export async function deletePackageImage(imageId, storagePath, packageId = null) {
  // Only send the token when there is one, so Admin's call still matches the
  // pre-0062 function signature if the migration has not been applied yet.
  const params = { p_image_id: imageId };
  const token = managerToken();
  if (token) params.p_manager_token = token;
  const { error } = await supabaseProgress.rpc('staff_delete_package_image', params);
  if (error) {
    if (token && isMissingRpcError(error)) throw new Error(PHOTO_DELETE_MIGRATION_HINT);
    throw error;
  }
  if (storagePath) {
    const { error: storageError } = await supabaseProgress.storage.from('progress-photos').remove([storagePath]);
    if (storageError) console.warn('[staffPackages] orphaned Storage file after delete:', storagePath, storageError);
  }
  await invalidatePackageArtifact(packageId);
}

/**
 * Admin only (also enforced server-side) — permanently deletes the whole
 * package, every photo in it, and its edit history. DB row goes first (via
 * cascade); its Storage files are then swept up separately since Storage
 * isn't FK-linked to package_images.
 */
export async function deletePackage(packageId) {
  let paths = [];
  try {
    const images = await getPackageImages(packageId);
    paths = images.map((i) => i.storage_path).filter(Boolean);
  } catch {
    /* if this fails we still proceed with deleting the package itself */
  }

  const { error } = await supabaseProgress.rpc('staff_delete_package', { p_package_id: packageId });
  if (error) throw error;

  if (paths.length) {
    // The package row (and its cascade) is already gone at this point — a Storage cleanup
    // failure here is a leftover-file problem, not a failed deletion, so log and move on.
    const { error: storageError } = await supabaseProgress.storage.from('progress-photos').remove(paths);
    if (storageError) console.warn('[staffPackages] orphaned Storage files after package delete:', paths, storageError);
  }
}
