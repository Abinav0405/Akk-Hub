import { getCorsHeaders, jsonResponse } from '../_att/cors.ts';
import { timingSafeEqualString } from '../_att/secureCompare.ts';
import { getServiceClient } from '../_att/supabaseAdmin.ts';

type RoleSession = {
  role: string;
  subject_id: string;
  session_data?: Record<string, unknown> | null;
};

type Caller =
  | { kind: 'jwt'; email: string }
  | { kind: 'role'; role: string; subjectId: string };

/**
 * Optional soft rate gate only — NEVER sufficient alone.
 * Client-bundled VITE_PUSH_REGISTER_SECRET is public; real auth is JWT / role session.
 *
 * If the client omits the header (older / misbuilt web deploys), allow through so
 * production phones can still register. Only reject an explicitly wrong secret.
 */
function checkOptionalPushSecret(req: Request): string | null {
  const expected = Deno.env.get('PUSH_REGISTER_SECRET');
  if (!expected) return null; // not configured → skip soft gate
  const provided = req.headers.get('x-akk-push-secret') ?? '';
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

async function resolveCaller(
  req: Request,
  supabase: ReturnType<typeof getServiceClient>,
): Promise<Caller | null> {
  const jwt = bearerToken(req);
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Prefer Supabase Auth JWT when present (admin). Ignore anon key masquerading as Bearer.
  if (jwt && (!anonKey || !timingSafeEqualString(jwt, anonKey))) {
    try {
      const { data, error } = await supabase.auth.getUser(jwt);
      const email = data?.user?.email?.trim().toLowerCase();
      if (!error && email) {
        return { kind: 'jwt', email };
      }
    } catch {
      /* fall through to role session */
    }
  }

  // Workers / managers (no Supabase Auth): require role_sessions UUID.
  const roleToken = req.headers.get('x-akk-role-session')?.trim();
  if (!roleToken) return null;

  const { data, error } = await supabase.rpc('verify_role_session', {
    p_session_token: roleToken,
  });
  if (error || !Array.isArray(data) || !data.length) return null;

  const row = data[0] as RoleSession;
  const subjectId = String(row.subject_id || '').trim();
  const role = String(row.role || '').trim();
  if (!subjectId || !role) return null;

  return { kind: 'role', role, subjectId };
}

function subjectMatchesCaller(
  caller: Caller,
  workerId: string | null,
  adminEmail: string | null,
  managerEmail: string | null,
  supervisorId: string | null,
): string | null {
  if (workerId) {
    if (caller.kind !== 'role' || caller.role !== 'worker') {
      return 'Worker registration requires a valid worker role session';
    }
    if (caller.subjectId !== workerId) {
      return 'worker_id does not match authenticated session';
    }
    return null;
  }

  if (managerEmail) {
    if (caller.kind !== 'role' || caller.role !== 'manager') {
      return 'Manager registration requires a valid manager role session';
    }
    if (caller.subjectId.trim().toLowerCase() !== managerEmail) {
      return 'manager_email does not match authenticated session';
    }
    return null;
  }

  if (supervisorId) {
    if (caller.kind !== 'role' || caller.role !== 'supervisor') {
      return 'Supervisor registration requires a valid supervisor role session';
    }
    if (caller.subjectId.trim().toLowerCase() !== supervisorId) {
      return 'supervisor_id does not match authenticated session';
    }
    return null;
  }

  if (adminEmail) {
    if (caller.kind !== 'jwt') {
      return 'Admin registration requires a valid Supabase Auth session';
    }
    if (caller.email !== adminEmail) {
      return 'admin_email does not match authenticated user';
    }
    return null;
  }

  return 'Missing subject';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req);
  }

  // Soft gate first (cheap) when configured — never sole auth.
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
    supabase = getServiceClient('attendance');
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500, req);
  }

  const caller = await resolveCaller(req, supabase);
  if (!caller) {
    return jsonResponse(
      {
        error:
          'Unauthorized: provide a valid Supabase Auth JWT (admin) or x-akk-role-session matching the subject',
      },
      401,
      req,
    );
  }

  if (body.unregister_token) {
    const token = String(body.unregister_token);
    if (!token) {
      return jsonResponse({ error: 'unregister_token is required' }, 400, req);
    }

    // FCM-03 / SEC: only delete tokens owned by the authenticated subject — never by token alone.
    let query = supabase.from('device_push_tokens').delete().eq('fcm_token', token);
    if (caller.kind === 'jwt') {
      query = query.eq('admin_email', caller.email);
    } else if (caller.role === 'worker') {
      query = query.eq('worker_id', caller.subjectId);
    } else if (caller.role === 'manager') {
      query = query.eq('manager_email', caller.subjectId.trim().toLowerCase());
    } else if (caller.role === 'supervisor') {
      query = query.eq('supervisor_id', caller.subjectId.trim().toLowerCase());
    } else {
      return jsonResponse({ error: 'Forbidden' }, 403, req);
    }

    const { error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500, req);
    return jsonResponse({ ok: true, unregistered: true }, 200, req);
  }

  const fcmToken = String(body.fcm_token || '').trim();
  if (!fcmToken) {
    return jsonResponse({ error: 'fcm_token is required' }, 400, req);
  }

  const workerId = body.worker_id ? String(body.worker_id).trim() : null;
  const adminEmail = body.admin_email ? String(body.admin_email).trim().toLowerCase() : null;
  const managerEmail = body.manager_email ? String(body.manager_email).trim().toLowerCase() : null;
  const supervisorId = body.supervisor_id ? String(body.supervisor_id).trim().toLowerCase() : null;
  const platform = String(body.platform || 'android');

  const subjectCount = [workerId, adminEmail, managerEmail, supervisorId].filter(Boolean).length;
  if (subjectCount !== 1) {
    return jsonResponse(
      {
        error:
          'Provide exactly one of worker_id, admin_email, manager_email, or supervisor_id',
      },
      400,
      req,
    );
  }

  const mismatch = subjectMatchesCaller(
    caller,
    workerId,
    adminEmail,
    managerEmail,
    supervisorId,
  );
  if (mismatch) {
    return jsonResponse({ error: mismatch }, 403, req);
  }

  const row: Record<string, unknown> = {
    fcm_token: fcmToken,
    worker_id: workerId,
    admin_email: adminEmail,
    manager_email: managerEmail,
    supervisor_id: supervisorId,
    platform,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('device_push_tokens').upsert(row, { onConflict: 'fcm_token' });
  if (error) return jsonResponse({ error: error.message }, 500, req);

  return jsonResponse({ ok: true }, 200, req);
});
