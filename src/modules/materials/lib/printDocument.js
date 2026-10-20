import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { formatFileDate } from '@/modules/materials/lib/dates';
import { PREVIEW_ID, closePrintPreview } from '@/modules/materials/lib/printPreviewState';

export { isPrintPreviewOpen, closePrintPreview } from '@/modules/materials/lib/printPreviewState';

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function removePreview() {
  closePrintPreview();
}

/** Ensure preview HTML can grow so the outer scroller works on Android WebView */
function preparePreviewHtml(html) {
  const scrollFix = `
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style id="akk-native-preview-fix">
  html, body {
    height: auto !important;
    min-height: 100% !important;
    overflow: visible !important;
    -webkit-overflow-scrolling: touch !important;
    touch-action: pan-y !important;
    background: #fff !important;
  }
</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${scrollFix}`);
  }
  return `<!DOCTYPE html><html><head>${scrollFix}</head><body>${html}</body></html>`;
}

/**
 * AKK Material Tracker-{ID}-{date}-{formName}.pdf
 * @param {{ id?: string, date?: string, formName?: string, fileName?: string }} meta
 */
export function buildAkkPrintFileName(meta = {}) {
  if (meta.fileName) {
    const raw = String(meta.fileName).trim();
    return raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`;
  }

  const today = new Date();
  const fallbackDate = formatFileDate(today);

  const part = (value, fallback) => {
    const s = String(value ?? fallback ?? 'NA')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return s || fallback || 'NA';
  };

  return `AKK Material Tracker-${part(meta.id, 'NA')}-${part(formatFileDate(meta.date) || fallbackDate, fallbackDate)}-${part(meta.formName, 'Document')}.pdf`;
}

/**
 * Render HTML → multi-page A4 PDF (base64, no data: prefix).
 */
async function htmlToPdfBase64(html) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-12000px',
    top: '0',
    width: '794px',
    height: '1123px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(iframe);

  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw err('PDF_FAILED', 'Could not create PDF renderer');

    idoc.open();
    idoc.write(preparePreviewHtml(html));
    idoc.close();

    await new Promise((resolve) => setTimeout(resolve, 450));

    const target = idoc.body || idoc.documentElement;
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: Math.max(target.scrollWidth || 0, 794),
      windowHeight: Math.max(target.scrollHeight || 0, 600),
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.88);

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 1) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const dataUri = pdf.output('datauristring');
    const base64 = dataUri.split(',')[1];
    if (!base64) throw err('PDF_FAILED', 'PDF encoding failed');
    return base64;
  } finally {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  }
}

async function sharePdfDocument(html, fileName) {
  const name = fileName || buildAkkPrintFileName({});
  toast.message('Creating PDF…', { duration: 2000 });
  const base64 = await htmlToPdfBase64(html);

  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    try {
      await Filesystem.deleteFile({ path: name, directory: Directory.Cache });
    } catch {
      /* ok */
    }

    await Filesystem.writeFile({
      path: name,
      data: base64,
      directory: Directory.Cache,
    });

    const { uri } = await Filesystem.getUri({
      path: name,
      directory: Directory.Cache,
    });

    const can = await Share.canShare().catch(() => ({ value: true }));
    if (can && can.value === false) {
      throw err('SHARE_UNSUPPORTED', 'Sharing is not available on this device.');
    }

    await Share.share({
      title: 'AKK Material Tracker',
      text: name,
      url: uri,
      files: [uri],
      dialogTitle: 'Share / Print PDF',
    });
    return true;
  }

  // Web: download the PDF
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return false;
}

/**
 * In-app print preview for Capacitor / Android WebView.
 * Share / Print exports a real PDF.
 */
function openNativePrintPreview(html, meta = {}) {
  removePreview();

  const fileName = buildAkkPrintFileName(meta);
  const prepared = preparePreviewHtml(html);
  const blob = new Blob([prepared], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  const root = document.createElement('div');
  root.id = PREVIEW_ID;
  root.dataset.blobUrl = blobUrl;
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    display: 'flex',
    flexDirection: 'column',
    background: '#0f172a',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  });

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '10px 12px',
    background: '#1e293b',
    color: '#fff',
    flexShrink: '0',
  });

  const title = document.createElement('div');
  title.textContent = 'PDF preview';
  Object.assign(title.style, {
    fontSize: '15px',
    fontWeight: '600',
    fontFamily: 'system-ui, sans-serif',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '42vw',
  });

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexShrink: '0',
  });

  const mkBtn = (label, primary) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    Object.assign(btn.style, {
      border: 'none',
      borderRadius: '10px',
      padding: '10px 14px',
      fontSize: '14px',
      fontWeight: '600',
      fontFamily: 'system-ui, sans-serif',
      cursor: 'pointer',
      background: primary ? '#dc6b2f' : '#334155',
      color: '#fff',
      whiteSpace: 'nowrap',
    });
    return btn;
  };

  const closeBtn = mkBtn('Close', false);
  const shareBtn = mkBtn('Share PDF', true);

  closeBtn.addEventListener('click', () => removePreview());

  const onKey = (e) => {
    if (e.key === 'Escape') removePreview();
  };
  document.addEventListener('keydown', onKey);

  const scroller = document.createElement('div');
  Object.assign(scroller.style, {
    flex: '1',
    minHeight: '0',
    overflowX: 'hidden',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    touchAction: 'pan-y',
    background: '#e2e8f0',
    overscrollBehavior: 'contain',
  });

  const iframe = document.createElement('iframe');
  iframe.title = 'Print preview';
  iframe.setAttribute('scrolling', 'no');
  iframe.src = blobUrl;
  Object.assign(iframe.style, {
    display: 'block',
    width: '100%',
    border: '0',
    background: '#fff',
    height: '80vh',
    minHeight: '80vh',
    pointerEvents: 'none',
  });

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    flexShrink: '0',
    padding: '8px 12px',
    background: '#0f172a',
    color: '#94a3b8',
    fontSize: '12px',
    fontFamily: 'system-ui, sans-serif',
    textAlign: 'center',
    lineHeight: '1.35',
  });
  hint.textContent = `Share PDF · ${fileName}`;

  const resizeIframe = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const h = Math.max(
        doc.documentElement?.scrollHeight || 0,
        doc.body?.scrollHeight || 0,
        doc.documentElement?.offsetHeight || 0,
        600
      );
      iframe.style.height = `${h + 24}px`;
    } catch {
      /* ignore */
    }
  };

  iframe.addEventListener('load', () => {
    resizeIframe();
    setTimeout(resizeIframe, 300);
    setTimeout(resizeIframe, 1000);
  });

  shareBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (shareBtn.disabled) return;
    shareBtn.disabled = true;
    const prev = shareBtn.textContent;
    shareBtn.textContent = 'Creating PDF…';
    try {
      const shared = await sharePdfDocument(html, fileName);
      if (shared) {
        toast.success('PDF ready', {
          description: 'Pick Drive, Files, or a printer app.',
        });
      } else {
        toast.success('PDF downloaded', { description: fileName });
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        // cancelled
      } else {
        console.error('PDF share failed:', e);
        toast.error(e?.message || 'Could not create PDF.', {
          description: 'Try again, or print from the website on a computer.',
        });
      }
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = prev;
    }
  });

  actions.appendChild(closeBtn);
  actions.appendChild(shareBtn);
  bar.appendChild(title);
  bar.appendChild(actions);
  scroller.appendChild(iframe);
  root.appendChild(bar);
  root.appendChild(scroller);
  root.appendChild(hint);
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';

  const observer = new MutationObserver(() => {
    if (!document.getElementById(PREVIEW_ID)) {
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });

  toast.message('Document ready', {
    description: 'Scroll to review, then tap Share PDF.',
    duration: 3000,
  });

  return { ok: true, method: 'native-preview-pdf', fileName };
}

function openDesktopPrintWindow(html) {
  const printWindow = window.open('', '_blank', 'height=700,width=900');
  if (!printWindow || !printWindow.document) {
    return null;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  try {
    printWindow.focus();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      printWindow.print();
    } catch {
      /* ignore */
    }
  }, 200);
  return { ok: true, method: 'window' };
}

function openIframePrint(html) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Print');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc) {
    iframe.remove();
    throw err('PRINT_FAILED', 'Could not create print frame');
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  setTimeout(() => {
    try {
      win.focus();
      win.print();
      setTimeout(cleanup, 1500);
    } catch {
      cleanup();
      throw err('PRINT_FAILED', 'Print dialog could not be opened.');
    }
  }, 250);

  return { ok: true, method: 'iframe' };
}

/**
 * Open document for print / PDF share.
 * @param {string} html
 * @param {{ id?: string, date?: string, formName?: string, fileName?: string }} [meta]
 */
export function openPrintDocument(html, meta = {}) {
  if (Capacitor.isNativePlatform()) {
    return openNativePrintPreview(html, meta);
  }

  // Website: keep browser print (Save as PDF works in Chrome).
  // Also kick off a PDF download with the proper name.
  sharePdfDocument(html, buildAkkPrintFileName(meta)).catch((e) => {
    console.warn('PDF download skipped:', e);
  });

  try {
    const viaWindow = openDesktopPrintWindow(html);
    if (viaWindow) return { ...viaWindow, fileName: buildAkkPrintFileName(meta) };
  } catch {
    /* fall through */
  }

  try {
    return { ...openIframePrint(html), fileName: buildAkkPrintFileName(meta) };
  } catch (e) {
    if (e?.code) throw e;
    throw err(
      'POPUP_BLOCKED',
      'Pop-up blocked. Please allow pop-ups to print, or try again.'
    );
  }
}

export function printFailureMessage(error) {
  if (!error) return 'Failed to print. Please try again.';
  if (
    error.code === 'POPUP_BLOCKED' ||
    error.code === 'PRINT_FAILED' ||
    error.code === 'PDF_FAILED'
  ) {
    return error.message;
  }
  if (error.code === 'NO_TRANSACTIONS') {
    return 'No transactions to print';
  }
  if (error.code === 'SHARE_UNSUPPORTED') {
    return error.message;
  }
  return error.message || 'Failed to print. Please try again.';
}
