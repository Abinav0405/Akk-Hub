import { supabaseProgress } from '@/core/supabase'
import { getWorkerSessionToken } from '@/core/auth/progress/workerSession';
import { isMissingRpcError } from '@/modules/progress/lib/networkError';

function throwIfRpcError(error) {
  if (!error) return;
  throw new Error(error.message || 'Request failed');
}

function requireToken() {
  const token = getWorkerSessionToken();
  if (!token) throw new Error('Not logged in');
  return token;
}

export async function listActiveSites() {
  const { data, error } = await supabaseProgress
    .from('sites')
    .select('id, name, section_label')
    .eq('is_active', true)
    .order('name');
  if (error) throwIfRpcError(error);
  return data || [];
}

export async function listLinkablePackages(stage) {
  const { data, error } = await supabaseProgress.rpc('worker_list_linkable_packages', {
    p_session_token: requireToken(),
    p_stage: stage,
  });
  if (error) throwIfRpcError(error);
  return data || [];
}

export async function createPackage({ siteId, lcbId, packageDate, kind = 'service' }) {
  const { data, error } = await supabaseProgress.rpc('worker_create_package', {
    p_session_token: requireToken(),
    p_site_id: siteId,
    p_lcb_id: lcbId ?? '',
    p_package_date: packageDate,
    p_kind: kind,
  });
  if (error) throwIfRpcError(error);
  return data; // new package id
}

/**
 * Saves the section name, street name and description picked for the site (migration 0069).
 * Null leaves a field unchanged; '' clears it.
 */
export async function setMyPackageDetails(packageId, { sectionLabel = null, streetName = null, description = null } = {}) {
  const { error } = await supabaseProgress.rpc('worker_set_package_details', {
    p_session_token: requireToken(),
    p_package_id: packageId,
    p_section_label: sectionLabel,
    p_street_name: streetName,
    p_description: description,
  });
  if (error) throwIfRpcError(error);
}

/** Uploads one captured photo blob to Storage and returns its storage_path. */
export async function uploadPackagePhoto({ packageId, stage, blob, index }) {
  const path = `packages/${packageId}/${stage}/${Date.now()}_${index}.jpg`;
  const { error } = await supabaseProgress.storage
    .from('progress-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throwIfRpcError(error);
  return path;
}

/** Best-effort cleanup if a submit fails after some files already landed in Storage. */
export async function removeUploadedPhotos(paths) {
  if (!paths?.length) return;
  await supabaseProgress.storage.from('progress-photos').remove(paths);
}

/** Records already-uploaded photos against a package + stage. `photos` items carry capture metadata. */
export async function addPackageImages({ packageId, stage, photos }) {
  const images = photos.map((p) => ({
    storage_path: p.storagePath,
    captured_at: p.capturedAt,
    captured_lat: p.lat ?? null,
    captured_lng: p.lng ?? null,
    captured_address: p.address ?? null,
    captured_accuracy: p.accuracy ?? null,
    caption: p.caption ?? null,
    verification_code: p.verificationCode ?? null,
    sha256_hash: p.sha256 ?? null,
    phash: p.phash ?? null,
  }));
  const { error } = await supabaseProgress.rpc('worker_add_package_images', {
    p_session_token: requireToken(),
    p_package_id: packageId,
    p_stage: stage,
    p_images: images,
  });
  if (error) throwIfRpcError(error);
}

export async function listMyPackages() {
  const { data, error } = await supabaseProgress.rpc('worker_list_my_packages', {
    p_session_token: requireToken(),
  });
  if (error) throwIfRpcError(error);
  return (data || []).map((p) => ({
    ...p,
    submitted_to_staff: Boolean(p.submitted_to_staff),
  }));
}

/** Sends a saved package (with Completion photos) to Admin/Manager. */
export async function submitMyPackage(packageId) {
  const { error } = await supabaseProgress.rpc('worker_submit_package', {
    p_session_token: requireToken(),
    p_package_id: packageId,
  });
  if (error) throwIfRpcError(error);
}

/** Cheap poll target for the heartbeat — a single timestamp, not the full list. */
export async function getMyPackagesHeadTimestamp() {
  const { data, error } = await supabaseProgress.rpc('worker_packages_head_timestamp', {
    p_session_token: requireToken(),
  });
  if (error) throwIfRpcError(error);
  return data;
}

export async function getMyPackageImages(packageId) {
  const { data, error } = await supabaseProgress.rpc('worker_get_package_images', {
    p_session_token: requireToken(),
    p_package_id: packageId,
  });
  if (error) throwIfRpcError(error);
  return data || [];
}

export async function getPhotoUrl(storagePath) {
  const { data, error } = await supabaseProgress.storage
    .from('progress-photos')
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throwIfRpcError(error);
  return data.signedUrl;
}

/**
 * Employee/technician only — pending or declined packages they own. Row is
 * deleted first (authoritative). Storage cleanup is also done in the RPC
 * because workers are not Auth users and cannot pass Storage RLS; a leftover
 * file after that is logged, not thrown.
 */
export async function deleteMyPackageImage(imageId, storagePath) {
  const { error } = await supabaseProgress.rpc('worker_delete_package_image', {
    p_session_token: requireToken(),
    p_image_id: imageId,
  });
  if (error) throwIfRpcError(error);
  if (storagePath) {
    const { error: storageError } = await supabaseProgress.storage.from('progress-photos').remove([storagePath]);
    if (storageError) console.warn('[packages] orphaned Storage file after delete:', storagePath, storageError);
  }
}

export async function setMyPackageDescription(packageId, description) {
  const { error } = await supabaseProgress.rpc('worker_set_package_description', {
    p_session_token: requireToken(),
    p_package_id: packageId,
    p_description: description ?? '',
  });
  if (!error) return;
  // A database where 0046 never applied has no worker_set_package_description (0075
  // restores it). worker_set_package_details (0069) saves the description the same way.
  if (isMissingRpcError(error)) {
    await setMyPackageDetails(packageId, { description: description ?? '' });
    return;
  }
  throwIfRpcError(error);
}

export async function setMyPackageCompletion(packageId, completionPct) {
  const { error } = await supabaseProgress.rpc('worker_set_package_completion', {
    p_session_token: requireToken(),
    p_package_id: packageId,
    p_completion_pct: completionPct,
  });
  if (error) throwIfRpcError(error);
}

export async function updateMyImageCaption(imageId, caption) {
  const { error } = await supabaseProgress.rpc('worker_update_image_caption', {
    p_session_token: requireToken(),
    p_image_id: imageId,
    p_caption: caption ?? '',
  });
  if (error) throwIfRpcError(error);
}

/**
 * Employee/technician only — own pending or declined package (not approved).
 * DB row goes first (RPC also sweeps Storage by prefix because workers cannot
 * pass Storage RLS). A leftover file after that is logged, not thrown.
 */
export async function deleteMyPackage(packageId) {
  let paths = [];
  try {
    const images = await getMyPackageImages(packageId);
    paths = images.map((i) => i.storage_path).filter(Boolean);
  } catch {
    /* still delete the package itself */
  }

  const { error } = await supabaseProgress.rpc('worker_delete_package', {
    p_session_token: requireToken(),
    p_package_id: packageId,
  });
  if (error) throwIfRpcError(error);

  if (paths.length) {
    const { error: storageError } = await supabaseProgress.storage.from('progress-photos').remove(paths);
    if (storageError) console.warn('[packages] orphaned Storage files after package delete:', paths, storageError);
  }
}
