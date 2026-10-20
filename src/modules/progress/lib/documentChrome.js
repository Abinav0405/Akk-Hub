import { escapeHtml } from '@/modules/progress/lib/utils';

/** Near-black ink. Light gray and low-opacity labels print faint and look soft in html2canvas. */
export const DOC_INK = '#111111';
export const DOC_LABEL = '#1a1a1a';
export const DOC_LINE = '#cbd5e1';
/** Solid light red — a thin rule, not a transparent gray. */
export const DOC_FOOTER_RULE = '#e7a8a8';
/** Sample letterhead rule. A thin red line under the header, not orange. */
export const DOC_ACCENT = '#c0392b';
export const DOC_HEADER_BG = '#1a1a1a';
export const DOC_FONT = 'Arial, Helvetica, sans-serif';
/** One company address on every document header (Branding can override it). */
export const DOC_COMPANY_ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';

export const DOC_PAGE_W = 794;
export const DOC_PAGE_H = 1123;
/** Left pad clears a ring binder. Bottom pad keeps body text above the footer rule. */
export const DOC_PAD = { top: 28, right: 40, bottom: 72, left: 89 };

/** Height of the repeating letterhead, including the gap before the body. */
export const DOC_HEADER_BUDGET = 136;

export const DOCUMENT_KIND = {
  package: 'Package Report',
  jsr: 'Job Service Report',
  claim: 'Progress Claim',
  invoice: 'Invoice',
};

export const DEFAULT_DOCUMENT_CHROME = {
  header_show_logo: true,
  header_show_name: true,
  header_extra: '',
  footer_show_page: true,
  footer_show_rule: true,
  footer_extra: '',
};

function asBool(value, fallback) {
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  return fallback;
}

function clipText(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeDocumentChrome(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    header_show_logo: asBool(src.header_show_logo, DEFAULT_DOCUMENT_CHROME.header_show_logo),
    header_show_name: asBool(src.header_show_name, DEFAULT_DOCUMENT_CHROME.header_show_name),
    header_extra: clipText(src.header_extra),
    footer_show_page: asBool(src.footer_show_page, DEFAULT_DOCUMENT_CHROME.footer_show_page),
    footer_show_rule: asBool(src.footer_show_rule, DEFAULT_DOCUMENT_CHROME.footer_show_rule),
    footer_extra: clipText(src.footer_extra),
  };
}

/**
 * Same header on every page: logo, company name, and tagline on the left;
 * document title and number on the right; a red rule underneath.
 * Package detail tables and descriptions are not part of this header.
 */
export function documentHeaderHtml({
  logoSrc,
  companyName,
  kind,
  chrome,
  docNo,
  subtitle,
  address,
} = {}) {
  const c = normalizeDocumentChrome(chrome);
  const logo = c.header_show_logo && logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="" width="52" height="52" style="width:52px;height:52px;object-fit:contain;flex-shrink:0;display:block;border:0;" />`
    : '';
  const name = c.header_show_name && String(companyName || '').trim()
    ? `<div style="font-size:15px;font-weight:700;letter-spacing:0.01em;line-height:1.25;color:${DOC_INK};overflow-wrap:break-word;">${escapeHtml(companyName)}</div>`
    : '';
  const extra = c.header_extra
    ? `<div style="margin-top:2px;font-size:11px;font-weight:600;line-height:1.35;color:#333333;overflow-wrap:break-word;">${escapeHtml(c.header_extra)}</div>`
    : '';
  const addr = String(address || '').trim() || DOC_COMPANY_ADDRESS;
  const addrLine = `<div style="margin-top:2px;font-size:10.5px;font-weight:600;line-height:1.35;color:#333333;overflow-wrap:break-word;">${escapeHtml(addr)}</div>`;
  const title = kind
    ? `<div style="font-size:20px;font-weight:700;line-height:1.15;color:${DOC_INK};overflow-wrap:break-word;">${escapeHtml(kind)}</div>`
    : '';
  const sub = subtitle
    ? `<div style="margin-top:2px;font-size:11px;font-weight:600;line-height:1.35;color:#333333;overflow-wrap:break-word;">${escapeHtml(subtitle)}</div>`
    : '';
  const number = docNo
    ? `<div style="margin-top:6px;display:flex;justify-content:flex-end;align-items:stretch;gap:8px;">
        <div style="width:3px;background:${DOC_ACCENT};flex:0 0 auto;"></div>
        <div style="font-size:11px;font-weight:700;line-height:1.35;color:${DOC_INK};text-align:left;overflow-wrap:anywhere;">${escapeHtml(docNo)}</div>
      </div>`
    : '';
  return `
    <div style="flex:0 0 auto;margin:0 0 10px 0;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;">
        <div style="display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1 1 52%;">
          ${logo}
          <div style="min-width:0;flex:1;">${name}${addrLine}${extra}</div>
        </div>
        <div style="flex:1 1 42%;min-width:0;text-align:right;">
          ${title}${sub}${number}
        </div>
      </div>
      <div style="margin-top:8px;border-top:2px solid ${DOC_ACCENT};line-height:0;font-size:0;"></div>
    </div>
  `;
}

/** Page number at the bottom right, doc reference on the left, faint red rule above. */
export function documentFooterHtml({
  page,
  total,
  chrome,
  docRef,
  padLeft = DOC_PAD.left,
  padRight = DOC_PAD.right,
} = {}) {
  const c = normalizeDocumentChrome(chrome);
  const rule = c.footer_show_rule
    ? `<div style="border-top:1px solid ${DOC_FOOTER_RULE};margin-bottom:6px;line-height:0;font-size:0;"></div>`
    : '';
  const left = [docRef, c.footer_extra].map((part) => String(part || '').trim()).filter(Boolean).join(' · ');
  const extra = left
    ? `<span style="flex:1;min-width:0;font-size:9px;font-weight:600;line-height:1.3;color:#333333;overflow-wrap:anywhere;">${escapeHtml(left)}</span>`
    : '<span style="flex:1;"></span>';
  const pageNo = c.footer_show_page
    ? `<span style="flex:0 0 auto;font-size:10px;font-weight:600;line-height:1.2;color:${DOC_INK};white-space:nowrap;">Page ${page} of ${total}</span>`
    : '';
  if (!rule && !left && !pageNo) return '';
  return `
    <div style="position:absolute;left:${padLeft}px;right:${padRight}px;bottom:14px;">
      ${rule}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;min-height:14px;">
        ${extra}
        ${pageNo}
      </div>
      <div style="margin-top:6px;border-top:1px solid ${DOC_FOOTER_RULE};line-height:0;font-size:0;"></div>
    </div>
  `;
}

export function documentPageShell(bodyHtml, opts = {}) {
  const padTop = opts.padTop ?? DOC_PAD.top;
  const padRight = opts.padRight ?? DOC_PAD.right;
  const padBottom = opts.padBottom ?? DOC_PAD.bottom;
  const padLeft = opts.padLeft ?? DOC_PAD.left;
  return `
    <div data-page-shell="1" style="position:relative;width:${DOC_PAGE_W}px;height:${DOC_PAGE_H}px;background:#ffffff;overflow:hidden;font-family:${DOC_FONT};color:${DOC_INK};font-weight:600;">
      <div style="box-sizing:border-box;height:100%;padding:${padTop}px ${padRight}px ${padBottom}px ${padLeft}px;display:flex;flex-direction:column;">
        ${documentHeaderHtml(opts)}
        <div style="flex:1;min-height:0;display:flex;flex-direction:column;">
          ${bodyHtml || ''}
        </div>
      </div>
      ${documentFooterHtml({ ...opts, padLeft, padRight })}
    </div>
  `;
}
