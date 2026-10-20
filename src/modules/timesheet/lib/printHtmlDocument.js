import { Capacitor } from '@capacitor/core';
import { shareHtmlAsPdf } from '@/modules/timesheet/lib/pdfDownload';

function normalizeToFullHtmlDocument(html) {
    if (!html || typeof html !== 'string') {
        return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>(No content)</p></body></html>';
    }

    const trimmed = html.trim();
    if (/^<!DOCTYPE/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
        return trimmed;
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${trimmed}</body></html>`;
}

/**
 * Mobile-safe print path: render HTML in a hidden iframe, then trigger print.
 * This avoids popup/new-tab behavior that is unreliable in Capacitor WebViews.
 */
export function printHtmlDocument(html, options = {}) {
    const {
        title = 'Print document',
        printDelayMs = 300,
        cleanupDelayMs = 3000,
        onError,
    } = options;

    const fullHtml = normalizeToFullHtmlDocument(html);
    const iframe = document.createElement('iframe');
    iframe.setAttribute(
        'style',
        'position:fixed;left:0;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none;visibility:hidden'
    );
    iframe.setAttribute('title', title);
    document.body.appendChild(iframe);

    const idoc = iframe.contentDocument || iframe.contentWindow?.document;
    const iwin = iframe.contentWindow;
    if (!idoc || !iwin) {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        throw new Error('Print could not be prepared in this browser');
    }

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    idoc.open();
    idoc.write(fullHtml);
    idoc.close();

    iwin.addEventListener('afterprint', cleanup, { once: true });

    setTimeout(() => {
        try {
            iwin.focus();
            iwin.print();
        } catch (error) {
            cleanup();
            if (typeof onError === 'function') onError(error);
            return;
        }
        setTimeout(cleanup, cleanupDelayMs);
    }, printDelayMs);

    return cleanup;
}

function defaultPdfFileName(title) {
    const safe = String(title || 'Document')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 48);
    return `${safe || 'Document'}_${Date.now()}.pdf`;
}

/**
 * Web: hidden iframe + print dialog.
 * Native Capacitor: PDF blob + Share sheet (print() is unreliable in WebView).
 */
export async function printOrShareHtmlDocument(html, options = {}) {
    const {
        title = 'Print document',
        fileName,
        printDelayMs = 350,
    } = options;

    if (Capacitor.isNativePlatform()) {
        await shareHtmlAsPdf(html, fileName || defaultPdfFileName(title));
        return { mode: 'share' };
    }

    printHtmlDocument(html, { title, printDelayMs });
    return { mode: 'print' };
}
