import { packageHeading } from '@/modules/progress/lib/sectionLabel';
import { STAGE_PICKER_LABELS } from '@/modules/progress/lib/config';
import { getPackageImages, getSignedUrl } from '@/modules/progress/lib/staffPackages';
import { getMyPackageImages } from '@/modules/progress/lib/packages';
import { getExporterPackageImages, isExporterAuthenticated } from '@/modules/progress/lib/exporterPackages';
import { isManagerAuthenticated } from '@/core/auth/progress/managerSession';
import { isWorkerAuthenticated } from '@/core/auth/progress/workerSession';
import { storageKey } from '@/core/storage'

const PACKAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FROM_PAGES = new Set([
  'AdminDashboard',
  'ManagerDashboard',
  'ExporterDashboard',
  'MySubmissions',
  'Home',
]);

export function parsePackageId(value) {
  const id = String(value || '').trim();
  return PACKAGE_ID_RE.test(id) ? id : '';
}

export function parseFromPage(value) {
  return FROM_PAGES.has(value) ? value : 'Home';
}

export function sanitizeVerifyLabel(value) {
  return String(value || '').trim().slice(0, 140);
}

/** Link from a package card to the verification page, which then checks every photo. */
export function packageVerifyHref(pkg, fromPage) {
  const params = new URLSearchParams();
  params.set('package', pkg.id);
  if (fromPage && FROM_PAGES.has(fromPage)) params.set('from', fromPage);
  const label = packageHeading(pkg);
  if (label) params.set('label', label);
  if (pkg.package_date) params.set('date', String(pkg.package_date));
  return `${'/verify'}?${params.toString()}`;
}

function isAdminFlag() {
  try {
    return localStorage.getItem(storageKey('progress', 'adminLoggedIn')) === 'true' || sessionStorage.getItem(storageKey('progress', 'adminLoggedIn')) === 'true';
  } catch {
    return false;
  }
}

function hasAnyVerifySession() {
  return isExporterAuthenticated() || isManagerAuthenticated() || isAdminFlag() || isWorkerAuthenticated();
}

async function loadPackageImageRows(packageId) {
  if (!hasAnyVerifySession()) {
    throw new Error('Sign in to verify this package’s stored photos');
  }
  const order = [];
  if (isExporterAuthenticated()) order.push('exporter');
  else if (isManagerAuthenticated() || isAdminFlag()) order.push('staff');
  else if (isWorkerAuthenticated()) order.push('worker');
  for (const extra of ['staff', 'worker', 'exporter']) {
    if (!order.includes(extra)) order.push(extra);
  }

  let lastError;
  for (const kind of order) {
    try {
      if (kind === 'exporter') return (await getExporterPackageImages(packageId)) || [];
      if (kind === 'staff') return (await getPackageImages(packageId)) || [];
      if (kind === 'worker') return (await getMyPackageImages(packageId)) || [];
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Could not load package photos');
}

/** Signed-URL rows for every photo on a package, ready for pooled verification. */
export async function listPackagePhotosForVerification(packageId) {
  const rows = await loadPackageImageRows(packageId);
  const withUrls = await Promise.all(
    rows.map(async (row, index) => {
      let previewUrl = null;
      try {
        // Full object, no image transform — thumbnails would be too small to read the barcode.
        previewUrl = await getSignedUrl(row.storage_path);
      } catch {
        previewUrl = null;
      }
      const stageLabel = STAGE_PICKER_LABELS[row.stage] || row.stage || 'Photo';
      return {
        id: row.id || `pkg-${index}`,
        stage: row.stage,
        sort_order: row.sort_order,
        previewUrl,
        verifyUrl: previewUrl,
        label: `${stageLabel} ${Number(row.sort_order) + 1}`,
        source: 'package',
      };
    })
  );
  return withUrls;
}
