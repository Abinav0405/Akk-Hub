/**
 * CORS for Edge Functions called from the web app / Capacitor WebView.
 * Do NOT use `*` — reflect only known app origins. Server-side callers
 * (e.g. Database Webhooks) typically send no Origin and do not need CORS.
 */

const STATIC_ALLOWED_ORIGINS = new Set([
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
  'https://site-progress-tracker.pages.dev',
]);

/** Local Vite / preview ports, Capacitor localhost, and Cloudflare Pages. */
function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    const protoOk =
      u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'capacitor:' || u.protocol === 'ionic:';
    if (!protoOk) return false;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (u.hostname === 'site-progress-tracker.pages.dev') return true;
    if (u.hostname.endsWith('.pages.dev') && u.protocol === 'https:') return true;
    return false;
  } catch {
    return false;
  }
}

const ALLOW_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-spt-push-secret, x-spt-fcm-secret, x-spt-worker-session, x-spt-manager-session';

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
