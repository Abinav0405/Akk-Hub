import { getCorsHeaders, jsonResponse } from '../_prg/cors.ts';
import { timingSafeEqualString } from '../_prg/secureCompare.ts';
import { getServiceClient } from '../_prg/supabaseAdmin.ts';

type Caller =
  | { kind: 'admin'; userId: string }
  | { kind: 'worker'; workerId: string }
  | { kind: 'manager'; managerId: string };

/**
 * Optional soft rate gate only — NEVER sufficient alone.
 * Client-bundled VITE_PUSH_REGISTER_SECRET is public; real auth is JWT (admin)
 * or a role session token (worker/manager) verified against the database below.
 */
function checkOptionalPushSecret(req: Request): string | null {
  const expected = Deno.env.get('PUSH_REGISTER_SECRET');
  if (!expected) return null;
  const provided = req.headers.get('x-spt-push-secret') ?? '';
  if (!provided) return null;
  if (!timingSafeEqualString(provided, expected)) {
    return 'Unauthorized (push soft-gate)';
  }
  return null;
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function resolveCaller(req: Request, supabase: ReturnType<typeof getServiceClient>): Promise<Caller | null> {
  const jwt = bearerToken(req);
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Prefer Supabase Auth JWT when present (Admin). Ignore the anon key masquerading as Bearer.
  if (jwt && (!anonKey || !timingSafeEqualString(jwt, anonKey))) {
    try {
      const { data, error } = await supabase.auth.getUser(jwt);
      const userId = data?.user?.id;
      if (!error && userId) {
        const { data: profile } = await supabase
          .from('admin_profiles')
          .select('user_id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();
        if (profile) return { kind: 'admin', userId };
      }
    } catch {
      /* fall through */
    }
  }

  const workerToken = req.headers.get('x-spt-worker-session')?.trim();
  if (workerToken) {
    const { data, error } = await supabase.rpc('verify_role_session', { p_session_token: workerToken });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row?.user_id) return { kind: 'worker', workerId: String(row.user_id) };
  }

  const managerToken = req.headers.get('x-spt-manager-session')?.trim();
  if (managerToken) {
    const { data, error } = await supabase.rpc('verify_manager_session', { p_session_token: managerToken });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row?.manager_id) return { kind: 'manager', managerId: String(row.manager_id) };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req);
  }

  const softGateError = checkOptionalPushSecret(req);
  if (softGateError) {
    return jsonResponse({ error: softGateError }, 401, req);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, req);
  }

  let supabase: ReturnType<typeof getServiceClient>;
  try {
    supabase = getServiceClient('progress');
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, req);
  }

  const caller = await resolveCaller(req, supabase);
  if (!caller) {
    return jsonResponse(
      { error: 'Unauthorized: provide a valid Supabase Auth JWT (admin) or a matching role session token' },
      401,
      req
    );
  }

  const userId = caller.kind === 'admin' ? caller.userId : caller.kind === 'worker' ? caller.workerId : caller.managerId;
  const userRole = caller.kind;

  if (body.unregister_token) {
    const token = String(body.unregister_token);
    if (!token) return jsonResponse({ error: 'unregister_token is required' }, 400, req);

    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('fcm_token', token)
      .eq('user_id', userId)
      .eq('user_role', userRole);
    if (error) return jsonResponse({ error: error.message }, 500, req);
    return jsonResponse({ ok: true, unregistered: true }, 200, req);
  }

  const fcmToken = String(body.fcm_token || '').trim();
  if (!fcmToken) {
    return jsonResponse({ error: 'fcm_token is required' }, 400, req);
  }
  const platform = String(body.platform || 'android');

  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { fcm_token: fcmToken, user_id: userId, user_role: userRole, platform },
      { onConflict: 'fcm_token' }
    );
  if (error) return jsonResponse({ error: error.message }, 500, req);

  return jsonResponse({ ok: true }, 200, req);
});
