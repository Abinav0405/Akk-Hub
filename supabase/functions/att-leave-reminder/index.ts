// Leave reminder Edge Function — push workers whose approved leave starts tomorrow.
// Deploy: npm run supabase:functions:deploy:leave-reminder
// Schedule daily (e.g. 00:00 UTC ≈ 08:00 SGT) via Supabase Cron / pg_cron calling this URL
// with header x-akk-fcm-secret or x-akk-leave-reminder-secret.

import { jsonResponse, getCorsHeaders } from '../_att/cors.ts';
import { sendFcmToMany } from '../_att/fcm.ts';
import { getServiceClient } from '../_att/supabaseAdmin.ts';

function tomorrowSgtYmd(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // "Tomorrow" in SGT: take today's SGT date parts and add 1 calendar day carefully
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = todayParts.split('-').map(Number);
  const utcNoon = Date.UTC(y, m - 1, d, 4, 0, 0); // approx SGT noon as UTC
  const tomorrow = new Date(utcNoon + 24 * 3600 * 1000);
  return fmt.format(tomorrow);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const secret = Deno.env.get('LEAVE_REMINDER_SECRET') || Deno.env.get('FCM_WEBHOOK_SECRET');
    const header = req.headers.get('x-akk-leave-reminder-secret') || req.headers.get('x-akk-fcm-secret') || '';
    if (secret && header !== secret) {
      return jsonResponse({ error: 'unauthorized' }, 401, req);
    }

    const supabase = getServiceClient('attendance');
    const tomorrow = tomorrowSgtYmd();

    const { data: leaves, error } = await supabase
      .from('leave_requests')
      .select('id, employee_id, leave_type, from_date, to_date, leave_duration, reminder_sent_at')
      .eq('status', 'approved')
      .eq('from_date', tomorrow)
      .is('reminder_sent_at', null);

    if (error) throw error;

    let sent = 0;
    for (const leave of leaves || []) {
      const { data: tokens } = await supabase
        .from('device_push_tokens')
        .select('fcm_token')
        .eq('worker_id', leave.employee_id);

      const list = (tokens || []).map((t: { fcm_token: string }) => t.fcm_token).filter(Boolean);
      if (list.length) {
        await sendFcmToMany(list, {
          title: 'Leave reminder',
          body: `You are on ${leave.leave_type || 'leave'} tomorrow (${leave.from_date}).`,
          path: '/timesheet/leave/history',
        });
        sent += list.length;
      }

      await supabase
        .from('leave_requests')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', leave.id);
    }

    return jsonResponse({ ok: true, tomorrow, leaves: (leaves || []).length, pushes: sent }, 200, req);
  } catch (err) {
    return jsonResponse({ error: String((err as Error)?.message || err) }, 500, req);
  }
});
