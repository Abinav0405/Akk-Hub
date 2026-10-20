import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result;
            if (typeof dataUrl !== 'string') {
                reject(new Error('Unexpected read result'));
                return;
            }
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            resolve(base64);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * Desktop / mobile browser: trigger a real file download.
 * Capacitor WebView: write PDF to cache and open the share sheet (Save to Downloads, Drive, Files, etc.).
 */
export async function savePdfBlob(blob, fileName) {
    const safeName = (fileName || 'document.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'document.pdf';

    if (!Capacitor.isNativePlatform()) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = safeName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
    }

    const base64Data = await blobToBase64(blob);

    await Filesystem.writeFile({
        path: safeName,
        data: base64Data,
        directory: Directory.Cache,
    });

    const { uri } = await Filesystem.getUri({
        path: safeName,
        directory: Directory.Cache,
    });

    try {
        try {
            await Share.share({
                title: safeName,
                text: 'Save or share this PDF',
                files: [uri],
                dialogTitle: 'Save PDF',
            });
        } catch (e) {
            const fallbackUrl = uri || '';
            await Share.share({
                title: safeName,
                text: 'Save or share this PDF',
                url: fallbackUrl,
                dialogTitle: 'Save PDF',
            });
        }
    } catch (e) {
        const m = e && (e.message || String(e));
        if (/cancel|dismiss|abort/i.test(m)) return;
        throw e;
    }
}

/** Ensure we have a full HTML document for iframe document.write */
function normalizeToFullHtmlDocument(html) {
    if (!html || typeof html !== 'string') {
        return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>(No content)</p></body></html>';
    }
    const t = html.trim();
    if (/^<!DOCTYPE/i.test(t) || /<html[\s>]/i.test(t)) {
        return t;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${t}</body></html>`;
}

/**
 * Split a tall canvas into A4 portrait pages (same for payslip and timesheet).
 */
function canvasToPdfBlob(canvas, marginMm = [10, 10, 10, 10], jpegQuality = 0.92) {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const inner = {
        width: pageW - marginMm[1] - marginMm[3],
        height: pageH - marginMm[0] - marginMm[2],
    };
    inner.ratio = inner.height / inner.width;

    const pxFullHeight = canvas.height;
    const pxPageHeight = Math.floor(canvas.width * inner.ratio);
    const nPages = Math.max(1, Math.ceil(pxFullHeight / pxPageHeight) || 1);

    const pageCanvas = document.createElement('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    pageCanvas.width = canvas.width;

    for (let page = 0; page < nPages; page++) {
        if (page === nPages - 1 && pxFullHeight % pxPageHeight !== 0) {
            pageCanvas.height = pxFullHeight % pxPageHeight;
        } else {
            pageCanvas.height = pxPageHeight;
        }

        let pageHeightMm = inner.height;
        if (page === nPages - 1 && pxFullHeight % pxPageHeight !== 0) {
            pageHeightMm = (pageCanvas.height * inner.width) / pageCanvas.width;
        }

        const w = pageCanvas.width;
        const h = pageCanvas.height;
        pageCtx.fillStyle = 'white';
        pageCtx.fillRect(0, 0, w, h);
        pageCtx.drawImage(canvas, 0, page * pxPageHeight, w, h, 0, 0, w, h);

        const imgData = pageCanvas.toDataURL('image/jpeg', jpegQuality);
        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', marginMm[1], marginMm[0], inner.width, pageHeightMm);
    }

    return pdf.output('blob');
}

function waitForImages(root) {
    const imgs = root.querySelectorAll('img');
    return Promise.all(
        [...imgs].map(
            (img) =>
                new Promise((resolve) => {
                    if (img.complete && img.naturalWidth > 0) return resolve();
                    const done = () => resolve();
                    img.addEventListener('load', done, { once: true });
                    img.addEventListener('error', done, { once: true });
                    setTimeout(done, 4000);
                })
        )
    );
}

/**
 * Render HTML to PDF: iframe + html2canvas + jsPDF (identical path for payslip and timesheet).
 */
export async function htmlToPdfBlob(html) {
    const fullHtml = normalizeToFullHtmlDocument(html);
    const captureWidth = 794;
    const captureHeight = 1123;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'pdf-render');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        `width:${captureWidth}px`,
        'max-width:none',
        `height:${captureHeight}px`,
        'max-height:none',
        'border:0',
        'z-index:2147483646',
        'opacity:1',
        'pointer-events:none',
        'background:#fff',
        'overflow:auto',
    ].join(';');

    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument;
    idoc.open();
    idoc.write(fullHtml);
    idoc.close();

    await new Promise((r) => {
        if (idoc.readyState === 'complete') r();
        else iframe.addEventListener('load', () => r(), { once: true });
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const waitMs = Capacitor.isNativePlatform() ? 500 : 250;
    await new Promise((r) => setTimeout(r, waitMs));

    const body = idoc.body;
    if (!body) {
        document.body.removeChild(iframe);
        throw new Error('PDF render: empty document');
    }

    await waitForImages(body);

    const scrollH = Math.max(
        idoc.documentElement?.scrollHeight ?? 0,
        body.scrollHeight ?? 0,
        body.offsetHeight ?? 0,
        400
    );

    try {
        const canvas = await html2canvas(body, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#ffffff',
            scrollX: 0,
            scrollY: 0,
            windowWidth: captureWidth,
            windowHeight: scrollH,
            foreignObjectRendering: false,
        });

        if (!canvas.width || !canvas.height) {
            throw new Error('PDF render: canvas is empty');
        }

        return canvasToPdfBlob(canvas, [10, 10, 10, 10], 0.92);
    } finally {
        if (iframe.parentNode) document.body.removeChild(iframe);
    }
}

export async function shareHtmlAsPdf(html, fileName) {
    const blob = await htmlToPdfBlob(html);
    await savePdfBlob(blob, fileName);
}
