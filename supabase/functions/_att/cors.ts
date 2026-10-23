/**
 * CORS for Edge Functions called from the web app / Capacitor WebView.
 * Do NOT use `*` — reflect only known app origins. Server-side callers
 * (e.g. Database Webhooks) typically send no Origin and do not need CORS.
 */

const STATIC_ALLOWED_ORIGINS = new Set([
  'https://timesheet-manager.akk.sg',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

/** Local Vite / preview ports and Capacitor localhost variants. */
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    const hostOk =
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === 'timesheet-manager.akk.sg';
    const protoOk = u.protocol === 'http:' || u.protocol === 'https:' ||
      u.protocol === 'capacitor:' || u.protocol === 'ionic:';
    return hostOk && protoOk;
  } catch {
    return false;
  }
}

const ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-akk-push-secret, x-akk-fcm-secret, x-akk-role-session, x-akk-leave-reminder-secret, x-akk-expiry-reminder-secret';

/** @deprecated Prefer getCorsHeaders(req) so Origin is allowlisted. */
export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://timesheet-manager.akk.sg',
  'Access-Control-Allow-Headers': ALLOW_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function jsonResponse(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}
