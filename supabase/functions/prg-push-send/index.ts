/**
 * Site photos push sender. progress._deliver_native_push() posts { title, body, path, tokens } here
 * (header x-spt-fcm-secret = server env FCM_WEBHOOK_SECRET); this fans out to FCM and prunes dead tokens.
 */
import { getCorsHeaders } from '../_prg/cors.ts';
import { sendFcmToMany } from '../_prg/fcm.ts';
import { getServiceClient } from '../_prg/supabaseAdmin.ts';
import { timingSafeEqualString } from '../_prg/secureCompare.ts';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const expected = Deno.env.get('FCM_WEBHOOK_SECRET');
  const provided = req.headers.get('x-spt-fcm-secret') ?? '';
  if (!expected || !provided || !timingSafeEqualString(provided, expected)) return json(401, { error: 'Unauthorized' });

  let body: { title?: string; body?: string; path?: string; tokens?: string[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  const tokens = Array.isArray(body.tokens) ? body.tokens.filter((t) => typeof t === 'string' && t) : [];
  if (!tokens.length || !body.title) return json(400, { error: 'title and tokens are required' });

  const result = await sendFcmToMany(tokens, { title: body.title, body: body.body ?? '', path: body.path });
  if (result.staleTokens.length) {
    await getServiceClient('progress').from('device_tokens').delete().in('fcm_token', result.staleTokens);
  }
  return json(200, { sent: result.sent, failed: result.failed });
});
