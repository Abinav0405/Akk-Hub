import { getDepartmentLabel } from './catalog';
import { riskBand } from './flagging';
import { isNativeApp } from '@/core/platform';
import { siteUrl } from '@/features/cards/cardModel';

const COMPANY_NAME = 'AKK ENGINEERING PTE. LTD.';
const COMPANY_ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';

/* Transmittal Form: the company's own layout (AKK_Transmittal_Form.xlsx). */
const TRN_RED = '#8b1a2b';
const TRANSMITTAL_CSS = `
  .company-form.trn { border: 0; border-radius: 0; padding: 0; color: #111; font-family: Arial, 'Segoe UI', sans-serif; position: relative; }
  .trn-head { display: flex; align-items: center; gap: 14px; padding-bottom: 8px; border-bottom: 2px solid ${TRN_RED}; }
  .trn-logo { width: 92px; height: auto; flex-shrink: 0; }
  .trn-head-text { flex: 1; text-align: center; }
  .trn-head-text h1 { margin: 0; color: ${TRN_RED}; font-size: 26px; letter-spacing: 0.02em; font-weight: 800; }
  .trn-head-text p { margin: 3px 0 0; font-size: 11.5px; }
  .trn-head-text .trn-tag { color: #b8860b; font-weight: 700; font-size: 12px; }
  .trn-banner { margin: 10px 0 8px; background: ${TRN_RED}; color: #fff; text-align: center; font-weight: 800; font-size: 20px; letter-spacing: 0.04em; padding: 7px 0; }
  .trn-status { position: absolute; top: 0; right: 0; font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; color: #92400e; background: #fef3c7; border-radius: 4px; padding: 2px 6px; }
  .trn table { width: 100%; border-collapse: collapse; margin: 0 0 8px; font-size: 11.5px; }
  .trn th, .trn td { border: 1px solid #9ca3af; padding: 5px 8px; vertical-align: middle; text-align: left; }
  .trn-info th { background: #f2f2f2; font-weight: 700; width: 17%; white-space: nowrap; }
  .trn-info td { width: 33%; }
  .trn-bar { background: ${TRN_RED}; color: #fff; font-weight: 700; font-size: 12px; letter-spacing: 0.03em; }
  .trn th.trn-bar { background: ${TRN_RED}; color: #fff; border-color: ${TRN_RED}; }
  .trn-boxes td { border-top: 0; border-bottom: 0; padding: 3px 8px; }
  .trn-boxes tr:last-child td { border-bottom: 1px solid #9ca3af; }
  .trn-box { display: inline-block; width: 11px; height: 11px; border: 1.2px solid #111; margin-right: 7px; position: relative; top: 1px; text-align: center; line-height: 9px; font-size: 10px; font-weight: 700; }
  .trn-ack { font-style: italic; color: #4b5563; font-size: 10.5px; }
  .trn-docs th { background: ${TRN_RED}; color: #fff; border-color: #6b1220; text-align: center; font-size: 10.5px; }
  .trn-docs td { height: 24px; }
  .trn-docs td.c { text-align: center; }
  .trn-remarks { border: 1px solid #9ca3af; margin: 0 0 8px; }
  .trn-remarks .trn-bar { padding: 5px 8px; }
  .trn-remarks-body { min-height: 54px; padding: 6px 8px; font-size: 11.5px; white-space: pre-wrap; }
  .trn-sign td { height: 26px; font-size: 11px; }
  .trn-sign td .v { font-weight: 600; }
  .trn-sign td.sig { height: 44px; vertical-align: top; }
  .trn-foot { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
  .trn-foot p { flex: 1; margin: 0; font-size: 10px; color: #374151; line-height: 1.45; }
  .trn-foot img { height: 46px; width: auto; }
`;

export const COMPANY_FORM_PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    margin: 0;
    padding: 16px;
    color: #0f172a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .batch-cover {
    text-align: center;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 2px solid #334155;
  }
  .batch-cover h1 { margin: 0 0 8px; font-size: 1.25rem; }
  .batch-cover p { margin: 4px 0; color: #64748b; font-size: 0.9rem; }
  .company-form {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 20px 24px;
    margin: 0 0 24px;
    page-break-inside: avoid;
  }
  .form-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid #475569;
  }
  .logo { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
  .header-text h1 { margin: 0 0 4px; font-size: 1.2rem; }
  .company { margin: 0; font-weight: 700; font-size: 0.95rem; }
  .address { margin: 2px 0 0; font-size: 0.8rem; color: #64748b; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin: 0 0 12px;
    font-size: 0.8rem;
    color: #475569;
  }
  .pill {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 8px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 0.72rem;
  }
  .pill-pending { background: #fef3c7; color: #92400e; }
  .pill-approved { background: #d1fae5; color: #065f46; }
  .pill-rejected { background: #fee2e2; color: #991b1b; }
  .pill-flagged { background: #fecaca; color: #7f1d1d; }
  .section-title {
    margin: 16px 0 8px;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #475569;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
    margin-bottom: 8px;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 7px 9px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f8fafc;
    font-weight: 600;
    color: #334155;
  }
  .info-table th { width: 32%; }
  .multiline { white-space: pre-wrap; }
  .bad { background: #fef2f2; color: #991b1b; font-weight: 700; }
  .note {
    margin-top: 12px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 0.84rem;
  }
  .flag-note { border-color: #fecaca; background: #fef2f2; color: #7f1d1d; }
  .signatures {
    display: flex;
    gap: 24px;
    margin-top: 28px;
  }
  .sig-block { flex: 1; text-align: center; font-size: 0.8rem; color: #334155; }
  .sig-line {
    border-bottom: 1px solid #334155;
    height: 36px;
    margin: 0 0 8px;
  }
${TRANSMITTAL_CSS}
  @media print {
    body { padding: 0; }
    .company-form { page-break-after: always; }
    .company-form:last-child { page-break-after: auto; }
  }
`;

export function snapshotDefinition(definition) {
    if (!definition) return null;
    const { enabled, ...rest } = definition;
    return JSON.parse(JSON.stringify(rest));
}

function esc(value) {
    if (value === null || value === undefined || value === '') return '—';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function resolveLogoSrc(logoUrl = '/Akk-logo.jpg') {
    if (!logoUrl) return '';
    if (/^(https?:|data:)/i.test(logoUrl)) return logoUrl;
    if (typeof window !== 'undefined' && window.location?.origin) {
        try {
            return new URL(logoUrl, window.location.origin).href;
        } catch {
            return logoUrl;
        }
    }
    return logoUrl;
}

function formatDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return dt.toLocaleDateString('en-SG', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

function formatWhen(value) {
    if (!value) return '—';
    const dateOnly = formatDateOnly(value);
    if (dateOnly) return dateOnly;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
}

function displayFieldValue(field, value) {
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (value === null || value === undefined || String(value).trim() === '') return '—';
    if (field?.type === 'date') return formatDateOnly(value) || String(value);
    return String(value);
}

function checklistLabel(answer) {
    if (answer === 'ok') return 'OK';
    if (answer === 'not_ok') return 'NOT OK';
    if (answer === 'done') return 'Done';
    if (answer === 'pending') return 'Pending';
    return '—';
}

function statusClass(status) {
    if (status === 'approved') return 'pill-approved';
    if (status === 'rejected') return 'pill-rejected';
    return 'pill-pending';
}

function fieldRows(fields, values) {
    return (fields || [])
        .map((field) => {
            const shown = displayFieldValue(field, values?.[field.key]);
            return `<tr><th>${esc(field.label)}</th><td class="multiline">${esc(shown)}</td></tr>`;
        })
        .join('');
}

function checklistTables(definition, checklist) {
    return (definition?.sections || [])
        .map((sec) => {
            const rows = (sec.items || [])
                .map((item) => {
                    const answer = checklist?.[item.key];
                    const bad = answer === 'not_ok' || answer === 'pending';
                    return `<tr><td>${esc(item.label)}</td><td class="${bad ? 'bad' : ''}">${esc(checklistLabel(answer))}</td></tr>`;
                })
                .join('');
            return `
              <h2 class="section-title">${esc(sec.title)}</h2>
              <table>
                <thead><tr><th>Item</th><th style="width:22%">Result</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`;
        })
        .join('');
}

function tableSection(definition, tableRows) {
    const table = definition?.table;
    if (!table || !tableRows?.length) return '';
    const showRisk = table.computed?.risk_rating === 'likelihood_x_severity';
    const head = (table.columns || []).map((col) => `<th>${esc(col.label)}</th>`).join('');
    const body = tableRows
        .map((row) => {
            const rating = showRisk ? riskBand(row.likelihood, row.severity) : null;
            const cells = (table.columns || [])
                .map((col) => `<td class="multiline">${esc(displayFieldValue(col, row[col.key]))}</td>`)
                .join('');
            const riskCell =
                rating?.score != null
                    ? `<td class="${rating.band === 'High' ? 'bad' : ''}">${esc(`${rating.score} (${rating.band})`)}</td>`
                    : showRisk
                      ? '<td>—</td>'
                      : '';
            return `<tr>${cells}${riskCell}</tr>`;
        })
        .join('');
    return `
      <h2 class="section-title">${esc(table.label)}</h2>
      <table>
        <thead><tr>${head}${showRisk ? '<th>Risk</th>' : ''}</tr></thead>
        <tbody>${body}</tbody>
      </table>`;
}

/** Images for stored documents: this site on the web; the public site from the phone app. */
function assetUrl(path) {
    if (typeof window !== 'undefined' && !isNativeApp() && /^https?:$/.test(window.location?.protocol || '')) {
        return new URL(path, window.location.origin).href;
    }
    return `${siteUrl()}${path}`;
}

const str = (x) => String(x ?? '').trim();
const tick = (on) => `<span class="trn-box">${on ? '&#10003;' : ''}</span>`;
const plain = (value) => (str(value) ? esc(value) : '');
const TRN_MIN_ROWS = 8;

function buildTransmittalSection(submission, def) {
    const v = submission?.payload?.fields || {};
    const rows = submission?.payload?.tableRows || [];
    const fieldDef = (key) => (def.fields || []).find((x) => x.key === key) || { key };
    const label = (key, fallback) => esc(String(fieldDef(key).label || fallback).toUpperCase());
    const val = (key) => (str(v[key]) || Array.isArray(v[key]) ? esc(displayFieldValue(fieldDef(key), v[key])) : '');
    const via = Array.isArray(v.transmitted_via) ? v.transmitted_via : [];
    const purpose = Array.isArray(v.purpose) ? v.purpose : [];
    const viaOptions = fieldDef('transmitted_via').options || [];
    const purposeOptions = fieldDef('purpose').options || [];

    const info = [
        ['company_name', 'transmittal_no'],
        ['attn', 'date'],
        ['address', 'project_ref'],
        ['project', 'our_ref'],
        ['tel_email', 'no_of_pages'],
    ]
        .map(([a, b]) => `<tr><th>${label(a)}</th><td class="multiline">${val(a)}</td><th>${label(b)}</th><td>${val(b)}</td></tr>`)
        .join('');

    const viaRows = viaOptions.map((opt) =>
        opt === 'Others'
            ? `${tick(via.includes(opt))}Others: ${via.includes(opt) && str(v.via_others) ? `<u>${esc(v.via_others)}</u>` : '____________'}`
            : `${tick(via.includes(opt))}${esc(opt)}`
    );
    const purposePairs = [];
    for (let i = 0; i < purposeOptions.length; i += 2) {
        purposePairs.push(
            purposeOptions
                .slice(i, i + 2)
                .map((opt) => `<span style="display:inline-block;width:50%">${tick(purpose.includes(opt))}${esc(opt)}</span>`)
                .join('')
        );
    }
    const boxRows = Math.max(viaRows.length, purposePairs.length + 1);
    let boxes = '';
    for (let i = 0; i < boxRows; i += 1) {
        const right =
            i < purposePairs.length
                ? purposePairs[i]
                : i === purposePairs.length
                  ? '<span class="trn-ack">Please acknowledge receipt by signing and returning the duplicate copy.</span>'
                  : '';
        boxes += `<tr><td style="width:50%">${viaRows[i] || ''}</td><td>${right}</td></tr>`;
    }

    const cols = def.table?.columns || [];
    const colLabel = (key, fallback) => esc(String(cols.find((c) => c.key === key)?.label || fallback).toUpperCase());
    const docRows = [];
    const count = Math.max(rows.length, TRN_MIN_ROWS);
    for (let i = 0; i < count; i += 1) {
        const r = rows[i] || {};
        const d = r.doc_date ? formatDateOnly(r.doc_date) || r.doc_date : '';
        docRows.push(
            `<tr><td class="c">${i + 1}</td><td>${plain(r.description)}</td><td class="c">${plain(r.doc_no)}</td><td class="c">${plain(r.rev)}</td><td class="c">${plain(d)}</td><td class="c">${plain(r.copies)}</td><td class="c">${plain(r.hard_soft)}</td><td>${plain(r.doc_remarks)}</td></tr>`
        );
    }

    const status = submission?.status || 'pending';
    const statusTag =
        status === 'approved' ? '' : `<span class="trn-status">${status === 'rejected' ? 'REJECTED' : 'PENDING APPROVAL'}</span>`;

    return `
    <section class="company-form trn">
      ${statusTag}
      <div class="trn-head">
        <img src="${esc(assetUrl('/forms/akk-logo.png'))}" alt="AKK" class="trn-logo" />
        <div class="trn-head-text">
          <h1>${esc(COMPANY_NAME)}</h1>
          <p class="trn-tag">Electrical Engineering&nbsp; | &nbsp;Fire Protection&nbsp; | &nbsp;Building Construction M&amp;E Services</p>
          <p>Reg No: 201917458W &nbsp;|&nbsp; 15 Kaki Bukit Road 4, #01-50, Singapore 417808</p>
          <p>Website: www.akk.sg &nbsp;|&nbsp; www.akk.com.sg</p>
        </div>
      </div>
      <div class="trn-banner">${esc(String(def.title || 'Transmittal Form').toUpperCase())}</div>
      <table class="trn-info">${info}</table>
      <table class="trn-boxes">
        <tr><th class="trn-bar" style="width:50%">${label('transmitted_via', 'Transmitted via')}</th><th class="trn-bar">${label('purpose', 'Purpose of transmittal')}</th></tr>
        ${boxes}
      </table>
      <table class="trn-docs">
        <tr>
          <th style="width:5%">S/N</th><th style="width:27%">${colLabel('description', 'Description of document / drawing')}</th>
          <th style="width:14%">${colLabel('doc_no', 'Document / drawing no.')}</th><th style="width:6%">${colLabel('rev', 'Rev')}</th>
          <th style="width:11%">${colLabel('doc_date', 'Date')}</th><th style="width:8%">${colLabel('copies', 'No. of copies')}</th>
          <th style="width:9%">${colLabel('hard_soft', 'Hard / soft')}</th><th>${colLabel('doc_remarks', 'Remarks')}</th>
        </tr>
        ${docRows.join('')}
      </table>
      <div class="trn-remarks">
        <div class="trn-bar">${label('remarks', 'Remarks / special instructions')}</div>
        <div class="trn-remarks-body">${val('remarks')}</div>
      </div>
      <table class="trn-sign">
        <tr><th class="trn-bar" style="width:50%">TRANSMITTED BY (${esc(COMPANY_NAME)})</th><th class="trn-bar">RECEIVED BY (ACKNOWLEDGEMENT)</th></tr>
        <tr><td class="sig">Signature / Company Stamp:</td><td class="sig">Signature / Company Stamp:</td></tr>
        <tr><td>Name: <span class="v">${val('transmitted_by') || plain(submission?.worker_name)}</span></td><td>Name:</td></tr>
        <tr><td>Designation: <span class="v">${val('designation')}</span></td><td>Designation:</td></tr>
        <tr><td>Date: <span class="v">${val('date')}</span></td><td>Date:</td></tr>
      </table>
      <div class="trn-foot">
        <p><strong>AKK Engineering Pte. Ltd.</strong> &nbsp;|&nbsp; www.akk.sg<br/>Please check items received against this list and notify us of any discrepancy within 3 working days.</p>
        <img src="${esc(assetUrl('/forms/sme500-2026.png'))}" alt="SME500 Singapore Award Winner 2026" />
        <img src="${esc(assetUrl('/forms/bizsafe-star.png'))}" alt="bizSAFE Star" />
      </div>
    </section>`;
}

/**
 * Build the printable original for one submission.
 * Callers store this HTML and reuse it. Do not rebuild on every print.
 */
export function buildCompanyFormDocumentHtml({ submission, definition, logoUrl } = {}) {
    const def = definition || submission?.definition_snapshot || {};
    if (def.printLayout === 'transmittal') {
        const no = str(submission?.payload?.fields?.transmittal_no);
        return wrapCompanyFormDocument(buildTransmittalSection(submission, def), no ? `Transmittal ${no}` : def.title || 'Transmittal Form');
    }
    const fields = submission?.payload?.fields || {};
    const checklist = submission?.payload?.checklist || {};
    const tableRows = submission?.payload?.tableRows || [];
    const logoSrc = resolveLogoSrc(logoUrl);
    const title = def.title || submission?.form_key || 'Company form';
    const status = submission?.status || 'pending';
    const ref = submission?.id ? String(submission.id).slice(0, 8).toUpperCase() : '—';

    const flagBlock =
        submission?.is_flagged && submission?.flag_reasons?.length
            ? `<div class="note flag-note"><strong>Flag reasons</strong><ul>${submission.flag_reasons
                  .map((reason) => `<li>${esc(reason)}</li>`)
                  .join('')}</ul></div>`
            : '';

    const reviewBlock = submission?.reviewed_at
        ? `<div class="note">
            <p><strong>Reviewed by</strong> ${esc(submission.reviewed_by)} (${esc(submission.reviewed_by_role)}) on ${esc(formatWhen(submission.reviewed_at))}</p>
            ${submission.recommended_result ? `<p><strong>Recommended result:</strong> ${esc(submission.recommended_result)}</p>` : ''}
            ${submission.review_note ? `<p class="multiline"><strong>Note:</strong> ${esc(submission.review_note)}</p>` : ''}
          </div>`
        : submission?.recommended_result
          ? `<div class="note"><strong>Recommended result:</strong> ${esc(submission.recommended_result)}</div>`
          : '';

    const section = `
    <section class="company-form">
      <header class="form-header">
        ${logoSrc ? `<img src="${esc(logoSrc)}" alt="Company logo" class="logo" />` : ''}
        <div class="header-text">
          <h1>${esc(title)}</h1>
          <p class="company">${esc(COMPANY_NAME)}</p>
          <p class="address">${esc(COMPANY_ADDRESS)}</p>
        </div>
      </header>
      <p class="meta">
        <span class="pill ${statusClass(status)}">${esc(status)}</span>
        ${submission?.is_flagged ? '<span class="pill pill-flagged">Flagged</span>' : ''}
        <span>${esc(getDepartmentLabel(submission?.department || def.department))}</span>
        <span>Ref ${esc(ref)}</span>
        <span>Submitted ${esc(formatWhen(submission?.created_at))}</span>
      </p>

      <h2 class="section-title">Submission</h2>
      <table class="info-table">
        <tr><th>Employee</th><td>${esc(submission?.worker_name)}</td></tr>
        <tr><th>Employee ID</th><td>${esc(submission?.worker_id)}</td></tr>
        ${fieldRows(def.fields, fields)}
        ${fieldRows(def.extraFields, fields)}
      </table>

      ${checklistTables(def, checklist)}
      ${tableSection(def, tableRows)}
      ${flagBlock}
      ${reviewBlock}

      <div class="signatures">
        <div class="sig-block">
          <p class="sig-line"></p>
          <p>Submitted by ${esc(submission?.worker_name)}</p>
          <p>${esc(formatWhen(submission?.created_at))}</p>
        </div>
        <div class="sig-block">
          <p class="sig-line"></p>
          <p>${submission?.reviewed_by ? `Reviewed by ${esc(submission.reviewed_by)}` : 'Reviewer signature'}</p>
          <p>${submission?.reviewed_at ? esc(formatWhen(submission.reviewed_at)) : 'Date: _______________'}</p>
        </div>
      </div>
    </section>`;

    return wrapCompanyFormDocument(section, title);
}

export function wrapCompanyFormDocument(sectionsHtml, title = 'Company form') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>${COMPANY_FORM_PRINT_CSS}</style>
</head>
<body>
  ${sectionsHtml}
</body>
</html>`;
}

function extractFormSection(html) {
    const source = String(html || '');
    if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const section = doc.querySelector('.company-form');
        if (section) return section.outerHTML;
    }
    const match = source.match(/<section class="company-form[\s\S]*?<\/section>/i);
    return match ? match[0] : `<section class="company-form"><p>Empty form</p></section>`;
}

/** Join stored originals into one print file. Does not rebuild form content. */
export function mergeCompanyFormDocuments(htmlList, title = 'Company forms') {
    const pages = (htmlList || []).filter(Boolean).map(extractFormSection).join('\n');
    const count = (htmlList || []).filter(Boolean).length;
    const cover = `<div class="batch-cover"><h1>Company forms</h1><p>${count} original form${count === 1 ? '' : 's'}</p></div>`;
    return wrapCompanyFormDocument(`${cover}${pages}`, title);
}
