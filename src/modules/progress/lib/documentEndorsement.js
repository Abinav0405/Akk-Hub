import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { supabaseProgress } from '@/core/supabase'
import { friendlyDbError, isMissingRpcError } from '@/modules/progress/lib/networkError';
import { savePdfBlob } from '@/modules/progress/lib/fileSave';
import {
  commercialDocumentKind,
  documentAuthArgs,
  recordDocumentEventSafe,
} from '@/modules/progress/lib/documentAudit';

export { commercialDocumentKind, recordDocumentEvent, listDocumentEvents, recordDocumentEventSafe } from '@/modules/progress/lib/documentAudit';

export const ARTIFACT_BUCKET = 'document-artifacts';
/** Default stamp for package PDFs that use a footer signature line. */
export const DEFAULT_ENDORSEMENT = {
  xPct: 22,
  yPct: 91.5,
  scale: 1,
  pageIndex: 0,
};
/**
 * JSR / claim / invoice already have Submitted by · Checked by blocks —
 * place the e-sign near the left (Submitted by) signature line at page footer.
 */
export const SIGNOFF_ENDORSEMENT = {
  xPct: 22,
  yPct: 88,
  scale: 1,
  pageIndex: 0,
};
/** Preview guide for package footer signature line only. */
export const FOOTER_LINE_YPCT = 94;

/** Documents whose PDF layout already includes Submitted by / Checked by blocks. */
export function documentHasSignoffBlocks(kind) {
  const k = commercialDocumentKind(kind);
  return k === 'jsr' || k === 'jsr_claim' || k === 'invoice';
}

export function defaultEndorsementForKind(kind) {
  return documentHasSignoffBlocks(kind) ? { ...SIGNOFF_ENDORSEMENT } : { ...DEFAULT_ENDORSEMENT };
}

/** Next free spot on a page so a second signature or seal does not sit on the first. */
export function nextStampPosition(kind, pageIndex, existing = []) {
  const base = defaultEndorsementForKind(kind);
  const onPage = existing.filter((item) => Number(item?.pageIndex) === Number(pageIndex)).length;
  return {
    xPct: Math.min(82, base.xPct + (onPage % 3) * 18),
    yPct: Math.min(93, base.yPct + Math.floor(onPage / 3) * 5),
    scale: base.scale,
  };
}

/** Standalone “Signature / Company seal” footer. Off for packages and JSR/claim/invoice. */
export function shouldAddFooterSignatureLine(kind) {
  const k = commercialDocumentKind(kind);
  if (k === 'package' || k === 'jsr') return false;
  return !documentHasSignoffBlocks(kind);
}

const SIGNED_URL_TTL = 3600;

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
  return raw && typeof raw === 'object' ? raw : null;
}

function artifactPath(kind, documentId) {
  return `${kind}/${documentId}/current.pdf`;
}

/** New object per save so a cached unsigned current.pdf cannot be stamped again. */
function endorsedArtifactPath(kind, documentId) {
  return `${kind}/${documentId}/endorsed-${crypto.randomUUID()}.pdf`;
}

const artifactEnsureJobs = new Map();

function endorsementImagePath(kind, documentId, endorsementId) {
  return `${kind}/${documentId}/endorsements/${endorsementId}.png`;
}

function sealPath(companyId) {
  return `seals/${companyId}.png`;
}

async function signedUrl(storagePath) {
  const { data, error } = await supabaseProgress.storage.from(ARTIFACT_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL);
  if (error) throw new Error(friendlyDbError(error, 'Could not open the stored document'));
  return data.signedUrl;
}

async function uploadBytes(path, bytes, contentType, upsert = true) {
  const { error } = await supabaseProgress.storage.from(ARTIFACT_BUCKET).upload(path, bytes, {
    contentType,
    upsert,
    cacheControl: '0',
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not store the document'));
}

export async function downloadStoredPdf(storagePath) {
  return downloadBytes(storagePath);
}

async function downloadBytes(storagePath) {
  const signed = await signedUrl(storagePath);
  const freshUrl = `${signed}${signed.includes('?') ? '&' : '?'}cb=${Date.now()}`;
  const res = await fetch(freshUrl, { cache: 'no-store' });
  if (res.ok) return new Uint8Array(await res.arrayBuffer());
  const { data, error } = await supabaseProgress.storage.from(ARTIFACT_BUCKET).download(storagePath);
  if (error) throw new Error(friendlyDbError(error, 'Could not download the stored document'));
  return new Uint8Array(await data.arrayBuffer());
}

export async function addFooterSignatureLine(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    const y = 32;
    page.drawLine({
      start: { x: 46, y },
      end: { x: width - 46, y },
      thickness: 0.7,
      color: rgb(0.12, 0.16, 0.22),
    });
    page.drawText('Signature / Company seal', {
      x: 46,
      y: y - 11,
      size: 7,
      font,
      color: rgb(0.45, 0.48, 0.54),
    });
  }
  return pdf.save();
}

function drawStamp(page, img, { xPct, yPct, scale } = {}) {
  const { width, height } = page.getSize();
  const s = Math.min(Math.max(Number(scale) || 1, 0.2), 4);
  const imgW = width * 0.18 * s;
  const imgH = (img.height / img.width) * imgW;
  const x = (Number(xPct) / 100) * width - imgW / 2;
  const y = height - (Number(yPct) / 100) * height - imgH / 2;
  page.drawImage(img, { x, y, width: imgW, height: imgH });
}

/** Burn every stamp into the PDF bytes passed in. Does not fetch or rebuild a document. */
export async function stampManyOnPdf(pdfBytes, stamps = []) {
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  const pageCount = pages.length;
  const last = Math.max(pageCount - 1, 0);
  for (const stamp of stamps) {
    if (!stamp?.pngBytes?.byteLength) continue;
    const idx = Math.min(Math.max(Number(stamp.pageIndex) || 0, 0), last);
    const img = await pdf.embedPng(stamp.pngBytes);
    drawStamp(pages[idx], img, stamp);
  }
  return { bytes: await pdf.save(), pageCount };
}

export async function stampPngOnPdf(pdfBytes, pngBytes, placement = {}) {
  return stampManyOnPdf(pdfBytes, [{ ...placement, pngBytes }]);
}

export async function countPdfPages(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  return pdf.getPageCount();
}

export async function getDocumentArtifact({ kind, documentId } = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) return null;
  const { data, error } = await supabaseProgress.rpc('document_get_artifact', {
    p_kind: docKind,
    p_document_id: documentId,
    ...documentAuthArgs(),
  });
  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error(
        'Document storage RPCs are missing. Apply 0048_document_endorsements.sql and 0054_document_audit_list_fix.sql in the SQL editor, then run NOTIFY pgrst, \'reload schema\';'
      );
    }
    throw new Error(friendlyDbError(error, 'Could not load the stored document'));
  }
  const row = unwrap(data);
  if (!row?.storagePath) return null;
  return {
    url: await signedUrl(row.storagePath),
    storagePath: row.storagePath,
    pageCount: Number(row.pageCount) || 1,
    updatedAt: row.updatedAt,
  };
}

async function persistArtifactRow(kind, documentId, storagePath, pageCount) {
  const docKind = commercialDocumentKind(kind);
  const { data, error } = await supabaseProgress.rpc('document_upsert_artifact', {
    p_kind: docKind,
    p_document_id: documentId,
    p_storage_path: storagePath,
    p_page_count: pageCount,
    ...documentAuthArgs(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not save the stored document'));
  return unwrap(data);
}

/**
 * Create the canonical PDF once or return the existing stored file.
 * Used by JSR / claim / invoice so later portals stamp the same file.
 * Package print/download must NOT go through this — staff would stay stuck
 * on an old current.pdf (crushed description, Signature / Company seal line).
 * Package and JSR PDFs do not get a Signature / Company seal footer line.
 *
 * A slow rebuild must not finish after a signature and replace the stamped file.
 */
async function burnExistingEndorsements(docKind, documentId, pdfBytes) {
  let rows = [];
  try {
    rows = await listEndorsements({ kind: docKind, documentId });
  } catch {
    return pdfBytes;
  }
  const stamps = [];
  for (const row of rows || []) {
    if (!row?.imagePath) continue;
    try {
      stamps.push({
        pngBytes: await downloadBytes(row.imagePath),
        xPct: row.xPct,
        yPct: row.yPct,
        scale: row.scale,
        pageIndex: row.pageIndex,
      });
    } catch {
      /* A missing stamp image should not block the rebuilt document. */
    }
  }
  if (!stamps.length) return pdfBytes;
  const stamped = await stampManyOnPdf(pdfBytes, stamps);
  return stamped.bytes;
}

/** Rebuild storage + artifact row. Caller owns the in-flight job lock. */
async function rebuildDocumentArtifactCore(docKind, documentId, buildPdfBlob) {
  const raw = await blobFromBuilder(buildPdfBlob, 'Could not build the PDF for this document');
  let bytes = new Uint8Array(await raw.arrayBuffer());
  if (shouldAddFooterSignatureLine(docKind)) bytes = await addFooterSignatureLine(bytes);
  bytes = await burnExistingEndorsements(docKind, documentId, bytes);
  const pageCount = await countPdfPages(bytes);
  const storagePath = artifactPath(docKind, documentId);
  await uploadBytes(storagePath, bytes, 'application/pdf', true);
  await persistArtifactRow(docKind, documentId, storagePath, pageCount);
  recordDocumentEventSafe({
    kind: docKind,
    documentId,
    action: 'artifact_created',
    summary: 'Canonical PDF rebuilt from the current document',
    details: { storagePath, pageCount, replaced: true },
  });
  return {
    url: await signedUrl(storagePath),
    storagePath,
    pageCount,
    created: true,
  };
}

async function shouldRebuildForLayout(docKind, documentId, layoutChangedAt, rebuildStampedOnLayoutChange) {
  if (!layoutChangedAt) return false;
  const existing = await getDocumentArtifact({ kind: docKind, documentId });
  if (!existing || !artifactIsStale(existing, layoutChangedAt)) return false;
  let hasStamps = false;
  try {
    const rows = await listEndorsements({ kind: docKind, documentId });
    hasStamps = (rows || []).some((row) => row?.imagePath);
  } catch {
    hasStamps = false;
  }
  return !hasStamps || rebuildStampedOnLayoutChange;
}

export async function ensureDocumentArtifact({
  kind,
  documentId,
  buildPdfBlob,
  layoutChangedAt = null,
  rebuildStampedOnLayoutChange = false,
} = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) throw new Error('Document is required');
  const key = `${docKind}:${documentId}`;
  const pending = artifactEnsureJobs.get(key);
  if (pending) return pending;
  const job = (async () => {
    if (typeof buildPdfBlob === 'function') {
      try {
        if (await shouldRebuildForLayout(docKind, documentId, layoutChangedAt, rebuildStampedOnLayoutChange)) {
          return rebuildDocumentArtifactCore(docKind, documentId, buildPdfBlob);
        }
      } catch (e) {
        console.warn('[documentEndorsement] layout rebuild skipped during ensure:', e);
      }
    }
    return createDocumentArtifact({ kind: docKind, documentId, buildPdfBlob });
  })().finally(() => {
    if (artifactEnsureJobs.get(key) === job) artifactEnsureJobs.delete(key);
  });
  artifactEnsureJobs.set(key, job);
  return job;
}

/**
 * Rebuild the canonical PDF from the current HTML (edited sign-off, certified
 * line prices) and point the artifact row at that file. Earlier stamps are
 * burned back on so a pass or certification does not drop them.
 */
export async function replaceDocumentArtifact({ kind, documentId, buildPdfBlob } = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) throw new Error('Document is required');
  const key = `${docKind}:${documentId}`;
  const pending = artifactEnsureJobs.get(key);
  if (pending) await pending.catch(() => {});

  const job = rebuildDocumentArtifactCore(docKind, documentId, buildPdfBlob).finally(() => {
    if (artifactEnsureJobs.get(key) === job) artifactEnsureJobs.delete(key);
  });

  artifactEnsureJobs.set(key, job);
  return job;
}

async function createDocumentArtifact({ kind, documentId, buildPdfBlob } = {}) {
  const docKind = commercialDocumentKind(kind);
  const existing = await getDocumentArtifact({ kind: docKind, documentId });
  if (existing) return { ...existing, created: false };

  if (typeof buildPdfBlob !== 'function') {
    throw new Error('This document has no stored PDF yet — open Print / Download once to create it');
  }
  const raw = await buildPdfBlob();
  if (!raw) throw new Error('Could not build the PDF for this document');

  const raced = await getDocumentArtifact({ kind: docKind, documentId });
  if (raced) return { ...raced, created: false };

  const rawBytes = new Uint8Array(await raw.arrayBuffer());
  const addFooterLine = shouldAddFooterSignatureLine(docKind);
  let bytes = addFooterLine ? await addFooterSignatureLine(rawBytes) : rawBytes;
  // After an artifact clear (e.g. JSR content edit), re-apply stored stamps.
  bytes = await burnExistingEndorsements(docKind, documentId, bytes);
  const pageCount = await countPdfPages(bytes);
  const storagePath = artifactPath(docKind, documentId);

  const beforeUpload = await getDocumentArtifact({ kind: docKind, documentId });
  if (beforeUpload) return { ...beforeUpload, created: false };

  await uploadBytes(storagePath, bytes, 'application/pdf', true);

  const afterUpload = await getDocumentArtifact({ kind: docKind, documentId });
  if (afterUpload) return { ...afterUpload, created: false };

  await persistArtifactRow(docKind, documentId, storagePath, pageCount);
  recordDocumentEventSafe({
    kind: docKind,
    documentId,
    action: 'artifact_created',
    summary: addFooterLine
      ? 'Canonical PDF created (footer signature line added)'
      : 'Canonical PDF created (Submitted by / Checked by signature area)',
    details: { storagePath, pageCount, footerSignatureLine: addFooterLine },
  });
  return {
    url: await signedUrl(storagePath),
    storagePath,
    pageCount,
    created: true,
  };
}

/**
 * The signer's own recent signatures (migration 0082), newest first, each with a URL for a
 * thumbnail. The database works out who is asking from the login — only that person's
 * signatures come back. Empty if 0082 is not applied.
 */
export async function listMySignatures({ limit = 6 } = {}) {
  const { data, error } = await supabaseProgress.rpc('document_my_signatures', {
    ...documentAuthArgs(),
    p_limit: limit,
  });
  if (error) {
    if (isMissingRpcError(error)) return [];
    throw new Error(friendlyDbError(error, 'Could not load your recent signatures'));
  }
  const rows = Array.isArray(data) ? data : [];
  return Promise.all(rows.map(async (row) => ({
    id: row.id,
    imagePath: row.image_path,
    signerName: row.signer_name || '',
    createdAt: row.created_at,
    url: await signedUrl(row.image_path).catch(() => ''),
  })));
}

/** The image of one of your recent signatures, to place and stamp it. */
export async function loadSignatureImage(imagePath) {
  const bytes = await downloadBytes(imagePath);
  return new Blob([bytes], { type: 'image/png' });
}

async function insertEndorsementRow(docKind, documentId, item) {
  if (item.sourceId) {
    // A recent signature: the database checks it is the signer's own before using it.
    const { data, error } = await supabaseProgress.rpc('document_reuse_endorsement', {
      p_kind: docKind,
      p_document_id: documentId,
      p_source_id: item.sourceId,
      p_x_pct: item.xPct,
      p_y_pct: item.yPct,
      p_scale: item.scale,
      p_page_index: item.pageIndex,
      p_signer_name: item.signerName || null,
      ...documentAuthArgs(),
    });
    if (error) {
      if (isMissingRpcError(error)) {
        throw new Error('Apply migration 0082_reuse_own_signature.sql in the Supabase SQL editor to reuse a recent signature.');
      }
      throw new Error(friendlyDbError(error, 'Could not add your signature'));
    }
    return unwrap(data);
  }
  const { data, error } = await supabaseProgress.rpc('document_insert_endorsement', {
    p_kind: docKind,
    p_document_id: documentId,
    p_mode: item.mode,
    p_image_path: item.imagePath,
    p_x_pct: item.xPct,
    p_y_pct: item.yPct,
    p_scale: item.scale,
    p_page_index: item.pageIndex,
    p_signer_name: item.signerName || null,
    ...documentAuthArgs(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not save the signature'));
  return unwrap(data);
}

/**
 * Stamp every item onto the stored PDF that already includes earlier endorsements.
 * Writes a new file instead of replacing current.pdf, which may still be the unsigned original in cache.
 */
export async function saveEndorsements({ kind, documentId, items, companyId } = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) throw new Error('Document is required');
  const fallback = defaultEndorsementForKind(docKind);
  const list = (Array.isArray(items) ? items : []).filter(
    (item) => item?.imageBlob && (item.mode === 'signature' || item.mode === 'seal')
  );
  if (!list.length) throw new Error('Draw or upload a signature or company seal first');

  // A rebuild of this document may still be running (the dialog starts one when it opens).
  // Stamping before it lands would put the mark on the old file, and the rebuild would then
  // overwrite it — the mark would vanish from the PDF but stay in the database.
  const pendingBuild = artifactEnsureJobs.get(`${docKind}:${documentId}`);
  if (pendingBuild) await pendingBuild.catch(() => {});

  const artifact = await getDocumentArtifact({ kind: docKind, documentId });
  if (!artifact?.storagePath) {
    throw new Error('Create the document PDF before signing it');
  }

  const prepared = [];
  for (const item of list) {
    prepared.push({
      mode: item.mode,
      // Same drawing on several pages: uploaded once (groupId). A recent signature
      // (sourceId) is not uploaded at all — it reuses its stored image.
      sourceId: item.sourceId || null,
      sourceImagePath: item.sourceImagePath || null,
      groupId: item.groupId || null,
      pngBytes: new Uint8Array(await item.imageBlob.arrayBuffer()),
      xPct: Number(item.xPct ?? fallback.xPct),
      yPct: Number(item.yPct ?? fallback.yPct),
      scale: Number(item.scale ?? fallback.scale),
      pageIndex: Number(item.pageIndex ?? 0),
      signerName: item.signerName || null,
    });
  }

  const pdfBytes = await downloadBytes(artifact.storagePath);
  const stamped = await stampManyOnPdf(pdfBytes, prepared);
  const storagePath = endorsedArtifactPath(docKind, documentId);

  const uploadedByGroup = new Map();
  for (const item of prepared) {
    if (item.sourceId && item.sourceImagePath) {
      item.imagePath = item.sourceImagePath;
      continue;
    }
    const shared = item.groupId ? uploadedByGroup.get(item.groupId) : null;
    if (shared) {
      item.imagePath = shared;
      continue;
    }
    item.imagePath = endorsementImagePath(docKind, documentId, crypto.randomUUID());
    await uploadBytes(item.imagePath, item.pngBytes, 'image/png', false);
    if (item.groupId) uploadedByGroup.set(item.groupId, item.imagePath);
  }
  await uploadBytes(storagePath, stamped.bytes, 'application/pdf', true);
  await persistArtifactRow(docKind, documentId, storagePath, stamped.pageCount);

  const rows = [];
  for (const item of prepared) {
    const row = await insertEndorsementRow(docKind, documentId, item);
    rows.push(row);
    recordDocumentEventSafe({
      kind: docKind,
      documentId,
      action: 'endorsed',
      summary: item.mode === 'seal' ? 'Company seal added to the stored PDF' : 'Signature added to the stored PDF',
      details: {
        mode: item.mode,
        xPct: item.xPct,
        yPct: item.yPct,
        scale: item.scale,
        pageIndex: item.pageIndex,
        signerName: item.signerName || row?.signerName || '',
      },
    });
  }

  const lastSeal = [...prepared].reverse().find((item) => item.mode === 'seal');
  if (lastSeal && companyId) {
    // Only remembers the seal for next time; never blocks the document. (A Supabase
    // query builder is awaitable but has no .catch, so this needs try/catch.)
    try {
      const lastPath = sealPath(companyId);
      await uploadBytes(lastPath, lastSeal.pngBytes, 'image/png', true);
      const { error } = await supabaseProgress.rpc('document_save_last_seal', {
        p_company_id: companyId,
        p_storage_path: lastPath,
        ...documentAuthArgs(),
      });
      if (error) console.warn('[documentEndorsement] could not remember the last seal:', error);
    } catch (e) {
      console.warn('[documentEndorsement] could not remember the last seal:', e);
    }
  }

  if (artifact.storagePath !== storagePath && artifact.storagePath.includes('/endorsed-')) {
    supabaseProgress.storage.from(ARTIFACT_BUCKET).remove([artifact.storagePath]).catch(() => {});
  }

  return {
    url: await signedUrl(storagePath),
    storagePath,
    pageCount: stamped.pageCount,
    endorsements: rows,
    endorsement: rows[rows.length - 1] ?? null,
  };
}

export async function saveEndorsement({
  kind,
  documentId,
  mode,
  imageBlob,
  xPct,
  yPct,
  scale,
  pageIndex,
  signerName,
  companyId,
} = {}) {
  return saveEndorsements({
    kind,
    documentId,
    companyId,
    items: [{ mode, imageBlob, xPct, yPct, scale, pageIndex, signerName }],
  });
}

export async function listEndorsements({ kind, documentId } = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) return [];
  const { data, error } = await supabaseProgress.rpc('document_list_endorsements', {
    p_kind: docKind,
    p_document_id: documentId,
    ...documentAuthArgs(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not load signatures'));
  if (Array.isArray(data)) return data;
  const rows = unwrap(data);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Remove signatures / seals from a document, then rebuild the stored PDF from the
 * current HTML with only the marks that remain. Without the rebuild the removed
 * mark would still be printed on the stored file.
 */
export async function removeEndorsements({ kind, documentId, ids = [], buildPdfBlob } = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) throw new Error('Document is required');
  const list = [...new Set((ids || []).filter(Boolean))];
  for (const id of list) {
    const { data, error } = await supabaseProgress.rpc('document_delete_endorsement', {
      p_kind: docKind,
      p_document_id: documentId,
      p_endorsement_id: id,
      ...documentAuthArgs(),
    });
    if (error) {
      if (isMissingRpcError(error)) {
        throw new Error('Apply migration 0069_claim_pc_no_site_options_endorsement_fixes.sql in the Supabase SQL editor so signatures can be removed.');
      }
      throw new Error(friendlyDbError(error, 'Could not remove that signature'));
    }
    // Best effort: Admin's session can remove the image file; the SQL also tries.
    if (data) supabaseProgress.storage.from(ARTIFACT_BUCKET).remove([data]).catch(() => {});
  }
  if (typeof buildPdfBlob === 'function') {
    return replaceDocumentArtifact({ kind: docKind, documentId, buildPdfBlob });
  }
  return null;
}

export async function getLastCompanySeal(companyId) {
  if (!companyId) return null;
  const { data, error } = await supabaseProgress.rpc('document_get_last_seal', {
    p_company_id: companyId,
    ...documentAuthArgs(),
  });
  if (error) throw new Error(friendlyDbError(error, 'Could not load the last company seal'));
  const row = unwrap(data);
  if (!row?.storagePath) return null;
  return {
    url: await signedUrl(row.storagePath),
    storagePath: row.storagePath,
  };
}

async function blobFromBuilder(buildPdfBlob, fallbackMessage) {
  if (typeof buildPdfBlob !== 'function') throw new Error(fallbackMessage);
  const blob = await buildPdfBlob();
  if (!blob) throw new Error(fallbackMessage);
  return blob;
}

/** True when the document changed (status, client figures…) after its stored PDF was made. */
function artifactIsStale(artifact, sourceUpdatedAt) {
  if (!artifact?.updatedAt || !sourceUpdatedAt) return false;
  const built = new Date(artifact.updatedAt).getTime();
  const changed = new Date(sourceUpdatedAt).getTime();
  return Number.isFinite(built) && Number.isFinite(changed) && changed > built;
}

/**
 * One original per document for every portal.
 * Returns the stored PDF when it exists. Builds and stores only when missing
 * (first create, or after an explicit content clear).
 *
 * Optional `layoutChangedAt`: when the stored file is older than this layout
 * stamp, rebuild from current HTML. Unsigned docs always rebuild. Stamped docs
 * rebuild only when `rebuildStampedOnLayoutChange` is true (signatures/seals
 * are burned back on). Use that for claim layout fixes; leave it false for JSR
 * so a huge stamped original is not replaced just to recompress photos.
 *
 * `sourceUpdatedAt` alone does not trigger a silent rebuild.
 */
export async function getCanonicalPdfBlob({
  kind,
  documentId,
  buildPdfBlob,
  sourceUpdatedAt,
  layoutChangedAt = null,
  rebuildStampedOnLayoutChange = false,
} = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) {
    return blobFromBuilder(buildPdfBlob, 'Could not build the PDF for this document');
  }
  if (sourceUpdatedAt) {
    try {
      const existing = await getDocumentArtifact({ kind: docKind, documentId });
      if (artifactIsStale(existing, sourceUpdatedAt)) {
        console.info(
          '[documentEndorsement] stored PDF is older than the record; keeping stamped original until content clear'
        );
      }
    } catch {
      /* ignore */
    }
  }
  const artifact = await ensureDocumentArtifact({
    kind: docKind,
    documentId,
    buildPdfBlob,
    layoutChangedAt,
    rebuildStampedOnLayoutChange,
  });
  const bytes = await downloadBytes(artifact.storagePath);
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Generate from HTML and print/save that blob without reading current.pdf.
 * Prefer useCanonicalPdf / getCanonicalPdfBlob so signatures stay on one original.
 */
export async function exportGeneratedPdf({
  kind,
  documentId,
  buildPdfBlob,
  print = false,
  fileName = 'document.pdf',
} = {}) {
  const docKind = commercialDocumentKind(kind);
  const blob = await blobFromBuilder(buildPdfBlob, 'Could not build the PDF');
  if (docKind && documentId) {
    recordDocumentEventSafe({
      kind: docKind,
      documentId,
      action: 'exported',
      summary: print ? 'Opened a generated PDF' : 'Downloaded a generated PDF',
    });
  }
  if (print) {
    const { printPdfBlob } = await import('@/modules/progress/lib/pdf');
    return printPdfBlob(blob, fileName);
  }
  return savePdfBlob(blob, fileName);
}

/**
 * Package / JSR / claim / invoice: everyone opens the same stored artifact.
 * First download (or after content clear) creates it; later downloads and
 * endorsements stamp that file so signatures show everywhere.
 */
export async function useCanonicalPdf({
  kind,
  documentId,
  buildPdfBlob,
  print = false,
  fileName = 'document.pdf',
  sourceUpdatedAt = null,
  layoutChangedAt = null,
  rebuildStampedOnLayoutChange = false,
} = {}) {
  const docKind = commercialDocumentKind(kind);
  const blob = await getCanonicalPdfBlob({
    kind: docKind,
    documentId,
    buildPdfBlob,
    sourceUpdatedAt,
    layoutChangedAt,
    rebuildStampedOnLayoutChange,
  });
  recordDocumentEventSafe({
    kind: docKind,
    documentId,
    action: 'exported',
    summary: print ? 'Opened the stored PDF' : 'Downloaded the stored PDF',
  });
  if (print) {
    const { printPdfBlob } = await import('@/modules/progress/lib/pdf');
    return printPdfBlob(blob, fileName);
  }
  return savePdfBlob(blob, fileName);
}

/**
 * Drop the stored PDF so the next print/download rebuilds from current HTML.
 * Endorsement image rows stay; they are burned back onto the new file on first stamp/download.
 */
export async function clearDocumentArtifact({ kind, documentId } = {}) {
  const docKind = commercialDocumentKind(kind);
  if (!docKind || !documentId) return false;
  const { error } = await supabaseProgress.rpc('document_clear_artifact', {
    p_kind: docKind,
    p_document_id: documentId,
    ...documentAuthArgs(),
  });
  if (error) {
    if (isMissingRpcError(error)) return false;
    throw new Error(friendlyDbError(error, 'Could not clear the stored document'));
  }
  artifactEnsureJobs.delete(`${docKind}:${documentId}`);
  recordDocumentEventSafe({
    kind: docKind,
    documentId,
    action: 'artifact_cleared',
    summary: 'Stored PDF cleared after content edit',
  });
  return true;
}

export async function blobFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load that image');
  return res.blob();
}
