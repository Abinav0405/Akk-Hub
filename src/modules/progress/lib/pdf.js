import { Capacitor } from '@capacitor/core';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { savePdfBlob, saveBlobs } from '@/modules/progress/lib/fileSave';

// A4 at 96dpi — matches the siblings' pdfDownload.js render width so the
// same html2canvas/jsPDF combination behaves the same way here.
const PAGE_W = 794;
const PAGE_H = 1123;

// Re-exported for existing callers of '@/lib/pdf' — the implementations live in
// fileSave.js (Capacitor-only, no html2canvas/jsPDF) so anything that only
// needs to save/share a blob doesn't have to pull in this whole PDF pipeline.
export { savePdfBlob, saveBlobs };

/**
 * Web: load the PDF into a hidden iframe and trigger the browser's native
 * print dialog (its built-in PDF viewer renders it, so "Save as PDF" is still
 * available from there if the user wants a file instead of an actual printout).
 * Capacitor WebView has no equivalent — falls back to the share sheet (savePdfBlob).
 */
export async function printPdfBlob(blob, fileName) {
  if (Capacitor.isNativePlatform()) {
    return savePdfBlob(blob, fileName);
  }

  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  const docName = String(fileName || 'document').replace(/\.pdf$/i, '');
  iframe.title = docName;
  // "Save as PDF" in the print dialog is named after the page title — show the document's
  // name there (e.g. the JSR number) while printing, then put the app's title back.
  const appTitle = document.title;
  document.title = docName;
  const restoreTitle = () => {
    if (document.title === docName) document.title = appTitle;
  };
  window.addEventListener('afterprint', restoreTitle, { once: true });
  setTimeout(restoreTitle, 120000);
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.src = url;

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 60000);
  };

  await new Promise((resolve) => {
    let settled = false;
    const finish = (openFallback) => {
      if (settled) return;
      settled = true;
      // print() returns once the dialog closes (Chrome, Edge); restore the tab title then.
      if (!openFallback) setTimeout(restoreTitle, 1000);
      if (openFallback) window.open(url, '_blank');
      cleanup();
      resolve();
    };
    iframe.onload = () => {
      if (settled) return; // the 4s fallback already printed — a late load event must not print again
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        finish(false);
      } catch (e) {
        console.warn('[pdf] print() failed, falling back to opening the PDF in a new tab:', e);
        finish(true);
      }
    };
    iframe.onerror = () => finish(true);
    setTimeout(() => {
      if (settled) return;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        finish(false);
      } catch {
        finish(true);
      }
    }, 4000);
    document.body.appendChild(iframe);
  });

  return { shared: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Renders one HTML fragment (a full page's worth of content) to a canvas at PAGE_W x PAGE_H. */
async function renderPageToCanvas(innerHtml, options = {}) {
  const native = Capacitor.isNativePlatform();
  // 3x the A4 CSS size is ~290 dpi on paper: type stays crisp when zoomed or printed.
  // (2x / ~190 dpi read as soft.) One page is rendered at a time, so memory stays bounded.
  const requested = Number(options.scale);
  const scale = Math.min(3, Number.isFinite(requested) && requested > 0 ? requested : 3);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'pdf-page-render');
  iframe.setAttribute('aria-hidden', 'true');
  // Android WebView html2canvas captures blank pages if the iframe is off-screen.
  // Keep it in the viewport at near-zero opacity instead of left:-10000px.
  iframe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${PAGE_W}px`,
    'max-width:none',
    `height:${PAGE_H}px`,
    'max-height:none',
    'border:0',
    'z-index:0',
    'opacity:0.02',
    'pointer-events:none',
    'background:#fff',
    'overflow:hidden',
  ].join(';');
  document.body.appendChild(iframe);

  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error('Could not prepare a PDF page');
    idoc.open();
    idoc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>* { box-sizing: border-box; } html, body { margin:0; width:${PAGE_W}px; height:${PAGE_H}px; overflow:hidden; background:#fff; color:#111111; font-weight:600; } img { border:0; }</style></head><body>${innerHtml}</body></html>`
    );
    idoc.close();

    await new Promise((r) => {
      if (idoc.readyState === 'complete') r();
      else iframe.addEventListener('load', () => r(), { once: true });
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (native) await sleep(80);

    const imgs = idoc.body.querySelectorAll('img');
    await Promise.all(
      [...imgs].map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, native ? 8000 : 4000);
          })
      )
    );
    if (native) await sleep(40);

    const shell = idoc.body.querySelector('[data-page-shell]') || idoc.body;
    return await html2canvas(shell, {
      width: PAGE_W,
      height: PAGE_H,
      windowWidth: PAGE_W,
      windowHeight: PAGE_H,
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      imageTimeout: native ? 8000 : 4000,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
    });
  } finally {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}

/** More than one image on a page = photos (every page already has the letterhead logo). */
function pageHasPhotos(html) {
  return (String(html || '').match(/<img\b/gi) || []).length > 1;
}

/**
 * Renders each HTML string in `pages` as its own full jsPDF page (no pixel-slicing).
 * Photo pages use a lower html2canvas scale + JPEG so multi-JSR claim PDFs stay
 * downloadable; text pages keep the sharper scale for type.
 *
 * options.photoScale — html2canvas scale for photo pages (default 2)
 * options.photoJpegQuality — JPEG quality for photo pages (default 0.8)
 * options.scale — html2canvas scale for text pages (default 3, capped at 3)
 * options.compactPhotos — claim-style tighter photo encode (scale 1.75, jpeg 0.72)
 */
export async function buildPdfFromPages(pages, _jpegQuality, onProgress, options) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  if (options?.title) {
    pdf.setProperties({ title: String(options.title) });
  }
  const compact = Boolean(options?.compactPhotos);
  const textScale = options?.scale;
  const photoScaleRaw = Number(options?.photoScale);
  const photoScale = Number.isFinite(photoScaleRaw) && photoScaleRaw > 0
    ? photoScaleRaw
    : compact ? 1.75 : 2;
  const jpegRaw = Number(options?.photoJpegQuality ?? _jpegQuality);
  const photoJpeg = Number.isFinite(jpegRaw) && jpegRaw > 0 && jpegRaw <= 1
    ? jpegRaw
    : compact ? 0.72 : 0.8;
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i + 1, pages.length);
    const photos = pageHasPhotos(pages[i]);
    const canvas = await renderPageToCanvas(pages[i], {
      ...options,
      scale: photos ? photoScale : textScale,
    });
    if (i > 0) pdf.addPage();
    // Text pages: lossless PNG keeps the type sharp and compresses well (mostly white).
    // Photo pages: JPEG at a moderate quality — a 3× PNG of photos is several MB each.
    // Full-bleed A4 — a margin would scale the bitmap down and soften it.
    if (photos) {
      pdf.addImage(canvas.toDataURL('image/jpeg', photoJpeg), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    } else {
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    }
    canvas.width = 0;
    canvas.height = 0;
  }
  return pdf.output('blob');
}
