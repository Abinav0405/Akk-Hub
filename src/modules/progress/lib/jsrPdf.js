import { escapeHtml } from '@/modules/progress/lib/utils';
import { formatDate } from '@/modules/progress/lib/dates';
import { buildPdfFromPages, printPdfBlob } from '@/modules/progress/lib/pdf';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import { useCanonicalPdf } from '@/modules/progress/lib/documentEndorsement';
import { clientAdjustment, fileSafeName, fmtMoney, jsrStatusLabel, monthName } from '@/modules/progress/lib/jsrStatus';
import { defaultJsrSignoff, hasCertifiedAmount, resolveLetterhead } from '@/modules/progress/lib/jsr';
import { buildStagePhotoGridInners, photoGridMetricsForHeader } from '@/modules/progress/lib/packagePdf';
import { DOC_ACCENT, DOC_HEADER_BG, DOC_HEADER_BUDGET, DOC_INK, DOC_PAD, DOC_PAGE_H, DOCUMENT_KIND, documentPageShell } from '@/modules/progress/lib/documentChrome';

const INK = DOC_INK;
const STAGE_KEYS = new Set(['before', 'during', 'after', 'completion']);
const BODY_H = DOC_PAGE_H - DOC_PAD.top - DOC_PAD.bottom - DOC_HEADER_BUDGET;
const SIGNOFF_H = 140;

const TH = `padding:7px 8px;border:1px solid ${DOC_HEADER_BG};background:${DOC_HEADER_BG};font-size:10px;font-weight:700;line-height:1.3;color:#ffffff;vertical-align:bottom;overflow-wrap:break-word;`;
const TD = `padding:7px 8px;border:1px solid #e6e6e6;font-size:11px;font-weight:600;line-height:1.35;color:${INK};vertical-align:top;overflow-wrap:break-word;word-break:break-word;`;

function textLines(text, charsPerLine) {
  const width = Math.max(8, charsPerLine);
  return String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil((line.length || 1) / width)), 0);
}

function plainText(value) {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
}

function blockHeight(value, charsPerLine) {
  return 18 + textLines(plainText(value), charsPerLine) * 17;
}

/** Keep line items on as many pages as they need. `tail` is reserved for the sign-off block. */
function packRows(rows, heightOf, { first, next, tail }) {
  const pages = [];
  let page = [];
  let used = 0;
  let budget = Math.max(48, first - tail);
  const flush = () => {
    if (!page.length) return;
    pages.push(page);
    page = [];
    used = 0;
    budget = Math.max(48, next - tail);
  };
  for (const row of rows) {
    const height = Math.max(32, heightOf(row));
    if (page.length && used + height > budget) flush();
    page.push(row);
    used += height;
  }
  if (page.length || !pages.length) pages.push(page);
  return pages;
}

const COLUMN_WIDTH = {
  'S/No': '7%',
  'S.No': '7%',
  'Item no.': '12%',
  'Item no': '12%',
  Description: '32%',
  Unit: '8%',
  Qty: '8%',
  'Unit rate (S$)': '16%',
  'Amount (S$)': '17%',
  'Unit rate': '16%',
  Amount: '17%',
  Schedule: '11%',
  'Contract Price': '15%',
  'Previously Certified': '16%',
  'This Month': '13%',
  Cumulative: '14%',
  '%': '9%',
  Item: '8%',
  'Work Order No': '28%',
  'JSR Reference': '34%',
  'This Month Claim': '30%',
  'Client certification': '68%',
};

function moneyTable(headers, bodyRows, totalLabel, totalValue) {
  const last = headers.length - 1;
  const rawWidths = headers.map((h) => {
    const pct = parseFloat(COLUMN_WIDTH[h]);
    return Number.isFinite(pct) ? pct : 100 / headers.length;
  });
  const widthSum = rawWidths.reduce((sum, width) => sum + width, 0) || 1;
  const cols = rawWidths.map((width) => `<col style="width:${(width / widthSum) * 100}%;" />`).join('');
  const head = headers
    .map(
      (h, i) =>
        `<th style="${TH}text-align:${i === last ? 'right' : 'left'};">${escapeHtml(h)}</th>`
    )
    .join('');
  const body = bodyRows
    .map(
      (cols) =>
        `<tr>${cols
          .map(
            (c, i) =>
              `<td style="${TD}text-align:${i === cols.length - 1 ? 'right' : 'left'};">${c}</td>`
          )
          .join('')}</tr>`
    )
    .join('');
  const tot = totalLabel
    ? `<tr><td colspan="${Math.max(headers.length - 1, 1)}" style="${TD}font-weight:700;text-align:right;">${escapeHtml(totalLabel)}</td><td style="${TD}font-weight:700;text-align:right;">${escapeHtml(totalValue)}</td></tr>`
    : '';
  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:14px;"><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}${tot}</tbody></table>`;
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function spellBelow1000(n) {
  const parts = [];
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest >= 20) {
    const ten = Math.floor(rest / 10);
    const one = rest % 10;
    parts.push(one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten]);
  } else if (rest) {
    parts.push(ONES[rest]);
  }
  return parts.join(' ');
}

function spellInteger(n) {
  if (!n) return 'Zero';
  const scales = [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand']];
  const parts = [];
  let left = n;
  scales.forEach(([size, name]) => {
    if (left >= size) {
      parts.push(`${spellBelow1000(Math.floor(left / size))} ${name}`);
      left %= size;
    }
  });
  if (left) parts.push(spellBelow1000(left));
  return parts.join(' ');
}

function amountInWords(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const dollars = Math.floor(abs + 1e-8);
  const cents = Math.round((abs - dollars) * 100);
  let text = `Singapore Dollars ${spellInteger(dollars)}`;
  if (cents) text += ` and Cents ${spellInteger(cents)}`;
  text += ' Only';
  return negative ? `Negative ${text}` : text;
}

function sectionTitle(text) {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:14px;">
      <div style="width:3px;height:14px;background:${DOC_ACCENT};flex:0 0 auto;"></div>
      <div style="font-size:13px;font-weight:700;line-height:1.3;color:${INK};overflow-wrap:break-word;">${escapeHtml(text)}</div>
    </div>`;
}

function detailCell(label, valueHtml, span) {
  return `
    <td colspan="${span || 1}" style="padding:8px 10px;border:1px solid #e6e6e6;vertical-align:top;">
      <div style="font-size:10px;font-weight:600;line-height:1.3;color:#4b5563;overflow-wrap:break-word;">${escapeHtml(label)}</div>
      <div style="margin-top:3px;font-size:12px;font-weight:700;line-height:1.4;color:${INK};overflow-wrap:break-word;word-break:break-word;">${valueHtml}</div>
    </td>`;
}

function statusPill(label) {
  // Plain inline-block, no flexbox. html2canvas draws text ~2px lower than the browser
  // lays it out, so the line box is 16px with 4px below it: measured centred in the PDF.
  return `<span style="display:inline-block;height:20px;line-height:16px;padding:0 10px 4px;background:#fde8e8;color:#9f1239;border-radius:10px;font-size:11px;font-weight:700;white-space:nowrap;vertical-align:middle;"><span style="display:inline-block;width:6px;height:6px;margin:0 6px 0 0;border-radius:3px;background:${DOC_ACCENT};vertical-align:middle;"></span><span style="vertical-align:middle;">${escapeHtml(label || '—')}</span></span>`;
}

function totalsBlock(rows, wordsValue) {
  const lines = rows.filter(Boolean).map((row, index) => `
    <div style="display:flex;justify-content:space-between;gap:16px;${index ? 'margin-top:4px;' : ''}padding-top:4px;border-top:1px solid ${INK};font-size:12px;font-weight:${row.strong ? 700 : 600};line-height:1.35;color:${INK};">
      <span>${escapeHtml(row.label)}</span>
      <span style="white-space:nowrap;">${escapeHtml(row.value)}</span>
    </div>`).join('');
  const words = wordsValue != null
    ? `<div style="margin-top:8px;text-align:center;font-size:11px;font-weight:600;font-style:italic;line-height:1.4;color:${INK};overflow-wrap:break-word;">${escapeHtml(amountInWords(wordsValue))}</div>`
    : '';
  return `<div style="width:280px;max-width:100%;margin-left:auto;margin-top:10px;">${lines}</div>${words}`;
}

function signSide(label, lines) {
  const body = (lines || []).filter((line) => line != null && String(line).trim() !== '').map((line) => escapeHtml(line)).join('<br>');
  // The rule is the signing line: a signature or stamp sits above it, the label and name below.
  return `
    <div style="flex:1;min-width:0;border-top:1px solid ${INK};padding-top:6px;">
      <div style="font-size:11px;font-weight:700;line-height:1.35;color:${INK};overflow-wrap:break-word;">${escapeHtml(label)}</div>
      <div style="margin-top:8px;font-size:12px;font-weight:600;line-height:1.45;color:${INK};overflow-wrap:break-word;">${body}</div>
    </div>`;
}

function signBlock(leftLabel, leftLines, rightLabel, rightLines) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:36px;">
      ${signSide(leftLabel, leftLines)}
      ${signSide(rightLabel, rightLines)}
    </div>
  `;
}

/** Pin Submitted by / Checked by at the bottom of the page content (above page chrome). */
function withSignoffFooter(bodyHtml, signoffHtml) {
  return `
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;">
      <div>${bodyHtml}</div>
      <div style="margin-top:auto;padding-top:24px;padding-bottom:8px;">${signoffHtml}</div>
    </div>
  `;
}

function hasStoredSignoff(record) {
  return Boolean(
    record?.submitted_by_name ||
      record?.submitted_by_company ||
      record?.checked_by_title ||
      record?.checked_by_name ||
      record?.checked_by_company
  );
}

function resolveSignoff(record, co, extras = []) {
  const candidates = [record, ...(extras || [])].filter(Boolean);
  const stored = candidates.find(hasStoredSignoff) || record || {};
  return defaultJsrSignoff({
    ...stored,
    company: stored.company || record?.company || co,
    contract: stored.contract || record?.contract,
  });
}

function jsrSignBlock(signoff, { submittedDate, checkedDate } = {}) {
  const submittedLabel = submittedDate ? `Submitted by · ${submittedDate}` : 'Submitted by';
  const checkedLabel = checkedDate ? `Checked by · ${checkedDate}` : 'Checked by · Date:';
  const checkedLines = [signoff.checked_by_name, signoff.checked_by_title, signoff.checked_by_company];
  return signBlock(
    submittedLabel,
    [signoff.submitted_by_name, signoff.submitted_by_company],
    checkedLabel,
    checkedLines
  );
}

function priceDecided(record) {
  const response = record?.client_response;
  return Boolean(response && response !== 'reply');
}

function lineQty(item, decided) {
  if (decided && hasCertifiedAmount(item?.certified_qty)) return item.certified_qty;
  return item?.qty;
}

function lineRate(item, decided) {
  if (decided && hasCertifiedAmount(item?.certified_rate)) return item.certified_rate;
  return item?.rate;
}

function lineAmount(item, decided) {
  if (decided && hasCertifiedAmount(item?.certified_amount)) return item.certified_amount;
  return item?.amount;
}

function claimLineAmount(row, decided) {
  if (decided && hasCertifiedAmount(row?.certified_amount)) return row.certified_amount;
  return row?.total;
}

/** A photo's own caption; empty lets the grid print "Photo 1", "Photo 2"… instead. */
function photoCaption(p) {
  return String(p.caption || '').trim();
}

function groupLinkedPhotos(photos) {
  const groups = [];
  const index = new Map();
  for (const p of photos || []) {
    if (!p?.dataUrl) continue;
    const key = p.package_id || '_none';
    let group = index.get(key);
    if (!group) {
      group = {
        site_name: p.site_name || '',
        label: [p.display_id || p.lcb_id, p.package_date ? formatDate(p.package_date) : '']
          .filter(Boolean)
          .join(' · '),
        // What the package is: its description and street name (0074 photo rows).
        description: String(p.package_description || '').trim(),
        street: String(p.street_name || '').trim(),
        sectionName: String(p.section_label || '').trim(),
        sectionValue: String(p.section_value || '').trim(),
        stagePhotos: { before: [], during: [], after: [], completion: [] },
      };
      index.set(key, group);
      groups.push(group);
    }
    const stage = STAGE_KEYS.has(p.stage) ? p.stage : 'after';
    group.stagePhotos[stage].push({ dataUrl: p.dataUrl, caption: photoCaption(p) });
  }
  return groups;
}

/**
 * The package's details for its photo pages: description, section name with its value
 * (e.g. "Details: LP 40") and street name. A street already typed in another line is
 * not repeated.
 */
function packageDetailLines(group, siteLabel = '') {
  const desc = group?.description || '';
  const sectionValue = group?.sectionValue || '';
  const street = group?.street || '';
  const elsewhere = `${desc} ${sectionValue}`.toLowerCase();
  return [
    desc ? ['Description', desc] : null,
    sectionValue ? [group?.sectionName || 'Section', sectionValue] : null,
    street && street !== siteLabel && !elsewhere.includes(street.toLowerCase()) ? ['Street', street] : null,
  ].filter(Boolean);
}

function jsrPhotoInners(j, photos) {
  const location = j.location || j.site?.name || '';
  const jsrLabel = String(j.jsr_no || '').trim();
  const pages = [];
  for (const group of groupLinkedPhotos(photos)) {
    // The package's own street (not the whole JSR's combined location); the site name if it has none.
    const site = group.street || group.site_name || location;
    const details = packageDetailLines(group, site);
    // Height of the text above the photos, so long details shrink the photos instead of
    // pushing them off the page.
    const headerPx = 2 + (jsrLabel ? 18 : 0) + textLines(`SITE: ${site}`, 72) * 18
      + (group.label ? 4 + 17 : 0)
      + details.reduce((sum, [label, value]) => sum + 3 + textLines(`${label}: ${value}`, 84) * 17, 0);
    const detailHtml = details
      .map(([label, value]) => `<div style="margin-top:3px;font-size:12px;font-weight:600;line-height:1.4;color:${INK};overflow-wrap:break-word;"><span style="font-weight:700;">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`)
      .join('');
    const jsrLine = jsrLabel
      ? `<div style="margin-top:2px;font-size:13px;font-weight:700;line-height:1.35;color:${INK};overflow-wrap:break-word;">JSR: ${escapeHtml(jsrLabel)}</div>`
      : '';
    const grids = buildStagePhotoGridInners(group.stagePhotos, photoGridMetricsForHeader(headerPx));
    // First photo page: JSR + package details; later pages keep the JSR number.
    grids.forEach((gridInner, index) => {
      pages.push(index === 0 ? `
        ${jsrLine}
        <div style="margin-top:2px;font-size:13px;font-weight:700;line-height:1.35;color:${INK};overflow-wrap:break-word;">SITE: ${escapeHtml(site)}</div>
        ${group.label ? `<div style="margin-top:4px;font-size:12px;font-weight:600;line-height:1.35;color:${INK};overflow-wrap:break-word;">${escapeHtml(group.label)}</div>` : ''}
        ${detailHtml}
        ${gridInner}
      ` : `${jsrLine}${gridInner}`);
    });
  }
  return pages;
}

function wrapPages(inners, co, meta = {}) {
  const kind = meta.kind || '';
  const docNo = meta.docNo || '';
  const docRef = [docNo, kind].filter(Boolean).join(' · ');
  return inners.map((inner, i) => documentPageShell(inner, {
    page: i + 1,
    total: inners.length,
    logoSrc: co?.logo_path,
    companyName: co?.name,
    kind,
    docNo,
    subtitle: meta.subtitle || '',
    docRef,
    chrome: co?.document_chrome,
    address: co?.letterhead_address,
  }));
}

/**
 * Wrap many page bodies that may belong to different documents (claim summary +
 * nested JSR sheets). Each entry can override kind / docNo / subtitle so JSR
 * pages show that JSR's number and details in the letterhead, not the claim no.
 * Page numbers run across the whole PDF.
 *
 * entries: string HTML, or { inner, kind?, docNo?, subtitle? }
 */
function wrapDocumentPages(entries, co, defaults = {}) {
  const list = (entries || []).map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return {
        inner: entry.inner || '',
        kind: entry.kind ?? defaults.kind ?? '',
        docNo: entry.docNo ?? defaults.docNo ?? '',
        subtitle: entry.subtitle ?? defaults.subtitle ?? '',
      };
    }
    return {
      inner: entry || '',
      kind: defaults.kind || '',
      docNo: defaults.docNo || '',
      subtitle: defaults.subtitle || '',
    };
  });
  const total = list.length;
  return list.map((entry, i) => {
    const kind = entry.kind || '';
    const docNo = entry.docNo || '';
    const docRef = [docNo, kind].filter(Boolean).join(' · ');
    return documentPageShell(entry.inner, {
      page: i + 1,
      total,
      logoSrc: co?.logo_path,
      companyName: co?.name,
      kind,
      docNo,
      subtitle: entry.subtitle || '',
      docRef,
      chrome: co?.document_chrome,
      address: co?.letterhead_address,
    });
  });
}

function pct(n, d) {
  const den = Number(d) || 0;
  const num = Number(n) || 0;
  return den > 0 ? `${((num / den) * 100).toFixed(2)}%` : '0.00%';
}

function jsrInners(j, photos, co) {
  const ct = j.contract || {};
  const site = j.site || {};
  const items = j.items || [];
  const decided = priceDecided(j);
  const signoff = resolveSignoff(j, co);
  const submittedDate = j.completion_date ? formatDate(j.completion_date) : (j.jsr_date ? formatDate(j.jsr_date) : '');
  const checkedDate = decided && j.client_responded_at ? formatDate(j.client_responded_at) : '';
  const sign = jsrSignBlock(signoff, { submittedDate, checkedDate });
  const submitted = Number(j.client_submitted_amount ?? j.total) || 0;
  const total = decided && hasCertifiedAmount(j.client_certified_amount) ? Number(j.client_certified_amount) : Number(j.total) || 0;
  const rows = items.map((it, i) => [
    String(i + 1),
    escapeHtml(it.code || 'NA'),
    escapeHtml(it.description || ''),
    escapeHtml(it.unit || ''),
    String(lineQty(it, decided) ?? ''),
    fmtMoney(lineRate(it, decided)),
    fmtMoney(lineAmount(it, decided)),
  ]);
  const facts = `
    ${sectionTitle('Job details')}
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:8px;">
      <tr>${detailCell('JSR reference', escapeHtml(j.jsr_no || '—'), 2)}</tr>
      <tr>
        ${detailCell('LOA reference', escapeHtml(j.loa || ct.loa || '—'))}
        ${detailCell('Work order reference', escapeHtml(j.wo_ref || '—'))}
      </tr>
      <tr>${detailCell('Subcontract work', escapeHtml(j.sc_work || '—'), 2)}</tr>
      <tr>${detailCell('Site', escapeHtml(site.name || '—'), 2)}</tr>
      <tr>${detailCell('Location', escapeHtml(j.location || '—'), 2)}</tr>
      <tr>
        ${detailCell('Actual completion date', j.completion_date ? formatDate(j.completion_date) : '—')}
        ${detailCell('Status', statusPill(jsrStatusLabel(j.status)))}
      </tr>
    </table>`;
  const note = j.claim_no
    ? `<div style="margin-top:10px;font-size:12px;font-weight:600;line-height:1.4;color:${INK};overflow-wrap:break-word;">Included in monthly progress claim ${escapeHtml(j.claim_no)} (${escapeHtml(j.claimed_month || '')})</div>`
    : '';
  const headers = ['S/No', 'Item no.', 'Description', 'Unit', 'Qty', 'Unit rate (S$)', 'Amount (S$)'];
  const subtotal = items.reduce((sum, it) => sum + (Number(lineAmount(it, decided)) || 0), 0);
  const shownTotal = items.length ? subtotal : total;
  // The client may have raised (addition) or lowered (deduction) the figure.
  const adj = clientAdjustment(submitted, shownTotal);
  const totals = totalsBlock([
    { label: 'Subtotal', value: fmtMoney(shownTotal) },
    decided && adj.amount ? { label: 'Submitted', value: fmtMoney(submitted) } : null,
    decided && adj.amount ? { label: adj.label, value: fmtMoney(adj.amount) } : null,
    { label: 'Total (S$)', value: fmtMoney(shownTotal), strong: true },
  ], shownTotal);
  const chunks = packRows(rows, (cols) => blockHeight(cols[2], 28), {
    first: BODY_H - 380 - (note ? 28 : 0),
    next: BODY_H - 48,
    tail: SIGNOFF_H + 120,
  });
  const continuedBanner = `
    ${sectionTitle('Work items — continued')}
    <div style="margin-top:4px;font-size:12px;font-weight:700;line-height:1.35;color:${INK};overflow-wrap:break-word;">
      ${escapeHtml(j.jsr_no || 'JSR')}
      ${site.name ? ` · ${escapeHtml(site.name)}` : ''}
      ${j.location ? ` · ${escapeHtml(j.location)}` : ''}
      ${j.status ? ` · ${escapeHtml(jsrStatusLabel(j.status))}` : ''}
    </div>`;
  const itemPages = chunks.map((part, idx) => {
    const last = idx === chunks.length - 1;
    const body = `
      ${idx === 0 ? facts : continuedBanner}
      ${idx === 0 ? sectionTitle('Work items') : ''}
      ${moneyTable(headers, part, '', '')}
      ${last ? totals : ''}
      ${idx === 0 ? note : ''}
    `;
    return last ? withSignoffFooter(body, sign) : body;
  });
  return [...itemPages, ...jsrPhotoInners(j, photos)];
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function claimInners(cl, co, nestedJsrs = []) {
  const ct = cl.contract || {};
  const decided = priceDecided(cl);
  const signoff = resolveSignoff(cl, co, nestedJsrs);
  const submitted = Number(cl.client_submitted_amount ?? cl.this_month_total) || 0;
  const thisM = decided && hasCertifiedAmount(cl.client_certified_amount)
    ? Number(cl.client_certified_amount)
    : Number(cl.this_month_total) || 0;
  const prev = Number(cl.prev_cert) || 0;
  const cum = prev + thisM;
  const price = Number(cl.price) || 0;
  const jsrs = cl.jsrs || [];
  const checkedDate = decided && cl.client_responded_at ? formatDate(cl.client_responded_at) : '';
  const sign = jsrSignBlock(signoff, { submittedDate: cl.claim_date ? formatDate(cl.claim_date) : '', checkedDate });
  const scheduleRows = jsrs.map((r, i) => [
    String(i + 1),
    escapeHtml(r.wo_ref || '—'),
    escapeHtml(r.jsr_no),
    fmtMoney(claimLineAmount(r, decided)),
  ]);
  const scheduleTotal = jsrs.reduce((sum, row) => sum + (Number(claimLineAmount(row, decided)) || 0), 0);
  const shown = jsrs.length ? scheduleTotal : thisM;
  const adj = clientAdjustment(submitted, shown);
  const scheduleChunks = packRows(scheduleRows, (cols) => Math.max(blockHeight(cols[1], 22), blockHeight(cols[2], 24)), {
    first: BODY_H - 88,
    next: BODY_H - 48,
    tail: SIGNOFF_H + 120,
  });
  const schedulePages = scheduleChunks.map((part, idx) => {
    const last = idx === scheduleChunks.length - 1;
    const body = `
    ${sectionTitle(idx ? 'Schedule — continued' : `Schedule ${ct.code || ''}`)}
    <div style="margin-top:4px;font-size:12px;font-weight:600;line-height:1.4;color:${INK};overflow-wrap:break-word;">${escapeHtml(ct.description || '')}</div>
    <div style="margin-top:2px;font-size:12px;font-weight:600;line-height:1.4;color:${INK};">PC No.: ${escapeHtml(String(cl.pc_no ?? '—'))}</div>
    ${moneyTable(['Item', 'Work Order No', 'JSR Reference', 'This Month Claim'], part, '', '')}
    ${last ? totalsBlock([
      { label: 'Subtotal', value: fmtMoney(shown) },
      decided && adj.amount ? { label: 'Submitted', value: fmtMoney(submitted) } : null,
      decided && adj.amount ? { label: adj.label, value: fmtMoney(adj.amount) } : null,
      { label: `Total (S$)`, value: fmtMoney(shown), strong: true },
    ], shown) : ''}
  `;
    return last ? withSignoffFooter(body, sign) : body;
  });
  const summary = withSignoffFooter(
    `
    ${sectionTitle('Claim details')}
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:8px;">
      <tr>
        ${detailCell('Claim date', formatDate(cl.claim_date))}
        ${detailCell('Work done as of', escapeHtml(monthName(cl.month)))}
      </tr>
      <tr>${detailCell('Subcontractor', escapeHtml(co?.name || '—'), 2)}</tr>
      <tr>${detailCell('Contract', escapeHtml(ct.contract_title || '—'), 2)}</tr>
      <tr>${detailCell('SC works', escapeHtml(ct.sc_works || '—'), 2)}</tr>
      <tr>
        ${detailCell('LOA reference', escapeHtml(ct.loa || '—'))}
        ${detailCell('PC No.', escapeHtml(String(cl.pc_no ?? '—')))}
      </tr>
    </table>
    ${sectionTitle('Summary')}
    ${moneyTable(
      ['Schedule', 'Description', 'Contract Price', 'Previously Certified', 'This Month', 'Cumulative', '%'],
      [[
        escapeHtml(ct.code || ''),
        escapeHtml(ct.description || ''),
        fmtMoney(price),
        fmtMoney(prev),
        fmtMoney(thisM),
        fmtMoney(cum),
        pct(cum, price),
      ]],
      '',
      ''
    )}
    ${totalsBlock([
      { label: 'Subtotal', value: fmtMoney(thisM) },
      decided && clientAdjustment(submitted, thisM).amount ? { label: 'Submitted', value: fmtMoney(submitted) } : null,
      decided && clientAdjustment(submitted, thisM).amount
        ? { label: clientAdjustment(submitted, thisM).label, value: fmtMoney(clientAdjustment(submitted, thisM).amount) }
        : null,
      { label: 'Total (S$)', value: fmtMoney(thisM), strong: true },
    ], thisM)}
  `,
    sign
  );
  return [summary, ...schedulePages];
}

function invoiceInners(kind, record, co, nestedJsrs = []) {
  const inv = record.invoice;
  const ct = record.contract || {};
  const decided = priceDecided(record);
  const signoff = resolveSignoff(record, co, nestedJsrs);
  const submitted = kind === 'jsr' ? Number(record.total) || 0 : Number(record.this_month_total) || 0;
  const certified = hasCertifiedAmount(record.client_certified_amount) ? Number(record.client_certified_amount) : Number(inv.amount) || 0;
  const items = kind === 'jsr' ? (record.items || []) : [];
  const notes = inv.notes
    ? `<div style="margin-top:12px;font-size:12px;font-weight:600;line-height:1.45;color:${INK};white-space:pre-wrap;overflow-wrap:break-word;">${escapeHtml(inv.notes)}</div>`
    : '';
  const itemRows = items.map((it, i) => [
    String(i + 1),
    escapeHtml(it.code || 'NA'),
    escapeHtml(it.description || ''),
    fmtMoney(lineRate(it, decided)),
    fmtMoney(lineAmount(it, decided)),
  ]);
  const itemTable = itemRows.length
    ? `${sectionTitle('Work items')}${moneyTable(['S/No', 'Item no.', 'Description', 'Unit rate (S$)', 'Amount (S$)'], itemRows, '', '')}`
    : '';
  const body = `
    ${sectionTitle('Invoice details')}
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-top:8px;">
      <tr>
        ${detailCell('Invoice date', formatDate(inv.invoice_date))}
        ${detailCell('Reference', escapeHtml(inv.reference || (kind === 'jsr' ? record.jsr_no : record.claim_no) || '—'))}
      </tr>
      <tr>${detailCell('Bill to', `${escapeHtml(ct.client_name || '—')}<br>Attn: ${escapeHtml(ct.client_attn || '—')}`, 2)}</tr>
      <tr>${detailCell('Contract', escapeHtml(ct.contract_title || '—'), 2)}</tr>
      <tr>
        ${detailCell('LOA reference', escapeHtml(ct.loa || '—'))}
        ${detailCell('PC No.', escapeHtml(String(ct.pc_no ?? '—')))}
      </tr>
    </table>
    ${itemTable}
    ${sectionTitle('Amounts')}
    ${moneyTable(
      ['Description', 'Amount (S$)'],
      [
        ['Submitted claim amount', fmtMoney(submitted)],
        ['Client certified amount', fmtMoney(certified)],
        [escapeHtml(clientAdjustment(submitted, certified).label), fmtMoney(clientAdjustment(submitted, certified).amount)],
      ],
      '',
      ''
    )}
    ${totalsBlock([{ label: 'Invoice amount (S$)', value: fmtMoney(inv.amount), strong: true }], inv.amount)}
    ${notes}
  `;
  const sign = signBlock(
    `For ${signoff.submitted_by_company || co?.name || ''}`,
    [signoff.submitted_by_name || ''],
    'Received and acknowledged by',
    [signoff.checked_by_company || ct.client_name || 'Client']
  );
  const notesH = inv.notes ? blockHeight(inv.notes, 78) : 0;
  const stacked = 360 + itemRows.length * 36 + notesH + SIGNOFF_H;
  if (stacked <= BODY_H) return [withSignoffFooter(body, sign)];
  return [body, withSignoffFooter(sectionTitle('Acknowledgement'), sign)];
}

async function withCo(company) {
  return resolveLetterhead(company);
}

export function previewJsrHtmlPages(j, photos, co) {
  return wrapPages(jsrInners(j, photos, co), co, { kind: DOCUMENT_KIND.jsr, docNo: j?.jsr_no, subtitle: j?.sc_work || '' });
}

function nestedJsrPageMeta(j, cl) {
  const jsrNo = String(j?.jsr_no || '').trim();
  const claimNo = String(cl?.claim_no || j?.claim_no || '').trim();
  return {
    kind: DOCUMENT_KIND.jsr,
    docNo: jsrNo || 'JSR',
    subtitle: claimNo
      ? `Included in Progress Claim ${claimNo}`
      : (j?.sc_work || ''),
  };
}

export function previewClaimHtmlPages(cl, nestedJsrs, co) {
  const claimMeta = {
    kind: DOCUMENT_KIND.claim,
    docNo: cl?.claim_no,
    subtitle: cl?.month ? monthName(cl.month) : '',
  };
  const entries = claimInners(cl, co, nestedJsrs).map((inner) => ({ inner, ...claimMeta }));
  if (cl?.include_jsr_details !== false) {
    (nestedJsrs || []).forEach((j) => {
      const jsrMeta = nestedJsrPageMeta(j, cl);
      jsrInners(j, [], co).forEach((inner) => entries.push({ inner, ...jsrMeta }));
    });
  }
  return wrapDocumentPages(entries, co, claimMeta);
}

export function previewInvoiceHtmlPages(kind, record, co) {
  return wrapPages(invoiceInners(kind, { ...record, company: co }, co, record.jsrs), co, {
    kind: DOCUMENT_KIND.invoice,
    docNo: record?.invoice?.invoice_no,
    subtitle: kind === 'jsr' ? record?.jsr_no : record?.claim_no,
  });
}

export async function buildJsrPdfBlob(j, photos, { onProgress } = {}) {
  const co = await withCo(j.company);
  const hasPhotos = Array.isArray(photos) && photos.length > 0;
  return buildPdfFromPages(
    wrapPages(jsrInners(j, photos, co), co, {
      kind: DOCUMENT_KIND.jsr,
      docNo: j?.jsr_no,
      subtitle: j?.sc_work || '',
    }),
    undefined,
    onProgress,
    {
      title: fileSafeName(j?.jsr_no) || 'JSR',
      compactPhotos: hasPhotos,
    }
  );
}

export async function buildClaimPdfBlob(cl, nestedJsrs = [], photosByJsrId = {}, { onProgress } = {}) {
  const co = await withCo(cl.company);
  const claimMeta = {
    kind: DOCUMENT_KIND.claim,
    docNo: cl?.claim_no,
    subtitle: cl?.month ? monthName(cl.month) : '',
  };
  const entries = claimInners(cl, co, nestedJsrs).map((inner) => ({ inner, ...claimMeta }));
  if (cl.include_jsr_details !== false) {
    nestedJsrs.forEach((j) => {
      const photos = cl.include_photos ? photosByJsrId[j.id] || [] : [];
      const jsrMeta = nestedJsrPageMeta(j, cl);
      jsrInners(j, photos, co).forEach((inner) => entries.push({ inner, ...jsrMeta }));
    });
  }
  const hasPhotos = Boolean(cl.include_photos)
    && Object.values(photosByJsrId || {}).some((list) => Array.isArray(list) && list.length > 0);
  return buildPdfFromPages(
    wrapDocumentPages(entries, co, claimMeta),
    undefined,
    onProgress,
    {
      title: fileSafeName(cl?.claim_no) || 'Progress claim',
      compactPhotos: hasPhotos,
    }
  );
}

export async function buildInvoicePdfBlob(kind, record, { onProgress } = {}) {
  if (!record?.invoice) return null;
  const co = await withCo(record.company);
  return buildPdfFromPages(
    wrapPages(invoiceInners(kind, record, co, record.jsrs), co, {
      kind: DOCUMENT_KIND.invoice,
      docNo: record?.invoice?.invoice_no,
      subtitle: kind === 'jsr' ? record?.jsr_no : record?.claim_no,
    }),
    undefined,
    onProgress,
    { title: fileSafeName(record?.invoice?.invoice_no) || 'Invoice' }
  );
}

/**
 * Bump when printed claim/JSR layout changes (nested JSR headers, compact photos…).
 * Next download rebuilds unsigned artifacts; claims also rebuild stamped ones
 * (signatures burned back). Stamped JSR originals stay until a content clear.
 */
export const COMMERCIAL_PDF_LAYOUT_CHANGED_AT = '2026-10-05T18:30:00+08:00';

/** Layout rebuild policy for ensure/download of JSR vs claim stored PDFs. */
export function commercialPdfLayoutOptions(kind) {
  const docKind = String(kind || '');
  if (docKind === 'jsr_claim' || docKind === 'claim') {
    return {
      layoutChangedAt: COMMERCIAL_PDF_LAYOUT_CHANGED_AT,
      rebuildStampedOnLayoutChange: true,
    };
  }
  if (docKind === 'jsr') {
    return {
      layoutChangedAt: COMMERCIAL_PDF_LAYOUT_CHANGED_AT,
      rebuildStampedOnLayoutChange: false,
    };
  }
  return {};
}

export async function downloadJsrPdf(j, photos, { print = false, onProgress } = {}) {
  const name = `${fileSafeName(j.jsr_no) || 'jsr'}.pdf`;
  if (j?.id) {
    return useCanonicalPdf({
      kind: 'jsr',
      documentId: j.id,
      buildPdfBlob: () => buildJsrPdfBlob(j, photos, { onProgress }),
      print,
      fileName: name,
      ...commercialPdfLayoutOptions('jsr'),
    });
  }
  const blob = await buildJsrPdfBlob(j, photos, { onProgress });
  return print ? printPdfBlob(blob, name) : savePdfBlob(blob, name);
}

export async function downloadClaimPdf(cl, nestedJsrs = [], photosByJsrId = {}, { print = false, onProgress } = {}) {
  const name = `${fileSafeName(cl.claim_no) || 'claim'}.pdf`;
  if (cl?.id) {
    return useCanonicalPdf({
      kind: 'jsr_claim',
      documentId: cl.id,
      buildPdfBlob: () => buildClaimPdfBlob(cl, nestedJsrs, photosByJsrId, { onProgress }),
      print,
      fileName: name,
      ...commercialPdfLayoutOptions('jsr_claim'),
    });
  }
  const blob = await buildClaimPdfBlob(cl, nestedJsrs, photosByJsrId, { onProgress });
  return print ? printPdfBlob(blob, name) : savePdfBlob(blob, name);
}

export async function downloadInvoicePdf(kind, record, { print = false, onProgress } = {}) {
  if (!record?.invoice) return;
  const name = `${fileSafeName(record.invoice.invoice_no) || 'invoice'}.pdf`;
  if (record.invoice.id) {
    return useCanonicalPdf({
      kind: 'invoice',
      documentId: record.invoice.id,
      buildPdfBlob: () => buildInvoicePdfBlob(kind, record, { onProgress }),
      print,
      fileName: name,
    });
  }
  const blob = await buildInvoicePdfBlob(kind, record, { onProgress });
  return print ? printPdfBlob(blob, name) : savePdfBlob(blob, name);
}

/** Shared with the Excel export so both show the same figures, names and wording. */
export {
  amountInWords,
  claimLineAmount,
  groupLinkedPhotos,
  packageDetailLines,
  lineAmount,
  lineQty,
  lineRate,
  priceDecided,
  resolveSignoff,
  round2,
};
