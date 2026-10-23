// Document expiry reminder — push workers whose safety certificate, work permit,
// or ID card is within 30 days of expiry (or already expired).
// Deploy: supabase functions deploy att-expiry-reminder --no-verify-jwt
// Schedule daily (e.g. 00:00 UTC ≈ 08:00 SGT) via Supabase Cron / pg_cron calling this URL
// with header x-akk-fcm-secret or x-akk-expiry-reminder-secret.
// Durable flags live in core.expiry_notifications (same idea as leave_requests.reminder_sent_at).

import { jsonResponse, getCorsHeaders } from '../_att/cors.ts';
import { getServiceClient } from '../_att/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const secret = Deno.env.get('EXPIRY_REMINDER_SECRET') || Deno.env.get('FCM_WEBHOOK_SECRET');
    const header =
      req.headers.get('x-akk-expiry-reminder-secret') ||
      req.headers.get('x-akk-fcm-secret') ||
      '';
    if (secret && header !== secret) {
      return jsonResponse({ error: 'unauthorized' }, 401, req);
    }

    const supabase = getServiceClient('core');
    const { data, error } = await supabase.rpc('run_expiry_reminders');
    if (error) throw error;

    return jsonResponse({ ok: true, ...(data && typeof data === 'object' ? data : { result: data }) }, 200, req);
  } catch (err) {
    return jsonResponse({ error: String((err as Error)?.message || err) }, 500, req);
  }
});
