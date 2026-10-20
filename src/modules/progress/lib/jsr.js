import { supabaseProgress } from '@/core/supabase'
import { portalExporterToken, portalManagerToken } from '@/core/auth/progress/portalAuth';
import { getSignedUrl, listAllPackages } from '@/modules/progress/lib/staffPackages';
import { fitPdfPhoto } from '@/modules/progress/lib/packagePdf';
import { friendlyDbError, isMissingRpcError } from '@/modules/progress/lib/networkError';
import { jsrCan } from '@/modules/progress/lib/jsrPermissions';
import { jsrStatusLabel } from '@/modules/progress/lib/jsrStatus';
import { buildPackageAutoTitle, packageHeading } from '@/modules/progress/lib/sectionLabel';
import {
  commercialDocumentKind,
  recordDocumentEventSafe,
  workflowEventFields,
} from '@/modules/progress/lib/documentAudit';

const PHOTO_FETCH_CONCURRENCY = 4;
const photoDataUrlCache = new Map();

export async function runPool(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const out = new Array(list.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), list.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < list.length) {
        const index = cursor;
        cursor += 1;
        out[index] = await mapper(list[index], index);
      }
    })
  );
  return out;
}

export function jsrExporterIds(record) {
  if (!record) return [];
  if (Array.isArray(record.exporter_ids) && record.exporter_ids.length) {
    return [...new Set(record.exporter_ids.map((id) => String(id || '').trim()).filter(Boolean))];
  }
  if (Array.isArray(record.exporters) && record.exporters.length) {
    return [...new Set(record.exporters.map((row) => String(row?.id || '').trim()).filter(Boolean))];
  }
  return record.exporter_id ? [String(record.exporter_id)] : [];
}

export function jsrExporterLabel(record) {
  if (Array.isArray(record?.exporters) && record.exporters.length) {
    return record.exporters.map((row) => row.display_name).filter(Boolean).join(', ');
  }
  return record?.exporter_name || '';
}

export function jsrHasExporters(record) {
  return jsrExporterIds(record).length > 0;
}

function auditPassTargets(payload = {}) {
  const ids = Array.isArray(payload.exporter_ids)
    ? [...new Set(payload.exporter_ids.map((id) => String(id || '').trim()).filter(Boolean))]
    : payload.exporter_id
      ? [String(payload.exporter_id)]
      : [];
  const names = Array.isArray(payload.exporter_names)
    ? payload.exporter_names.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  return { ids, names };
}

export function defaultJsrSignoff(record) {
  const co = record?.company || {};
  const ct = record?.contract || {};
  const stored = Boolean(
    record?.submitted_by_name ||
      record?.submitted_by_company ||
      record?.checked_by_title ||
      record?.checked_by_name ||
      record?.checked_by_company
  );
  return {
    submitted_by_name: stored ? record.submitted_by_name || '' : co.sub_by || '',
    submitted_by_company: stored ? record.submitted_by_company || '' : co.name || '',
    checked_by_title: stored ? record.checked_by_title || '' : ct.client_attn || 'Engineer In-charge',
    checked_by_name: stored ? record.checked_by_name || '' : '',
    checked_by_company: stored ? record.checked_by_company || '' : ct.client_name || '',
  };
}

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineAmountFromRate(qty, rate) {
  return roundMoney((Number(qty) || 0) * (Number(rate) || 0));
}

/** True once Export Only has stored a certified figure for this line. Null means not certified yet. */
export function hasCertifiedAmount(value) {
  return value != null && value !== '';
}

export const MANAGER_JSR_DELETE_BLOCKED_STATUSES = [
  'claimed',
  'invoiceprepared',
  'invoicesubmitted',
  'paymentpending',
  'paid',
];

export function jsrDeleteBlockedForManager(rec) {
  if (!rec) return true;
  if (MANAGER_JSR_DELETE_BLOCKED_STATUSES.includes(rec.status)) return true;
  if (rec.claim_id || rec.claim_no) return true;
  if (rec.invoice_no || rec.invoice) return true;
  return false;
}

export function canShowJsrDelete(role, perms, rec) {
  if (!jsrCan(role, perms, 'delete_jsr')) return false;
  if (role === 'admin') return true;
  return !jsrDeleteBlockedForManager(rec);
}

/** Statuses where Admin / Manager (edit_jsr) may change details, packages, and items. */
export const JSR_CONTENT_EDITABLE_STATUSES = ['draft', 'rejected', 'submitted'];

export function jsrContentEditable(status) {
  return JSR_CONTENT_EDITABLE_STATUSES.includes(status);
}

/** Admin always; Manager only with edit_jsr. Approved+ is never editable. */
export function canEditJsrContent(role, perms, status) {
  if (!jsrContentEditable(status)) return false;
  return jsrCan(role, perms, 'edit_jsr');
}

export const JSR_EDIT_LOCKED_MESSAGE =
  'This JSR can no longer be edited after it has been reviewed. You can still delete it if you have delete permission.';

export function jsrDeleteConfirmText(role, rec) {
  const no = rec?.jsr_no || 'this JSR';
  if (role !== 'admin') {
    return [
      `Delete JSR ${no}?`,
      '',
      'Linked photo packages and photos are not deleted.',
      'JSRs on a claim, or after invoicing or payment has started, cannot be deleted.',
    ].join('\n');
  }

  const status = jsrStatusLabel(rec?.status);
  const claimNo = rec?.claim_no;
  const invoiceNo = rec?.invoice_no || rec?.invoice?.invoice_no;
  const exporter = jsrExporterLabel(rec);
  const lines = [
    `Delete JSR ${no} and the commercial effects attached to it?`,
    '',
    'This permanently removes:',
    `• The JSR record (${status})`,
    '• Line items',
    '• Photo-package links (photo packages and photos are kept)',
    claimNo
      ? `• Claim link ${claimNo} — the claim is kept even if it becomes empty; this-month total is recalculated`
      : '• Claim membership, if any (the claim is kept; this-month total is recalculated)',
    invoiceNo ? `• JSR invoice ${invoiceNo}` : '• Invoices prepared from this JSR, if any',
    '• Workflow history and client attachments for this JSR',
    exporter ? `• Export Only assignment (${exporter})` : '• Export Only assignment on this JSR',
    '',
    'This cannot be undone.',
  ];
  return lines.join('\n');
}

function managerToken() {
  return portalManagerToken();
}

function exporterToken() {
  return portalExporterToken();
}

function unwrapRpcJson(data) {
  let raw = data;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) raw = raw[0] ?? null;
  return raw && typeof raw === 'object' ? raw : null;
}

async function rpc(name, args, fallback) {
  const { data, error } = await supabaseProgress.rpc(name, args);
  if (error) throw new Error(friendlyDbError(error, fallback));
  return data;
}

const FALLBACK_SCHEDULE_GROUPS = [
  { code: 'B', label: 'maintenance', sort_order: 10 },
  { code: 'C', label: 'provisional sum', sort_order: 20 },
];

export function scheduleGroupsFrom(lookups) {
  const rows = lookups?.schedule_groups;
  if (Array.isArray(rows) && rows.length) {
    return [...rows].sort(
      (a, b) =>
        Number(a.sort_order || 0) - Number(b.sort_order || 0)
        || String(a.code || '').localeCompare(String(b.code || ''))
    );
  }
  return FALLBACK_SCHEDULE_GROUPS;
}

export function formatScheduleGroup(g) {
  if (!g) return '';
  const label = String(g.label || '').trim();
  return label ? `${g.code} (${label})` : String(g.code || '');
}

export function formatContractOption(c) {
  if (!c) return '';
  const main = [c.code, c.description].filter(Boolean).join(' — ');
  return c.schedule ? `Schedule ${c.schedule} · ${main}` : main;
}

export function autoScWorkForGroup(g) {
  if (!g?.code) return '';
  const label = String(g.label || g.code).trim();
  return `Schedule ${g.code} - ${label}`;
}

/**
 * JSR package picker label. Packages have no name/title column — the product
 * title is packageHeading (site · section-lcb). packages.description is optional
 * worker notes, not the title.
 */
export function jsrPackagePickerName(pkg) {
  const id = String(pkg?.display_id || '').trim();
  const hasName = Boolean(
    String(pkg?.site?.name || pkg?.site_name || '').trim()
    || String(pkg?.lcb_id || '').trim()
  );
  const name = hasName ? packageHeading({ ...pkg, display_id: '' }).trim() : '';
  return {
    primary: name || id || 'Package',
    secondary: name && id ? id : '',
  };
}

export async function loadJsrLookups() {
  const data = await rpc('staff_jsr_lookups', { p_manager_token: managerToken() }, 'Could not load JSR catalogs');
  const raw = unwrapRpcJson(data) || {};
  return {
    companies: raw.companies || [],
    contracts: raw.contracts || [],
    schedule_groups: raw.schedule_groups || [],
    catalog: raw.catalog || [],
    settings: raw.settings || {},
    permissions: raw.permissions,
    permissionsPresent: Object.prototype.hasOwnProperty.call(raw, 'permissions'),
  };
}

/** Short chip label for a linked package on the JSR list. */
export function jsrLinkedPackageChipLabel(pkg) {
  const id = String(pkg?.display_id || '').trim();
  if (id) return id;
  const title = buildPackageAutoTitle({
    description: pkg?.description,
    sectionLabel: pkg?.section_label,
    lcbId: pkg?.section_value ?? pkg?.lcb_id,
    streetName: pkg?.street_name,
  });
  if (!title) return 'Package';
  return title.length > 28 ? `${title.slice(0, 27)}…` : title;
}

/** JSR list title under the number: package description only (no section/street/site). */
function packageSummaryFromRow(pkg) {
  if (!pkg) return '';
  const desc = String(pkg.description || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (desc) return desc;
  return String(pkg.display_id || '').trim();
}

/**
 * Attaches linked packages to each JSR list row.
 * Prefers 0078 (`*_jsr_linked_packages` → all packages) and falls back to 0077
 * (`*_jsr_first_packages` → first only). Sets `linked_packages`, `first_package`,
 * and `summary` (first package description, or display_id if empty).
 */
async function withLinkedPackages(rows, linkedRpc, firstRpc, args) {
  if (!rows?.length) return rows || [];

  const linked = await supabaseProgress.rpc(linkedRpc, args);
  if (!linked.error && Array.isArray(linked.data)) {
    const byJsr = new Map();
    for (const p of linked.data) {
      const list = byJsr.get(p.jsr_id);
      if (list) list.push(p);
      else byJsr.set(p.jsr_id, [p]);
    }
    return rows.map((r) => {
      const pkgs = byJsr.get(r.id);
      if (!pkgs?.length) return r;
      const first = pkgs[0];
      return {
        ...r,
        linked_packages: pkgs,
        first_package: first,
        summary: packageSummaryFromRow(first),
      };
    });
  }

  const firstOnly = await supabaseProgress.rpc(firstRpc, args);
  if (firstOnly.error || !Array.isArray(firstOnly.data)) return rows;
  const byJsr = new Map(firstOnly.data.map((p) => [p.jsr_id, p]));
  return rows.map((r) => {
    const pkg = byJsr.get(r.id);
    if (!pkg) return r;
    return {
      ...r,
      linked_packages: [pkg],
      first_package: pkg,
      summary: packageSummaryFromRow(pkg),
    };
  });
}

export async function listJsrs() {
  const rows = (await rpc('staff_list_jsrs', { p_manager_token: managerToken() }, 'Could not load JSRs')) || [];
  return withLinkedPackages(
    rows,
    'staff_jsr_linked_packages',
    'staff_jsr_first_packages',
    { p_manager_token: managerToken() }
  );
}

export async function getJsr(id) {
  return rpc('staff_get_jsr', { p_jsr_id: id, p_manager_token: managerToken() }, 'Could not load that JSR');
}

export async function listJsrPackages(siteId) {
  if (!siteId) return [];
  const rows = (
    (await rpc(
      'staff_list_jsr_packages',
      { p_site_id: siteId, p_manager_token: managerToken() },
      'Could not load photo packages'
    )) || []
  );
  // A database without 0076 returns no description / street / section here, so the
  // picker could not show or search the package title. Fill them in from the package
  // board's list (same packages) so the picker names packages exactly as that page does.
  const missing = rows.length && rows.some((r) => !('street_name' in r) || !('section_label' in r) || !('description' in r));
  if (!missing) return rows;
  try {
    const byId = new Map((await listAllPackages()).map((p) => [p.id, p]));
    return rows.map((r) => {
      const full = byId.get(r.id);
      if (!full) return r;
      return {
        ...r,
        description: r.description || full.description || '',
        street_name: r.street_name || full.street_name || '',
        section_label: r.section_label || full.section_label || null,
        lcb_id: r.lcb_id || full.lcb_id,
      };
    });
  } catch {
    return rows;
  }
}

function isUniqueViolation(error) {
  return /23505|duplicate key|unique constraint/i.test(
    `${error?.message || ''} ${error?.details || ''} ${error?.code || ''}`
  );
}

export async function saveJsr(payload, { submit = false, jsrId = null } = {}) {
  const body = payload && typeof payload === 'object' ? { ...payload } : {};
  delete body.jsr_no;
  delete body.original_jsr_no;
  delete body.status;
  const args = {
    p_payload: body,
    p_submit: submit,
    p_jsr_id: jsrId,
    p_manager_token: managerToken(),
  };
  const attempts = jsrId ? 1 : 5;
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    const { data, error } = await supabaseProgress.rpc('staff_save_jsr', args);
    if (!error) {
      recordDocumentEventSafe({
        kind: 'jsr',
        documentId: data,
        action: jsrId ? 'updated' : 'created',
        summary: jsrId ? 'JSR fields updated' : 'JSR created',
        details: {
          package_ids: body.package_ids || [],
          site_id: body.site_id,
          contract_id: body.contract_id,
          submit,
        },
      });
      if (submit) {
        recordDocumentEventSafe({
          kind: 'jsr',
          documentId: data,
          action: 'submitted',
          summary: 'Submitted for approval',
        });
      }
      return data;
    }
    lastError = error;
    if (jsrId || !isUniqueViolation(error) || i === attempts - 1) {
      throw new Error(friendlyDbError(error, 'Could not save the JSR'));
    }
  }
  throw new Error(friendlyDbError(lastError, 'Could not save the JSR'));
}

/** JSR statuses where the number can still be changed by hand (before the client has it). */
export const JSR_NUMBER_EDITABLE_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];

/** Rename a JSR by hand. Allowed until it is passed to the client; numbers stay unique. */
export async function setJsrNumber(jsrId, jsrNo) {
  const { data, error } = await supabaseProgress.rpc('staff_set_jsr_no', {
    p_jsr_id: jsrId,
    p_jsr_no: jsrNo,
    p_manager_token: managerToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Apply migration 0069_claim_pc_no_site_options_endorsement_fixes.sql in the Supabase SQL editor to edit JSR numbers.');
    }
    throw new Error(friendlyDbError(error, 'Could not change the JSR number'));
  }
  return data;
}

export async function listClaims() {
  return (await rpc('staff_list_claims', { p_manager_token: managerToken() }, 'Could not load claims')) || [];
}

export async function getClaim(id) {
  return rpc('staff_get_claim', { p_claim_id: id, p_manager_token: managerToken() }, 'Could not load that claim');
}

/**
 * Saves the "submitted by / checked by" details a claim PDF prints. Called right before
 * passing a claim to the client, so what staff typed is what the client's copy shows.
 * `signoff` has the same five fields as a JSR (see defaultJsrSignoff).
 */
export async function setClaimSignoff(claimId, signoff) {
  const { error } = await supabaseProgress.rpc('staff_set_claim_signoff', {
    p_claim_id: claimId,
    p_payload: signoff,
    p_manager_token: managerToken(),
  });
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error('Apply migration 0068_exporter_privacy_claim_signoff.sql in the Supabase SQL editor so claim signature details can be saved.');
    }
    throw new Error(friendlyDbError(error, 'Could not save the signature details'));
  }
}

export async function listClaimJsrs(contractId) {
  if (!contractId) return [];
  return (
    (await rpc(
      'staff_list_claim_jsrs',
      { p_contract_id: contractId, p_manager_token: managerToken() },
      'Could not load JSRs for this contract'
    )) || []
  );
}

export async function saveClaim(payload, { submit = false, claimId = null } = {}) {
  const id = await rpc(
    'staff_save_claim',
    {
      p_payload: payload,
      p_submit: submit,
      p_claim_id: claimId,
      p_manager_token: managerToken(),
    },
    'Could not save the claim'
  );
  recordDocumentEventSafe({
    kind: 'jsr_claim',
    documentId: id,
    action: claimId ? 'updated' : 'created',
    summary: claimId ? 'Claim fields updated' : 'Claim created',
    details: {
      jsr_ids: payload?.jsr_ids || [],
      month: payload?.month,
      submit,
    },
  });
  if (submit) {
    recordDocumentEventSafe({
      kind: 'jsr_claim',
      documentId: id,
      action: 'submitted',
      summary: 'Submitted for approval',
    });
  }
  return id;
}

export async function commercialWorkflow(kind, id, action, payload = {}) {
  const data = await rpc(
    'staff_commercial_workflow',
    {
      p_kind: kind,
      p_id: id,
      p_action: action,
      p_payload: payload,
      p_manager_token: managerToken(),
    },
    'Could not update workflow'
  );
  if (
    (kind === 'jsr' || kind === 'claim')
    && (action === 'pass_to_client' || action === 'assign_exporter' || action === 'unsend' || action === 'submit_invoice')
  ) {
    const { ids, names } = auditPassTargets(payload);
    const docKind = commercialDocumentKind(kind);
    let summary;
    let auditAction = action;
    if (action === 'pass_to_client') {
      auditAction = 'passed';
      summary = ids.length
        ? `Passed to Export Only (${ids.length} ID${ids.length === 1 ? '' : 's'})`
        : 'Passed to client';
    } else if (action === 'unsend') {
      auditAction = 'unsent';
      summary = 'Removed from Export Only';
    } else if (action === 'submit_invoice') {
      summary = ids.length
        ? `Invoice submitted to Export Only (${ids.length} ID${ids.length === 1 ? '' : 's'})`
        : 'Invoice submitted to client';
    } else {
      summary = ids.length
        ? `Export Only set updated (${ids.length} ID${ids.length === 1 ? '' : 's'})`
        : 'Export Only assignment updated';
    }
    recordDocumentEventSafe({
      kind: docKind,
      documentId: id,
      action: auditAction,
      summary,
      details: {
        exporter_ids: ids,
        exporter_names: names,
        labels: names,
        workflow_action: action,
      },
    });
  } else {
    const fields = workflowEventFields(kind, action, payload);
    recordDocumentEventSafe({
      kind: fields.kind,
      documentId: id,
      action: fields.action,
      summary: fields.summary,
      details: fields.details,
    });
  }
  return data;
}

export async function listStaffExporters() {
  return (
    (await rpc(
      'staff_list_exporters',
      { p_manager_token: managerToken() },
      'Could not load Export Only accounts'
    )) || []
  );
}

export async function deleteJsr(id, { asAdmin = false } = {}) {
  // Client attachment files are removed through the Storage API afterwards: Supabase
  // does not let the database delete them directly.
  let attachmentPaths = [];
  try {
    const rec = await getJsr(id);
    attachmentPaths = (rec?.attachments || []).map((a) => a.storage_path).filter(Boolean);
  } catch {
    /* still delete the JSR */
  }
  const { error } = asAdmin
    ? await supabaseProgress.rpc('admin_delete_jsr', { p_jsr_id: id })
    : await supabaseProgress.rpc('staff_delete_jsr', { p_jsr_id: id, p_manager_token: managerToken() });
  if (error) {
    const friendly = friendlyDbError(error, '');
    // Show the database's own reason rather than a bare "Could not delete".
    throw new Error(friendly || `Could not delete that JSR: ${error.message || error.details || 'unknown error'}`);
  }
  if (attachmentPaths.length) {
    const { error: storageError } = await supabaseProgress.storage.from('jsr-attachments').remove(attachmentPaths);
    if (storageError) console.warn('[jsr] JSR deleted; attachment files left in storage:', attachmentPaths, storageError);
  }
}

export async function deleteClaim(id) {
  // As deleteJsr: attachment files go through the Storage API after the claim is gone.
  let attachmentPaths = [];
  try {
    const rec = await getClaim(id);
    attachmentPaths = (rec?.attachments || []).map((a) => a.storage_path).filter(Boolean);
  } catch {
    /* still delete the claim */
  }
  const { error } = await supabaseProgress.rpc('staff_delete_claim', { p_claim_id: id, p_manager_token: managerToken() });
  if (error) {
    const friendly = friendlyDbError(error, '');
    throw new Error(friendly || `Could not delete that claim: ${error.message || error.details || 'unknown error'}`);
  }
  if (attachmentPaths.length) {
    const { error: storageError } = await supabaseProgress.storage.from('jsr-attachments').remove(attachmentPaths);
    if (storageError) console.warn('[jsr] Claim deleted; attachment files left in storage:', attachmentPaths, storageError);
  }
}

export async function listInvoices() {
  return (await rpc('staff_list_invoices', { p_manager_token: managerToken() }, 'Could not load invoices')) || [];
}

export async function listLinkedPhotos(kind, id) {
  return (
    (await rpc(
      'staff_linked_photos',
      { p_kind: kind, p_id: id, p_manager_token: managerToken() },
      'Could not load linked photos'
    )) || []
  );
}

export async function upsertCompany(id, payload) {
  return rpc(
    'admin_upsert_company',
    { p_id: id, p_payload: payload, p_manager_token: managerToken() },
    'Could not save company'
  );
}

export async function removeCompany(id) {
  return rpc(
    'admin_delete_company',
    { p_id: id, p_manager_token: managerToken() },
    'Could not delete company'
  );
}

export async function upsertContract(id, payload) {
  return rpc(
    'admin_upsert_contract',
    { p_id: id, p_payload: payload, p_manager_token: managerToken() },
    'Could not save contract'
  );
}

export async function removeContract(id) {
  return rpc(
    'admin_delete_contract',
    { p_id: id, p_manager_token: managerToken() },
    'Could not delete contract'
  );
}

export async function upsertScheduleGroup(id, payload) {
  return rpc(
    'admin_upsert_schedule_group',
    { p_id: id, p_payload: payload, p_manager_token: managerToken() },
    'Could not save schedule group'
  );
}

export async function removeScheduleGroup(id) {
  return rpc(
    'admin_delete_schedule_group',
    { p_id: id, p_manager_token: managerToken() },
    'Could not delete schedule group'
  );
}

export async function upsertCatalogItem(id, payload) {
  return rpc(
    'admin_upsert_catalog_item',
    { p_id: id, p_payload: payload, p_manager_token: managerToken() },
    'Could not save catalog item'
  );
}

export async function removeCatalogItem(id) {
  return rpc(
    'admin_delete_catalog_item',
    { p_id: id, p_manager_token: managerToken() },
    'Could not delete catalog item'
  );
}

export async function setCompanySettingsLogo(logoUrl) {
  return rpc(
    'admin_set_company_settings',
    { p_logo_url: logoUrl || '', p_manager_token: managerToken() },
    'Could not save logo URL'
  );
}

export async function exporterListJsrs() {
  const rows = (await rpc('exporter_list_jsrs', { p_exporter_token: exporterToken() }, 'Could not load JSRs')) || [];
  return withLinkedPackages(
    rows,
    'exporter_jsr_linked_packages',
    'exporter_jsr_first_packages',
    { p_exporter_token: exporterToken() }
  );
}

export async function exporterGetJsr(id) {
  return rpc('exporter_get_jsr', { p_exporter_token: exporterToken(), p_jsr_id: id }, 'Could not load that JSR');
}

export async function exporterListClaims() {
  return (await rpc('exporter_list_claims', { p_exporter_token: exporterToken() }, 'Could not load claims')) || [];
}

export async function exporterGetClaim(id) {
  return rpc(
    'exporter_get_claim',
    { p_exporter_token: exporterToken(), p_claim_id: id },
    'Could not load that claim'
  );
}

export async function exporterListInvoices() {
  return (
    (await rpc('exporter_list_invoices', { p_exporter_token: exporterToken() }, 'Could not load invoices')) || []
  );
}

export async function exporterGetInvoice(id) {
  return rpc(
    'exporter_get_invoice',
    { p_exporter_token: exporterToken(), p_invoice_id: id },
    'Could not load that invoice'
  );
}

export async function exporterStartReview(kind, id) {
  return rpc(
    'exporter_start_review',
    { p_exporter_token: exporterToken(), p_kind: kind, p_id: id },
    'Could not open review'
  );
}

export async function exporterRespond(kind, id, payload) {
  const result = await rpc(
    'exporter_respond',
    {
      p_exporter_token: exporterToken(),
      p_kind: kind,
      p_id: id,
      p_payload: payload,
    },
    'Could not submit your response'
  );
  recordDocumentEventSafe({
    kind: commercialDocumentKind(kind),
    documentId: id,
    action: 'certified',
    summary: `Client response: ${payload?.response || 'submitted'}`,
    details: {
      response: payload?.response,
      certified_amount: payload?.certified_amount,
      reason: payload?.reason,
    },
  });
  return result;
}

export async function exporterLinkedPhotos(kind, id) {
  return (
    (await rpc(
      'exporter_linked_photos',
      { p_exporter_token: exporterToken(), p_kind: kind, p_id: id },
      'Could not load linked photos'
    )) || []
  );
}

export async function uploadClientAttachment(entityId, file) {
  const safe = String(file.name || 'attachment').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const path = `attachments/${entityId}/${Date.now()}_${safe}`;
  const { error } = await supabaseProgress.storage.from('jsr-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not upload that file'));
  return { file_name: file.name || safe, storage_path: path };
}

export async function signedAttachmentUrl(storagePath) {
  const { data, error } = await supabaseProgress.storage.from('jsr-attachments').createSignedUrl(storagePath, 3600);
  if (error) throw new Error(friendlyDbError(error, 'Could not open that file'));
  return data.signedUrl;
}

async function fitSignedPhoto(storagePath, fit) {
  const scale = fit?.scale ?? '';
  const quality = fit?.quality ?? '';
  const cacheKey = fit ? `${storagePath}|s${scale}|q${quality}` : storagePath;
  const cached = photoDataUrlCache.get(cacheKey);
  if (cached) return cached;
  const url = await getSignedUrl(storagePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load a photo');
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  try {
    const fitted = await fitPdfPhoto(obj, fit || {});
    photoDataUrlCache.set(cacheKey, fitted);
    return fitted;
  } finally {
    URL.revokeObjectURL(obj);
  }
}

export async function loadPhotoDataUrls(rows, { onProgress, fit } = {}) {
  const list = (rows || []).filter((row) => row?.storage_path);
  if (!list.length) return [];
  let done = 0;
  const mapped = await runPool(list, PHOTO_FETCH_CONCURRENCY, async (row) => {
    try {
      if (row.dataUrl) {
        done += 1;
        onProgress?.(done, list.length);
        return row;
      }
      const dataUrl = await fitSignedPhoto(row.storage_path, fit);
      done += 1;
      onProgress?.(done, list.length);
      return { ...row, dataUrl, fitted: true };
    } catch (e) {
      console.warn('[jsr] skipping a photo that failed to load:', row.storage_path, e);
      done += 1;
      onProgress?.(done, list.length);
      return null;
    }
  });
  return mapped.filter(Boolean);
}

export async function loadLinkedPhotosForExport(kind, id, { asExporter = false, onProgress, fit } = {}) {
  const rows = asExporter ? await exporterLinkedPhotos(kind, id) : await listLinkedPhotos(kind, id);
  return loadPhotoDataUrls(rows, { onProgress, fit });
}

export async function resolveLetterhead(company) {
  let branding = null;
  try {
    const { getCompanyBranding, brandingLogoUrl } = await import('@/modules/progress/lib/branding');
    branding = await getCompanyBranding();
    const explicit = company?.logo_path;
    const logo =
      explicit && /^(https?:|data:|blob:)/i.test(explicit)
        ? explicit
        : brandingLogoUrl(branding);
    return {
      name: company?.name || branding?.company_name || 'AKK ENGINEERING PTE. LTD.',
      addr: company?.addr || branding?.company_address || '15 Kaki Bukit Rd 4, #01-50 Singapore 417808',
      reg: company?.reg || '',
      email: company?.email || '',
      web: company?.web || '',
      phone: company?.phone || '',
      sub_by: company?.sub_by || '',
      logo_path: logo || null,
      document_chrome: branding?.document_chrome || null,
      // Every document header prints this one address (Branding), not a per-company variant.
      letterhead_address: branding?.company_address || '',
    };
  } catch {
    return {
      name: company?.name || 'AKK ENGINEERING PTE. LTD.',
      addr: company?.addr || '15 Kaki Bukit Rd 4, #01-50 Singapore 417808',
      reg: company?.reg || '',
      email: company?.email || '',
      web: company?.web || '',
      phone: company?.phone || '',
      sub_by: company?.sub_by || '',
      logo_path: company?.logo_path || null,
      document_chrome: null,
    };
  }
}

