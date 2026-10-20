/*
 * The open/close state of the in-app print preview. Split from printDocument.js
 * so the Android back-button hook (in the startup bundle) can close a preview
 * without loading the PDF/print code.
 */
export const PREVIEW_ID = 'akk-print-preview-root';

export function isPrintPreviewOpen() {
  return !!document.getElementById(PREVIEW_ID);
}

export function closePrintPreview() {
  const el = document.getElementById(PREVIEW_ID);
  if (el) {
    try {
      const blobUrl = el.dataset.blobUrl;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    } catch {
      /* ignore */
    }
    el.remove();
  }
  document.body.style.overflow = '';
  return true;
}
