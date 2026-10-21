/**
 * fcm-db-webhook
 *
 * Supabase Database Webhook → FCM HTTP v1.
 * Auth: header x-mt-fcm-secret === FCM_WEBHOOK_SECRET (timing-safe).
 * verify_jwt = false (webhooks have no user JWT).
 *
 * Events handled:
 * - transactions INSERT (pending) → notify all admin tokens
 * - transactions UPDATE (approved/declined) → notify that worker_id
 * - materials_catalog UPDATE (qty entered low stock ≤5) → notify admins
 *
 * Deploy: supabase functions deploy fcm-db-webhook --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-mt-fcm-secret',
};

const LOW_STOCK = 5;

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else {
    bytes = data;
  }
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    raw.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth token failed: ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

async function sendFcm(
  sa: ServiceAccount,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  dataPath: string,
) {
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: {
          path: dataPath,
          title,
          body,
        },
        android: {
          priority: 'HIGH',
          notification: {
            sound: 'default',
          },
        },
      },
    }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function parseServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT_JSON not set');
  const sa = JSON.parse(raw);
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error('Invalid service account JSON');
  }
  // Private keys in env often have literal \n
  sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
  return sa;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const secret = Deno.env.get('FCM_WEBHOOK_SECRET') || '';
    const provided = req.headers.get('x-mt-fcm-secret') || '';
    if (!secret || !timingSafeEqual(provided, secret)) {
      return json(401, { error: 'Unauthorized' });
    }

    const payload = await req.json().catch(() => null);
    if (!payload) return json(400, { error: 'Invalid JSON' });

    // Supabase Database Webhooks shape: { type, table, record, old_record, schema }
    const table = String(payload.table || payload.table_name || '');
    const type = String(payload.type || payload.eventType || '').toUpperCase();
    const record = payload.record || payload.new || payload.row || null;
    const oldRecord = payload.old_record || payload.old || null;

    if (!table || !record) {
      return json(200, { ok: true, skipped: 'no table/record' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(supabaseUrl, serviceKey, { db: { schema: 'materials' } });

    type Target =
      | { kind: 'staff'; title: string; body: string; path: string }
      | { kind: 'worker'; workerId: string; title: string; body: string; path: string };

    const targets: Target[] = [];

    if (table === 'transactions') {
      if (type === 'INSERT' && record.approval_status === 'pending') {
        const who = record.worker_name || record.worker_id || 'A worker';
        const kind = record.transaction_type === 'return' ? 'return' : 'take';
        targets.push({
          kind: 'staff',
          title: 'New material request',
          body: `${who} submitted a ${kind} request (pending approval)`,
          path: '/materials/admin',
        });
      }

      if (
        type === 'UPDATE' &&
        oldRecord &&
        oldRecord.approval_status === 'pending' &&
        (record.approval_status === 'approved' || record.approval_status === 'declined') &&
        record.worker_id
      ) {
        const outcome = record.approval_status === 'approved' ? 'approved' : 'declined';
        const kind = record.transaction_type === 'return' ? 'return' : 'take';
        targets.push({
          kind: 'worker',
          workerId: String(record.worker_id),
          title: `Request ${outcome}`,
          body: `Your ${kind} request was ${outcome}${record.approved_by ? ` by ${record.approved_by}` : ''}`,
          path: '/materials/history',
        });
      }
    } else if (table === 'materials_catalog' && type === 'UPDATE' && oldRecord) {
      const prev = Number(oldRecord.quantity);
      const next = Number(record.quantity);
      if (
        Number.isFinite(next) &&
        next <= LOW_STOCK &&
        Number.isFinite(prev) &&
        prev > LOW_STOCK
      ) {
        targets.push({
          kind: 'staff',
          title: 'Low stock alert',
          body: `${record.name || 'Material'} (#${record.reference_number || '?'}) is now ${next} ${record.unit || ''}`.trim(),
          path: '/materials/admin',
        });
      }
    } else {
      return json(200, { ok: true, skipped: `ignored table ${table}` });
    }

    if (targets.length === 0) {
      return json(200, { ok: true, skipped: 'no notification targets' });
    }

    const sa = parseServiceAccount();
    const accessToken = await getGoogleAccessToken(sa);

    const results: unknown[] = [];

    for (const t of targets) {
      let tokens: { fcm_token: string; role?: string }[] = [];
      if (t.kind === 'staff') {
        const { data } = await db
          .from('device_push_tokens')
          .select('fcm_token, role')
          .in('role', ['admin', 'manager']);
        tokens = data || [];
      } else {
        const { data } = await db
          .from('device_push_tokens')
          .select('fcm_token')
          .eq('role', 'worker')
          .eq('worker_id', t.workerId);
        tokens = data || [];
      }

      for (const row of tokens) {
        const send = await sendFcm(
          sa,
          accessToken,
          row.fcm_token,
          t.title,
          t.body,
          t.kind === 'staff' && row.role === 'manager' ? '/ManagerDashboard' : t.path,
        );
        results.push({
          token: row.fcm_token.slice(0, 12) + '…',
          ...send,
        });

        // Drop invalid tokens
        if (
          !send.ok &&
          (send.text.includes('UNREGISTERED') ||
            send.text.includes('INVALID_ARGUMENT') ||
            send.status === 404)
        ) {
          await db.from('device_push_tokens').delete().eq('fcm_token', row.fcm_token);
        }
      }
    }

    return json(200, { ok: true, sent: results.length, results });
  } catch (e) {
    console.error('fcm-db-webhook error', e);
    return json(500, { error: 'Internal error', detail: String(e) });
  }
});
