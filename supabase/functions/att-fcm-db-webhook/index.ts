import { jsonResponse } from '../_att/cors.ts';
import { sendFcmToMany, loadServiceAccount, type FcmPayload } from '../_att/fcm.ts';
import { timingSafeEqualString } from '../_att/secureCompare.ts';
import { getServiceClient } from '../_att/supabaseAdmin.ts';

/**
 * FCM Database Webhook Edge Function
 *
 * Auth: shared header secret `x-akk-fcm-secret` must match server env `FCM_WEBHOOK_SECRET`.
 * SECURITY: Keep FCM_WEBHOOK_SECRET server-side only (Database Webhook / trigger HTTP headers).
 * Never put it in VITE_* client env vars or ship it in the app bundle.
 *
 * JWT verification stays off (`verify_jwt = false`) because Supabase Database Webhooks /
 * `supabase_functions.http_request` triggers call this function without a user JWT.
 */

type DbWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
};

/** Tables this function is contracted to handle (must match SQL webhook triggers). */
const ALLOWED_TABLES = new Set([
  'leave_requests',
  'passed_out_payslips',
  'passed_out_timesheets',
]);

const ALLOWED_TYPES = new Set(['INSERT', 'UPDATE', 'DELETE']);

function checkWebhookSecret(req: Request): string | null {
  const expected = Deno.env.get('FCM_WEBHOOK_SECRET');
  if (!expected) return 'FCM_WEBHOOK_SECRET is not configured on the server';
  const provided = req.headers.get('x-akk-fcm-secret') ?? '';
  if (!provided || !timingSafeEqualString(provided, expected)) {
    return 'Unauthorized';
  }
  return null;
}

/** Soft shape check — rejects obviously bogus payloads if the secret leaks; keeps DB webhook contract. */
function validateWebhookPayload(payload: DbWebhookPayload): string | null {
  const table = String(payload.table || '');
  const type = String(payload.type || '');
  if (!table || !ALLOWED_TABLES.has(table)) {
    return `Unsupported or missing table (allowed: ${[...ALLOWED_TABLES].join(', ')})`;
  }
  if (!type || !ALLOWED_TYPES.has(type)) {
    return 'Unsupported or missing type (INSERT|UPDATE|DELETE)';
  }
  // Existing contract: record is present for INSERT/UPDATE; old_record for UPDATE.
  if (type === 'INSERT' || type === 'UPDATE') {
    if (!payload.record || typeof payload.record !== 'object') {
      return 'record object is required for INSERT/UPDATE';
    }
  }
  return null;
}

async function tokensForWorkers(supabase: ReturnType<typeof getServiceClient>, workerIds: string[]) {
  const ids = [...new Set(workerIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('fcm_token')
    .in('worker_id', ids);
  if (error) throw error;
  return (data || []).map((r) => r.fcm_token as string);
}

async function tokensForAdmins(supabase: ReturnType<typeof getServiceClient>) {
  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('fcm_token')
    .not('admin_email', 'is', null);
  if (error) throw error;
  return (data || []).map((r) => r.fcm_token as string);
}

async function tokensForManagers(supabase: ReturnType<typeof getServiceClient>) {
  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('fcm_token')
    .not('manager_email', 'is', null);
  if (error) throw error;
  return (data || []).map((r) => r.fcm_token as string);
}

async function tokensForSupervisors(supabase: ReturnType<typeof getServiceClient>) {
  const { data, error } = await supabase
    .from('device_push_tokens')
    .select('fcm_token')
    .not('supervisor_id', 'is', null);
  if (error) throw error;
  return (data || []).map((r) => r.fcm_token as string);
}

function leaveStatusMessage(status: string, record: Record<string, unknown> = {}): FcmPayload | null {
  switch (status) {
    case 'approved':
      return { title: 'Leave approved', body: 'Your leave request was approved.', path: '/timesheet/leave/history' };
    case 'rejected': {
      const reason = String(record.rejection_reason || record.admin_notes || '').trim();
      return {
        title: 'Leave rejected',
        body: reason ? `Your leave request was rejected: ${reason}` : 'Your leave request was rejected.',
        path: '/timesheet/leave/history',
      };
    }
    case 'cancelled':
      return { title: 'Leave cancelled', body: 'Your leave request was cancelled.', path: '/timesheet/leave/history' };
    case 'pending_manager':
      return { title: 'Leave submitted', body: 'Your leave request was sent to your manager.', path: '/timesheet/leave/history' };
    case 'pending_admin':
      return { title: 'Leave forwarded', body: 'Your leave request is awaiting admin approval.', path: '/timesheet/leave/history' };
    default:
      return null;
  }
}

function timesheetStatusMessage(status: string): FcmPayload | null {
  switch (status) {
    case 'approved':
      return { title: 'Timesheet approved', body: 'Your timesheet has been approved.', path: '/timesheet/timesheets' };
    case 'rejected':
      return { title: 'Timesheet rejected', body: 'Your timesheet was rejected. Please review.', path: '/timesheet/timesheets' };
    case 'returned_to_worker':
      return { title: 'Timesheet returned', body: 'Your timesheet was returned for review.', path: '/timesheet/timesheets' };
    case 'declined_by_manager':
      return { title: 'Timesheet update', body: 'Your timesheet was declined by your manager.', path: '/timesheet/timesheets' };
    default:
      return null;
  }
}

/** Format as MM/YYYY for notification copy. */
function formatMonthYear(record: Record<string, unknown>): string | null {
  const monthRaw = record.month ?? record.payslip_month;
  const yearRaw = record.year ?? record.payslip_year;
  const monthNum = Number(monthRaw);
  const yearNum = Number(yearRaw);
  if (Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12 && Number.isFinite(yearNum) && yearNum > 0) {
    return `${String(monthNum).padStart(2, '0')}/${yearNum}`;
  }

  const candidates = [
    record.month_year,
    record.payslip_month,
    record.start_date,
    record.payslip_date,
    record.end_date,
  ];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    // Already MM/YYYY or M/YYYY
    const slash = raw.match(/^(\d{1,2})\s*[\/\-]\s*(\d{4})$/);
    if (slash) {
      const m = Number(slash[1]);
      const y = Number(slash[2]);
      if (m >= 1 && m <= 12 && y > 0) return `${String(m).padStart(2, '0')}/${y}`;
    }
    // YYYY-MM or YYYY-MM-DD
    const iso = raw.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
    if (iso) {
      const y = Number(iso[1]);
      const m = Number(iso[2]);
      if (m >= 1 && m <= 12 && y > 0) return `${String(m).padStart(2, '0')}/${y}`;
    }
  }
  return null;
}

async function resolveNotifications(
  supabase: ReturnType<typeof getServiceClient>,
  payload: DbWebhookPayload,
): Promise<Array<{ tokens: string[]; message: FcmPayload }>> {
  const type = payload.type || '';
  const table = payload.table || '';
  const record = payload.record || {};
  const old = payload.old_record || {};
  const out: Array<{ tokens: string[]; message: FcmPayload }> = [];

  if (table === 'leave_requests') {
    const employeeId = String(record.employee_id || '');
    const status = String(record.status || '');

    if (type === 'INSERT') {
      if (status === 'pending_admin') {
        const tokens = await tokensForAdmins(supabase);
        out.push({
          tokens,
          message: {
            title: 'New leave request',
            body: `Worker ${employeeId} submitted leave for admin approval.`,
            path: '/timesheet/admin?section=leaves',
          },
        });
      } else if (status === 'pending_manager') {
        const [managerTokens, supervisorTokens] = await Promise.all([
          tokensForManagers(supabase),
          tokensForSupervisors(supabase),
        ]);
        out.push({
          tokens: managerTokens,
          message: {
            title: 'Leave awaiting manager',
            body: `Worker ${employeeId} submitted a leave request.`,
            path: '/timesheet/manage?section=leaves',
          },
        });
        out.push({
          tokens: supervisorTokens,
          message: {
            title: 'Leave submitted on site',
            body: `Worker ${employeeId} submitted a leave request.`,
            path: '/timesheet/site-shifts',
          },
        });
      }
    }

    if (type === 'UPDATE' && employeeId) {
      const oldStatus = String(old.status || '');
      const newStatus = String(record.status || '');
      if (oldStatus !== newStatus) {
        const workerMsg = leaveStatusMessage(newStatus, record);
        if (workerMsg) {
          const tokens = await tokensForWorkers(supabase, [employeeId]);
          out.push({ tokens, message: workerMsg });
        }
        if (newStatus === 'pending_admin' && oldStatus === 'pending_manager') {
          const tokens = await tokensForAdmins(supabase);
          out.push({
            tokens,
            message: {
              title: 'Leave forwarded to admin',
              body: `Manager approved leave for worker ${employeeId}.`,
              path: '/timesheet/admin?section=leaves',
            },
          });
        }
      }
    }
  }

  if (table === 'passed_out_payslips' && type === 'INSERT') {
    const workerId = String(record.worker_id || '');
    const monthYear = formatMonthYear(record);
    const tokens = await tokensForWorkers(supabase, [workerId]);
    out.push({
      tokens,
      message: {
        title: 'Payslip ready',
        body: monthYear
          ? `Your payslip of ${monthYear} is ready`
          : 'Your payslip is ready',
        path: '/me?open=payslips',
      },
    });
  }

  if (table === 'passed_out_timesheets') {
    const workerId = String(record.worker_id || '');
    if (type === 'INSERT') {
      const monthYear = formatMonthYear(record);
      const tokens = await tokensForWorkers(supabase, [workerId]);
      out.push({
        tokens,
        message: {
          title: 'Timesheet issued',
          body: monthYear
            ? `Your timesheet for ${monthYear} is ready for your review`
            : 'Your timesheet is ready for your review',
          path: '/timesheet/timesheets',
        },
      });
    }

    if (type === 'UPDATE') {
      const oldStatus = String(old.status || '');
      const newStatus = String(record.status || '');
      if (oldStatus !== newStatus) {
        const workerMsg = timesheetStatusMessage(newStatus);
        if (workerMsg && workerId) {
          const tokens = await tokensForWorkers(supabase, [workerId]);
          out.push({ tokens, message: workerMsg });
        }

        if (newStatus === 'awaiting_admin') {
          const tokens = await tokensForAdmins(supabase);
          out.push({
            tokens,
            message: {
              title: 'Timesheet awaiting admin',
              body: `Worker ${workerId} timesheet needs admin approval.`,
              path: '/timesheet/admin?section=timesheet-report',
            },
          });
        }

        if (newStatus === 'awaiting_manager' || (type === 'INSERT' && newStatus === 'awaiting_manager')) {
          const [managerTokens, supervisorTokens] = await Promise.all([
            tokensForManagers(supabase),
            tokensForSupervisors(supabase),
          ]);
          out.push({
            tokens: managerTokens,
            message: {
              title: 'Timesheet awaiting manager',
              body: `Worker ${workerId} submitted a timesheet for approval.`,
              path: '/timesheet/manage/timesheets',
            },
          });
          out.push({
            tokens: supervisorTokens,
            message: {
              title: 'Timesheet submitted on site',
              body: `Worker ${workerId} submitted a timesheet for approval.`,
              path: '/timesheet/site-shifts',
            },
          });
        }
      }
    }
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
    const supabase = getServiceClient('attendance');
    const jobs = await resolveNotifications(supabase, payload);
    let totalSent = 0;
    let totalFailed = 0;
    const failureSamples: Array<{ tokenPrefix: string; error: string; stale: boolean }> = [];
    const staleTokens = new Set<string>();
    let projectId: string | null = null;
    try {
      projectId = loadServiceAccount().project_id;
    } catch (error) {
      console.error('fcm-db-webhook service account', error);
      return jsonResponse({ error: String(error), step: 'loadServiceAccount' }, 500);
    }

    for (const job of jobs) {
      if (!job.tokens.length) continue;
      const result = await sendFcmToMany(job.tokens, job.message);
      totalSent += result.sent;
      totalFailed += result.failed;
      for (const failure of result.failures.slice(0, 5)) {
        failureSamples.push(failure);
      }
      for (const token of result.staleTokens) staleTokens.add(token);
    }

    if (staleTokens.size) {
      const { error: pruneError } = await supabase
        .from('device_push_tokens')
        .delete()
        .in('fcm_token', [...staleTokens]);
      if (pruneError) {
        console.error('fcm-db-webhook prune stale tokens', pruneError);
      }
    }

    if (totalFailed > 0) {
      console.error('fcm-db-webhook send failures', {
        projectId,
        failed: totalFailed,
        sent: totalSent,
        samples: failureSamples,
      });
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
