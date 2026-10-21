/**
 * register-device-token
 *
 * Android app → after login → registers FCM token.
 * Staff: requires a valid Supabase Auth JWT and matching staff role.
 * Worker: requires worker_id + password (re-checked against requesters); subject = worker_id.
 * Optional header x-mt-register-secret must match FCM_REGISTER_SECRET when that secret is set.
 *
 * Deploy: supabase functions deploy register-device-token --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-mt-register-secret',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const registerSecret = Deno.env.get('FCM_REGISTER_SECRET') || '';
    if (registerSecret) {
      const provided = req.headers.get('x-mt-register-secret') || '';
      if (!timingSafeEqual(provided, registerSecret)) {
        return json(401, { error: 'Invalid register secret' });
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'materials' } });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json(400, { error: 'Invalid JSON body' });
    }

    const fcm_token = String(body.fcm_token || '').trim();
    const action = String(body.action || 'register').trim().toLowerCase();

    // Possession of the device token is enough to unregister that row (logout).
    if (action === 'unregister') {
      if (!fcm_token || fcm_token.length < 20) {
        return json(400, { error: 'fcm_token required' });
      }
      const { error: delError } = await admin
        .from('device_push_tokens')
        .delete()
        .eq('fcm_token', fcm_token);
      if (delError) {
        console.error('unregister failed', delError);
        return json(500, { error: 'Failed to unregister', detail: delError.message });
      }
      return json(200, { ok: true, unregistered: true });
    }

    const platform = String(body.platform || 'android').trim() || 'android';
    const role = String(body.role || '').trim();

    if (!fcm_token || fcm_token.length < 20) {
      return json(400, { error: 'fcm_token required' });
    }
    if (!['admin', 'manager', 'worker'].includes(role)) {
      return json(400, { error: 'role must be admin, manager, or worker' });
    }

    let worker_id: string | null = null;
    let admin_email: string | null = null;

    if (role === 'admin' || role === 'manager') {
      const authHeader = req.headers.get('Authorization') || '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!jwt) {
        return json(401, { error: 'Staff requires Authorization Bearer JWT' });
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData?.user?.email) {
        return json(401, { error: 'Invalid admin session' });
      }

      const claimEmail = userData.user.email.toLowerCase();
      const { data: profile } = await admin
        .from('staff_profiles')
        .select('role, roles, is_active')
        .eq('user_id', userData.user.id)
        .maybeSingle();
      const staffRoles = profile?.roles?.length ? profile.roles : [profile?.role];
      if (!profile?.is_active || !staffRoles.includes(role)) {
        return json(403, { error: 'Staff role does not match session' });
      }
      const bodyEmail = String(body.admin_email || '').trim().toLowerCase();
      if (bodyEmail && bodyEmail !== claimEmail) {
        return json(403, { error: 'admin_email does not match session' });
      }
      admin_email = claimEmail;
    } else {
      worker_id = String(body.worker_id || '').trim();
      const password = String(body.password || '');
      if (!worker_id || !password) {
        return json(400, { error: 'worker_id and password required for worker role' });
      }

      const { data: requester, error: reqError } = await admin
        .from('requesters')
        .select('requester_id, password_hash')
        .eq('requester_id', worker_id)
        .maybeSingle();

      if (reqError || !requester) {
        return json(401, { error: 'Invalid worker credentials' });
      }
      // password_hash is currently stored plain text in this project
      if (password !== requester.password_hash) {
        return json(401, { error: 'Invalid worker credentials' });
      }
    }

    const row = {
      fcm_token,
      platform,
      role,
      worker_id,
      admin_email,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from('device_push_tokens')
      .upsert(row, { onConflict: 'fcm_token' })
      .select('id, role, worker_id, admin_email, updated_at')
      .single();

    if (error) {
      console.error('upsert failed', error);
      return json(500, { error: 'Failed to save token', detail: error.message });
    }

    return json(200, { ok: true, token: data });
  } catch (e) {
    console.error('register-device-token error', e);
    return json(500, { error: 'Internal error' });
  }
});
