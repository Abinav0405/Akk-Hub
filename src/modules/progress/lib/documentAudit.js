import { supabaseProgress } from '@/core/supabase'
import { portalExporterToken, portalManagerToken, activePortalRole } from '@/core/auth/progress/portalAuth';
import { friendlyDbError, isMissingRpcError } from '@/modules/progress/lib/networkError';

export const DOCUMENT_KINDS = ['jsr', 'jsr_claim', 'package', 'invoice'];

export function commercialDocumentKind(kind) {
  if (kind === 'claim') return 'jsr_claim';
  if (kind === 'jsr') return 'jsr';
  return kind;
}

/**
 * Send credentials for this tab's portal only.
 * Export Only pages always send the exporter session token (never manager /
 * staff). Admin/Manager pages send staff credentials and never the exporter
 * token — so a leftover Export Only login cannot make staff PDF/endorse calls
 * fail with "Document not found", and an Admin JWT left in the browser cannot
 * make Export Only actions record as Admin (SQL 0073 prefers a non-empty
 * exporter token when the client sends one).
 */
export function documentAuthArgs() {
  const portal = activePortalRole();
  if (portal === 'exporter') {
    return { p_manager_token: null, p_exporter_token: portalExporterToken() };
  }
  return { p_manager_token: portalManagerToken(), p_exporter_token: null };
}

function documentRpcError(error, fallback) {
  if (isMissingRpcError(error)) {
    return new Error(
      'Document storage RPCs are missing. Apply 0048_document_endorsements.sql and 0054_document_audit_list_fix.sql in the SQL editor, then run NOTIFY pgrst, \'reload schema\';'
    );
  }
  const text = typeof error === 'string' ? error : error?.message || '';
  if (/document not found/i.test(text)) {
    return new Error(
      'Could not load document data. Refresh, or apply 0054_document_audit_list_fix.sql and 0073_portal_actor_prefers_exporter_token.sql.'
    );
  }
  return new Error(friendlyDbError(error, fallback));
}

function unwrap(data) {
  let raw = data;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) raw = raw[0] ?? null;
  return raw;
}

/**
 * Append-only audit row. Never throws to callers that `.catch()` — still
 * throws if you await it so a missing migration is visible in the console.
 */
export async function recordDocumentEvent({ kind, documentId, action, summary, details } = {}) {
  if (!kind || !documentId || !action) return null;
  const docKind = commercialDocumentKind(kind);
  const { data, error } = await supabaseProgress.rpc('document_record_event', {
    p_kind: docKind,
    p_document_id: documentId,
    p_action: String(action),
    p_summary: summary || '',
    p_details: details && typeof details === 'object' ? details : {},
    ...documentAuthArgs(),
  });
  if (error) throw documentRpcError(error, 'Could not record the document event');
  return data;
}

export function recordDocumentEventSafe(args) {
  return recordDocumentEvent(args).catch((e) => {
    console.warn('[documentAudit]', e?.message || e);
    return null;
  });
}

export async function listDocumentEvents({ kind, documentId } = {}) {
  if (!kind || !documentId) return [];
  const docKind = commercialDocumentKind(kind);
  const { data, error } = await supabaseProgress.rpc('document_list_events', {
    p_kind: docKind,
    p_document_id: documentId,
    ...documentAuthArgs(),
  });
  if (error) {
    const text = `${error.message || ''} ${error.details || ''}`;
    // Pre-0054 / leftover Export Only token: do not toast a hard failure —
    // audit is optional UI; empty list is correct when there are no rows.
    if (/document not found|cannot view that audit trail/i.test(text)) {
      console.warn('[documentAudit] listDocumentEvents:', text.trim());
      return [];
    }
    throw documentRpcError(error, 'Could not load the audit trail');
  }
  if (Array.isArray(data)) return data;
  const rows = unwrap(data);
  return Array.isArray(rows) ? rows : [];
}

export function exporterIdsFromPayload(payload = {}) {
  const raw = payload.exporter_ids ?? payload.exporterIds;
  if (Array.isArray(raw) && raw.length) {
    return [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))];
  }
  const one = payload.exporter_id || payload.exporterId;
  return one ? [String(one)] : [];
}

export function workflowEventFields(kind, action, payload = {}) {
  const docKind = commercialDocumentKind(kind);
  const exporterIds = exporterIdsFromPayload(payload);
  const names = payload.exporter_names || payload.exporterNames || [];
  const summaries = {
    submit: 'Submitted for approval',
    approve: 'Approved',
    reject: 'Rejected',
    pass_to_client: exporterIds.length
      ? `Passed to Export Only (${exporterIds.length} ID${exporterIds.length === 1 ? '' : 's'})`
      : 'Passed to client',
    passed: exporterIds.length
      ? `Passed to Export Only (${exporterIds.length} ID${exporterIds.length === 1 ? '' : 's'})`
      : 'Passed to client',
    assign_exporter: exporterIds.length
      ? `Assigned Export Only (${exporterIds.length} ID${exporterIds.length === 1 ? '' : 's'})`
      : 'Assigned Export Only ID',
    unsent: exporterIds.length
      ? `Export Only set updated (${exporterIds.length} ID${exporterIds.length === 1 ? '' : 's'})`
      : 'Export Only assignment updated',
    unsend: 'Unsent from Export Only',
    ack: 'Client response acknowledged',
    payment_cert: 'Payment certificate recorded',
    prepare_invoice: 'Invoice prepared',
    submit_invoice: 'Invoice submitted to client',
    payment_pending: 'Marked payment pending',
    paid: 'Marked paid',
  };
  return {
    kind: docKind,
    action,
    summary: summaries[action] || String(action || 'Updated'),
    details: {
      ...payload,
      exporter_ids: exporterIds,
      exporter_names: Array.isArray(names) ? names : [],
    },
  };
}
