import { getDepartmentLabel } from './catalog';
import { riskBand } from './flagging';

const COMPANY_NAME = 'AKK ENGINEERING PTE. LTD.';
const COMPANY_ADDRESS = '15 Kaki Bukit Rd 4, #01-50, Singapore 417808';

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

/**
 * Build the printable original for one submission.
 * Callers store this HTML and reuse it. Do not rebuild on every print.
 */
export function buildCompanyFormDocumentHtml({ submission, definition, logoUrl } = {}) {
    const def = definition || submission?.definition_snapshot || {};
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
