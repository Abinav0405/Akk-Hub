import { getPackageImages, getSignedUrl } from '@/modules/progress/lib/staffPackages';
import { blobUrlToDataUrl } from '@/modules/progress/lib/imageDataUrl';
import { getExporterPackageImages, isExporterAuthenticated, recordExporterPackageExport } from '@/modules/progress/lib/exporterPackages';

export async function getPackageImagesForViewer(packageId, { asExporter = false } = {}) {
  if (asExporter) return getExporterPackageImages(packageId);
  return getPackageImages(packageId);
}

export async function loadStagePhotos(packageId, { asExporter = false } = {}) {
  const images = await getPackageImagesForViewer(packageId, { asExporter });
  if (!images.length) {
    return { stagePhotos: { before: [], during: [], after: [], completion: [] }, loaded: 0, total: 0 };
  }

  const raw = await Promise.all(
    images.map(async (img) => {
      try {
        const url = await getSignedUrl(img.storage_path);
        const dataUrl = await blobUrlToDataUrl(url);
        return { stage: img.stage, dataUrl, caption: img.caption || '' };
      } catch (e) {
        console.warn('[packageExport] skipping a photo that failed to load:', img.storage_path, e);
        return null;
      }
    })
  );
  const loadedRows = raw.filter(Boolean);
  const stagePhotos = { before: [], during: [], after: [], completion: [] };
  loadedRows.forEach((row) => {
    if (stagePhotos[row.stage]) stagePhotos[row.stage].push({ dataUrl: row.dataUrl, caption: row.caption || '' });
  });
  return { stagePhotos, loaded: loadedRows.length, total: images.length };
}

export function packageSiteName(pkg) {
  return pkg?.site?.name || pkg?.site_name || '';
}

export function packageExportMeta(pkg) {
  return {
    displayId: pkg?.display_id || '',
    packageDate: pkg?.package_date,
    siteName: packageSiteName(pkg),
    lcbId: pkg?.lcb_id,
    sectionLabel: pkg?.section_label,
    description: pkg?.description || '',
    streetName: pkg?.street_name || '',
  };
}

/** Logs a successful Export Only portal download. Never throws — download already succeeded. */
export async function noteExporterDownloads(packageIds, format, { asExporter = false } = {}) {
  if (!asExporter || !isExporterAuthenticated() || !packageIds?.length) return;
  const unique = [...new Set(packageIds.filter(Boolean))];
  await Promise.all(
    unique.map((id) =>
      recordExporterPackageExport(id, format).catch((e) => {
        console.warn('[packageExport] could not record export for', id, e);
      })
    )
  );
}
