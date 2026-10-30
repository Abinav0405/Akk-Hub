import { jsonResponse } from '../_prg/cors.ts';
import { sendFcmToMany, loadServiceAccount, type FcmPayload } from '../_prg/fcm.ts';
import { timingSafeEqualString } from '../_prg/secureCompare.ts';
import { getServiceClient } from '../_prg/supabaseAdmin.ts';

/**
 * FCM Database Webhook Edge Function — notifies staff of new/updated
 * submissions, and notifies the employee/technician when their package is approved/declined.
 *
 * Auth: shared header secret `x-spt-fcm-secret` must match server env
 * `FCM_WEBHOOK_SECRET`. Configure this as a Supabase Database Webhook
 * (Database > Webhooks) on the `packages` table for INSERT and UPDATE,
 * pointing at this function's URL with that header set.
 *
 * JWT verification must be OFF for this function (`--no-verify-jwt` on
 * deploy) since Database Webhooks call it without a user JWT.
 */

type DbWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
};

const ALLOWED_TABLES = new Set(['packages']);
const ALLOWED_TYPES = new Set(['INSERT', 'UPDATE']);

function checkWebhookSecret(req: Request): string | null {
  const expected = Deno.env.get('FCM_WEBHOOK_SECRET');
  if (!expected) return 'FCM_WEBHOOK_SECRET is not configured on the server';
  const provided = req.headers.get('x-spt-fcm-secret') ?? '';
  if (!provided || !timingSafeEqualString(provided, expected)) {
    return 'Unauthorized';
  }
  return null;
}

function validateWebhookPayload(payload: DbWebhookPayload): string | null {
  const table = String(payload.table || '');
  const type = String(payload.type || '');
  if (!table || !ALLOWED_TABLES.has(table)) {
    return `Unsupported or missing table (allowed: ${[...ALLOWED_TABLES].join(', ')})`;
  }
  if (!type || !ALLOWED_TYPES.has(type)) {
    return 'Unsupported or missing type (INSERT|UPDATE)';
  }
  if (!payload.record || typeof payload.record !== 'object') {
    return 'record object is required';
  }
  return null;
}

async function tokensForRole(
  supabase: ReturnType<typeof getServiceClient>,
  role: 'worker' | 'admin' | 'manager',
  userId?: string
) {
  let query = supabase.from('device_tokens').select('fcm_token').eq('user_role', role);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((r) => r.fcm_token as string);
}

async function workerDisplayName(supabase: ReturnType<typeof getServiceClient>, workerId: string) {
  if (!workerId) return null;
  const { data } = await supabase.from('app_users').select('display_name').eq('id', workerId).maybeSingle();
  return data?.display_name || null;
}

async function resolveNotifications(
  supabase: ReturnType<typeof getServiceClient>,
  payload: DbWebhookPayload
): Promise<Array<{ tokens: string[]; message: FcmPayload }>> {
  const type = payload.type || '';
  const record = payload.record || {};
  const old = payload.old_record || {};
  const out: Array<{ tokens: string[]; message: FcmPayload }> = [];

  const workerId = String(record.worker_id || '');
  // Taps open this package itself (AKK Hub reads ?package=).
  const pkg = record.id ? `?package=${encodeURIComponent(String(record.id))}` : '';
  const adminPath = `/progress/admin${pkg}`;
  const managerPath = `/progress/review${pkg}`;
  const workerPath = `/progress/submissions${pkg}`;

  if (type === 'INSERT') {
    const name = await workerDisplayName(supabase, workerId);
    const body = name ? `${name} submitted a new site progress package.` : 'A new site progress package was submitted.';
    const [adminTokens, managerTokens] = await Promise.all([
      tokensForRole(supabase, 'admin'),
      tokensForRole(supabase, 'manager'),
    ]);
    out.push({
      tokens: adminTokens,
      message: { title: 'New submission', body, path: adminPath },
    });
    out.push({
      tokens: managerTokens,
      message: { title: 'New submission', body, path: managerPath },
    });
    return out;
  }

  // UPDATE
  const oldStatus = String(old.approval_status || '');
  const newStatus = String(record.approval_status || '');
  if (oldStatus !== newStatus) {
    let workerMsg: FcmPayload | null = null;
    if (newStatus === 'approved') {
      workerMsg = { title: 'Package approved', body: 'Your site progress submission was approved.', path: workerPath };
    } else if (newStatus === 'declined') {
      const reason = String(record.decline_reason || '').trim();
      workerMsg = {
        title: 'Package declined',
        body: reason ? `Declined: ${reason}` : 'Your submission was declined — check for details.',
        path: workerPath,
      };
    }
    if (workerMsg && workerId) {
      const tokens = await tokensForRole(supabase, 'worker', workerId);
      out.push({ tokens, message: workerMsg });
    }
  }

  const stageAdded =
    (!old.has_during && record.has_during) || (!old.has_after && record.has_after);
  if (stageAdded) {
    const name = await workerDisplayName(supabase, workerId);
    const body = name ? `${name} added more photos to a package.` : 'An employee/technician added more photos to a package.';
    const [adminTokens, managerTokens] = await Promise.all([
      tokensForRole(supabase, 'admin'),
      tokensForRole(supabase, 'manager'),
    ]);
    out.push({
      tokens: adminTokens,
      message: { title: 'Submission updated', body, path: adminPath },
    });
    out.push({
      tokens: managerTokens,
      message: { title: 'Submission updated', body, path: managerPath },
    });
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authError = checkWebhookSecret(req);
  if (authError) {
    return jsonResponse({ error: authError }, 401);
  }

  let payload: DbWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const shapeError = validateWebhookPayload(payload);
  if (shapeError) {
    return jsonResponse({ error: shapeError }, 400);
  }

  try {
    const supabase = getServiceClient('progress');
    const jobs = await resolveNotifications(supabase, payload);

    let totalSent = 0;
    let totalFailed = 0;
    const failureSamples: Array<{ tokenPrefix: string; error: string; stale: boolean }> = [];
    const staleTokens = new Set<string>();
    let projectId: string | null = null;
    try {
      projectId = loadServiceAccount().project_id;
    } catch (error) {
      console.warn('fcm-db-webhook FCM not configured — in-app notifications still apply', error);
      return jsonResponse({
        ok: true,
        skipped: 'FCM_SERVICE_ACCOUNT_JSON is not configured',
        jobs: jobs.length,
      });
    }

    for (const job of jobs) {
      if (!job.tokens.length) continue;
      const result = await sendFcmToMany(job.tokens, job.message);
      totalSent += result.sent;
      totalFailed += result.failed;
      for (const failure of result.failures.slice(0, 5)) failureSamples.push(failure);
      for (const token of result.staleTokens) staleTokens.add(token);
    }

    if (staleTokens.size) {
      const { error: pruneError } = await supabase.from('device_tokens').delete().in('fcm_token', [...staleTokens]);
      if (pruneError) console.error('fcm-db-webhook prune stale tokens', pruneError);
    }

    return jsonResponse({
      ok: true,
      jobs: jobs.length,
      sent: totalSent,
      failed: totalFailed,
      pruned: staleTokens.size,
      projectId,
      failures: failureSamples,
    });
  } catch (error) {
    console.error('fcm-db-webhook error', error);
    return jsonResponse({ error: String(error) }, 500);
  }
});
