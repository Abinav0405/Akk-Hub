import { supabaseTimesheet } from '@/core/supabase'
import { shareHtmlAsPdf } from '@/modules/timesheet/lib/pdfDownload';
import { printHtmlDocument } from '@/modules/timesheet/lib/printHtmlDocument';
import { isNativeApp } from '@/core/platform';
import { ALL_FORM_KEYS, getFormDefinition } from './catalog';
import { evaluateFormFlags } from './flagging';
import { DEFAULT_RECOMMENDED_RESULTS, SUBMISSION_STATUS } from './constants';
import {
    buildCompanyFormDocumentHtml,
    mergeCompanyFormDocuments,
    snapshotDefinition,
} from './document';
import {
    buildQuestionsOverrideFromDefinition,
    mergeDefinitionWithOverride,
    resolveFormDefinition,
} from './mergeDefinition';

const SUBMISSION_LIST_COLUMNS =
    'id, form_key, department, worker_id, worker_type, worker_name, status, is_flagged, flag_reasons, payload, reviewed_by, reviewed_by_role, reviewed_at, review_note, recommended_result, definition_snapshot, created_at, updated_at';

function missingColumn(error, column) {
    return new RegExp(column, 'i').test(String(error?.message || ''));
}

async function selectSubmissionList(applyFilters) {
    const run = (columns) => applyFilters(supabaseTimesheet.from('company_form_submissions').select(columns));
    let columns = SUBMISSION_LIST_COLUMNS;
    let { data, error } = await run(columns);
    if (error && missingColumn(error, 'definition_snapshot')) {
        columns = columns.replace(', definition_snapshot', '');
        ({ data, error } = await run(columns));
    }
    if (error && missingColumn(error, 'recommended_result')) {
        columns = columns.replace(', recommended_result', '');
        ({ data, error } = await run(columns));
    }
    if (error) throw error;
    return data || [];
}

async function fetchModuleRows() {
    const { data, error } = await supabaseTimesheet
        .from('company_form_modules')
        .select('form_key, enabled, updated_at, questions_override')
        .order('form_key');
    if (error) throw error;
    return data || [];
}

export async function listFormModules() {
    let rows = [];
    try {
        rows = await fetchModuleRows();
    } catch (e) {
        // Older DB without questions_override column — retry without it.
        const msg = String(e?.message || '');
        if (/questions_override/i.test(msg)) {
            const { data, error } = await supabaseTimesheet
                .from('company_form_modules')
                .select('form_key, enabled, updated_at')
                .order('form_key');
            if (error) throw error;
            rows = (data || []).map((r) => ({ ...r, questions_override: {} }));
        } else {
            throw e;
        }
    }

    const byKey = new Map(rows.map((r) => [r.form_key, r]));
    return ALL_FORM_KEYS.map((form_key) => {
        const row = byKey.get(form_key);
        const questions_override = row?.questions_override || {};
        return {
            form_key,
            enabled: row ? Boolean(row.enabled) : true,
            updated_at: row?.updated_at || null,
            questions_override,
            definition: resolveFormDefinition(form_key, questions_override),
        };
    });
}

export async function getResolvedFormDefinition(formKey) {
    const base = getFormDefinition(formKey);
    if (!base) return null;

    const { data, error } = await supabaseTimesheet
        .from('company_form_modules')
        .select('questions_override, enabled')
        .eq('form_key', formKey)
        .maybeSingle();

    if (error) {
        if (/questions_override/i.test(String(error.message || ''))) {
            return { ...base, enabled: true };
        }
        throw error;
    }

    const merged = mergeDefinitionWithOverride(base, data?.questions_override || {});
    return { ...merged, enabled: data ? Boolean(data.enabled) : true };
}

export async function listEnabledFormKeys() {
    const modules = await listFormModules();
    return modules.filter((m) => m.enabled).map((m) => m.form_key);
}

export async function setFormModuleEnabled(formKey, enabled) {
    const { data: existing } = await supabaseTimesheet
        .from('company_form_modules')
        .select('questions_override')
        .eq('form_key', formKey)
        .maybeSingle();

    const { data, error } = await supabaseTimesheet
        .from('company_form_modules')
        .upsert(
            {
                form_key: formKey,
                enabled: Boolean(enabled),
                questions_override: existing?.questions_override || {},
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'form_key' }
        )
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function upsertModuleQuestions(formKey, questionsOverride) {
    if (!getFormDefinition(formKey)) throw new Error('Unknown form');

    const { data: existing } = await supabaseTimesheet
        .from('company_form_modules')
        .select('enabled')
        .eq('form_key', formKey)
        .maybeSingle();

    const { data, error } = await supabaseTimesheet
        .from('company_form_modules')
        .upsert(
            {
                form_key: formKey,
                enabled: existing ? Boolean(existing.enabled) : true,
                questions_override: questionsOverride || {},
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'form_key' }
        )
        .select()
        .single();
    if (error) throw error;
    return data;
}

/** Save edited question labels from a full (merged) form definition. */
export async function saveFormQuestions(formKey, definition) {
    return upsertModuleQuestions(formKey, buildQuestionsOverrideFromDefinition(definition));
}

/** Clear custom labels and restore stock catalog text. */
export async function resetFormQuestions(formKey) {
    return upsertModuleQuestions(formKey, {});
}

export async function submitCompanyForm({
    formKey,
    workerId,
    workerType,
    workerName,
    payload,
}) {
    const resolved = await getResolvedFormDefinition(formKey);
    if (!resolved) throw new Error('Unknown form');
    if (resolved.enabled === false) {
        throw new Error('This form is disabled by admin.');
    }

    const { is_flagged, flag_reasons } = evaluateFormFlags(formKey, payload);
    const now = new Date().toISOString();
    const definition_snapshot = snapshotDefinition(resolved);

    const row = {
        id: crypto.randomUUID(),
        form_key: formKey,
        department: resolved.department,
        worker_id: workerId,
        worker_type: workerType === 'local' ? 'local' : 'foreign',
        worker_name: workerName || workerId,
        status: SUBMISSION_STATUS.PENDING,
        is_flagged,
        flag_reasons,
        payload,
        reviewed_by: null,
        reviewed_by_role: null,
        reviewed_at: null,
        review_note: null,
        definition_snapshot,
        created_at: now,
        updated_at: now,
    };
    row.document_html = buildCompanyFormDocumentHtml({
        submission: row,
        definition: definition_snapshot,
    });

    let { data, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .insert([row])
        .select()
        .single();

    if (error && (missingColumn(error, 'document_html') || missingColumn(error, 'definition_snapshot'))) {
        const legacy = { ...row };
        delete legacy.document_html;
        delete legacy.definition_snapshot;
        ({ data, error } = await supabaseTimesheet
            .from('company_form_submissions')
            .insert([legacy])
            .select()
            .single());
    }
    if (error) throw error;
    return data;
}

export async function listWorkerSubmissions(workerId, { limit = 50 } = {}) {
    return selectSubmissionList((query) =>
        query.eq('worker_id', workerId).order('created_at', { ascending: false }).limit(limit)
    );
}

export async function getSubmission(id) {
    const { data, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Review queue for manager/admin.
 * Flagged + pending first, then other pending, then history.
 */
export async function listReviewSubmissions({
    status = 'all',
    limit = 100,
} = {}) {
    const rows = await selectSubmissionList((query) => {
        let next = query
            .order('is_flagged', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(limit);
        if (status && status !== 'all') next = next.eq('status', status);
        return next;
    });
    return rows.sort((a, b) => {
        const ap = a.status === 'pending' ? 0 : 1;
        const bp = b.status === 'pending' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        if (Boolean(b.is_flagged) !== Boolean(a.is_flagged)) {
            return Number(b.is_flagged) - Number(a.is_flagged);
        }
        return new Date(b.created_at) - new Date(a.created_at);
    });
}

export async function getRecommendedResultOptions() {
    try {
        const { data, error } = await supabaseTimesheet
            .from('company_form_settings')
            .select('recommended_results')
            .eq('id', 1)
            .maybeSingle();
        if (error) throw error;
        const list = (data?.recommended_results || []).map((s) => String(s).trim()).filter(Boolean);
        return list.length ? list : [...DEFAULT_RECOMMENDED_RESULTS];
    } catch (e) {
        console.warn('getRecommendedResultOptions fallback', e);
        return [...DEFAULT_RECOMMENDED_RESULTS];
    }
}

export async function saveRecommendedResultOptions(options) {
    const cleaned = (options || [])
        .map((s) => String(s).trim())
        .filter(Boolean);
    if (!cleaned.length) {
        throw new Error('Add at least one recommended result option.');
    }

    const { data, error } = await supabaseTimesheet
        .from('company_form_settings')
        .upsert(
            {
                id: 1,
                recommended_results: cleaned,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
        )
        .select()
        .single();
    if (error) throw error;
    return data;
}

/**
 * Manager/admin correction of a submitted form while it is still pending approval.
 * Re-evaluates flags and rebuilds the stored document. Locked once approved/rejected.
 */
export async function updatePendingSubmission({ id, payload }) {
    if (!id) throw new Error('Missing submission id');
    if (!payload || typeof payload !== 'object') {
        throw new Error('Missing form payload');
    }

    const existing = await getSubmission(id);
    if (!existing) throw new Error('Could not update submission.');
    if (existing.status !== SUBMISSION_STATUS.PENDING) {
        throw new Error('Only pending forms can be edited before approval.');
    }

    const { is_flagged, flag_reasons } = evaluateFormFlags(existing.form_key, payload);
    const updatedAt = new Date().toISOString();

    let definition = existing.definition_snapshot;
    if (!definition) {
        definition =
            (await getResolvedFormDefinition(existing.form_key)) ||
            getFormDefinition(existing.form_key);
    }
    if (!definition) throw new Error('Unknown form');

    const next = {
        ...existing,
        payload,
        is_flagged,
        flag_reasons,
        updated_at: updatedAt,
    };

    const patch = {
        payload,
        is_flagged,
        flag_reasons,
        updated_at: updatedAt,
        document_html: buildCompanyFormDocumentHtml({ submission: next, definition }),
        definition_snapshot: snapshotDefinition(definition),
    };

    let { data, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .update(patch)
        .eq('id', id)
        .eq('status', SUBMISSION_STATUS.PENDING)
        .select()
        .maybeSingle();

    if (error && (missingColumn(error, 'document_html') || missingColumn(error, 'definition_snapshot'))) {
        const legacy = { ...patch };
        delete legacy.document_html;
        delete legacy.definition_snapshot;
        ({ data, error } = await supabaseTimesheet
            .from('company_form_submissions')
            .update(legacy)
            .eq('id', id)
            .eq('status', SUBMISSION_STATUS.PENDING)
            .select()
            .maybeSingle());
    }

    if (error) throw error;
    if (!data) {
        const latest = await getSubmission(id);
        if (latest && latest.status !== SUBMISSION_STATUS.PENDING) {
            throw new Error('Only pending forms can be edited before approval.');
        }
        throw new Error('Could not update submission.');
    }
    return data;
}

export async function reviewSubmission({
    id,
    status,
    reviewedBy,
    reviewedByRole,
    reviewNote = null,
    recommendedResult = null,
}) {
    if (![SUBMISSION_STATUS.APPROVED, SUBMISSION_STATUS.REJECTED].includes(status)) {
        throw new Error('Invalid review status');
    }
    if (!String(recommendedResult || '').trim()) {
        throw new Error('Choose a recommended result.');
    }
    if (status === SUBMISSION_STATUS.REJECTED && !String(reviewNote || '').trim()) {
        throw new Error('A rejection reason is required');
    }

    const existing = await getSubmission(id);
    if (!existing) throw new Error('Could not update submission.');
    if (existing.status !== SUBMISSION_STATUS.PENDING) {
        throw new Error('This form was already reviewed.');
    }

    const reviewedAt = new Date().toISOString();
    const next = {
        ...existing,
        status,
        recommended_result: String(recommendedResult).trim(),
        reviewed_by: reviewedBy,
        reviewed_by_role: reviewedByRole,
        reviewed_at: reviewedAt,
        review_note: reviewNote ? String(reviewNote).trim() : null,
        updated_at: reviewedAt,
    };

    let definition = existing.definition_snapshot;
    if (!definition) {
        definition = (await getResolvedFormDefinition(existing.form_key)) || getFormDefinition(existing.form_key);
    }

    const patch = {
        status: next.status,
        recommended_result: next.recommended_result,
        reviewed_by: next.reviewed_by,
        reviewed_by_role: next.reviewed_by_role,
        reviewed_at: next.reviewed_at,
        review_note: next.review_note,
        updated_at: next.updated_at,
        document_html: buildCompanyFormDocumentHtml({ submission: next, definition }),
        definition_snapshot: snapshotDefinition(definition),
    };

    let { data, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .update(patch)
        .eq('id', id)
        .eq('status', SUBMISSION_STATUS.PENDING)
        .select()
        .maybeSingle();

    if (error && (missingColumn(error, 'document_html') || missingColumn(error, 'definition_snapshot'))) {
        const legacy = { ...patch };
        delete legacy.document_html;
        delete legacy.definition_snapshot;
        ({ data, error } = await supabaseTimesheet
            .from('company_form_submissions')
            .update(legacy)
            .eq('id', id)
            .eq('status', SUBMISSION_STATUS.PENDING)
            .select()
            .maybeSingle());
    }

    if (error) throw error;
    if (!data) {
        const latest = await getSubmission(id);
        if (latest && latest.status !== SUBMISSION_STATUS.PENDING) {
            throw new Error('This form was already reviewed.');
        }
        throw new Error('Could not update submission.');
    }
    return data;
}

export async function countPendingFlagged() {
    const { count, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('is_flagged', true);
    if (error) throw error;
    return count || 0;
}

/**
 * Return the stored original HTML. Older rows are rendered once and saved,
 * then every later print or PDF uses that same document.
 */
export async function ensureCompanyFormDocument(submission) {
    if (!submission?.id) throw new Error('Missing form');
    if (submission.document_html) return { html: submission.document_html, stored: true };

    const full = (await getSubmission(submission.id)) || submission;
    if (full.document_html) return { html: full.document_html, stored: true };

    let definition = full.definition_snapshot;
    if (!definition) {
        definition =
            (await getResolvedFormDefinition(full.form_key)) || getFormDefinition(full.form_key);
    }
    if (!definition) throw new Error('Unknown form');

    const html = buildCompanyFormDocumentHtml({ submission: full, definition });
    const patch = { document_html: html };
    if (!full.definition_snapshot) patch.definition_snapshot = snapshotDefinition(definition);

    let { error } = await supabaseTimesheet.from('company_form_submissions').update(patch).eq('id', full.id);
    if (error && missingColumn(error, 'definition_snapshot')) {
        ({ error } = await supabaseTimesheet
            .from('company_form_submissions')
            .update({ document_html: html })
            .eq('id', full.id));
    }
    if (error && missingColumn(error, 'document_html')) {
        return { html, stored: false };
    }
    if (error) throw error;
    return { html, stored: true };
}

function companyFormFileName(submissions) {
    if (submissions.length === 1) {
        const row = submissions[0];
        const title = row.definition_snapshot?.title || row.form_key || 'Company_Form';
        const safe = String(title).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 40);
        return `${safe || 'Company_Form'}_${String(row.worker_id || 'worker').slice(0, 20)}.pdf`;
    }
    return `Company_Forms_${submissions.length}.pdf`;
}

/**
 * Print or download the stored originals. `mode` is `print` or `pdf`.
 * Native app always shares a PDF because the WebView print dialog is unreliable.
 */
export async function printCompanyForms(submissions, { mode = 'print' } = {}) {
    const rows = (submissions || []).filter(Boolean);
    if (!rows.length) throw new Error('No forms to print');

    const prepared = [];
    let stored = true;
    for (const row of rows) {
        const result = await ensureCompanyFormDocument(row);
        prepared.push(result.html);
        if (!result.stored) stored = false;
    }

    const html =
        prepared.length === 1
            ? prepared[0]
            : mergeCompanyFormDocuments(prepared, `Company forms (${prepared.length})`);
    const fileName = companyFormFileName(rows);
    const usePdf = mode === 'pdf' || isNativeApp();

    if (usePdf) {
        await shareHtmlAsPdf(html, fileName);
        return { mode: 'pdf', stored };
    }

    printHtmlDocument(html, { title: 'Company forms', printDelayMs: 350 });
    return { mode: 'print', stored };
}

export async function countPending() {
    const { count, error } = await supabaseTimesheet
        .from('company_form_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
    if (error) throw error;
    return count || 0;
}
