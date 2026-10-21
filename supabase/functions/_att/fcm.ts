type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

export function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON secret is not configured');
  }
  const trimmed = raw.trim();
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(trimmed) as ServiceAccount;
  } catch (error) {
    // Common misconfig: secret stored with single quotes / truncated / BOM.
    const head = trimmed.slice(0, 24).replace(/[^\x20-\x7E]/g, '?');
    throw new Error(
      `FCM_SERVICE_ACCOUNT_JSON is not valid JSON (${String(error)}). Starts with: ${head}`,
    );
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is missing required fields');
  }
  return parsed;
}

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function signJwt(sa: ServiceAccount, scope: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const head = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const unsigned = `${head}.${body}`;

  const pem = sa.private_key.replace(/\\n/g, '\n');
  const pemBody = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const sa = loadServiceAccount();
  const assertion = await signJwt(sa, 'https://www.googleapis.com/auth/firebase.messaging');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM OAuth failed: ${text}`);
  }

  const json = await res.json();
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

export type FcmPayload = {
  title: string;
  body: string;
  path?: string;
};

export type FcmSendFailure = {
  tokenPrefix: string;
  error: string;
  stale: boolean;
};

function isStaleTokenError(message: string): boolean {
  const m = message.toUpperCase();
  return (
    m.includes('UNREGISTERED') ||
    m.includes('NOT_FOUND') ||
    m.includes('INVALID_ARGUMENT') ||
    m.includes('REGISTRATION-TOKEN-NOT-REGISTERED') ||
    m.includes('REQUESTED ENTITY WAS NOT FOUND')
  );
}

export async function sendFcmToToken(token: string, payload: FcmPayload): Promise<void> {
  const sa = loadServiceAccount();
  const accessToken = await getAccessToken();

  const message: Record<string, unknown> = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.path ? { path: String(payload.path) } : {},
    android: {
      priority: 'HIGH',
      notification: {
        channel_id: 'akk_updates',
        sound: 'default',
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM send failed (${res.status}): ${text}`);
  }
}

export async function sendFcmToMany(tokens: string[], payload: FcmPayload) {
  const unique = [...new Set(tokens.filter(Boolean))];
  const results = await Promise.allSettled(unique.map((t) => sendFcmToToken(t, payload)));

  const failures: FcmSendFailure[] = [];
  const staleTokens: string[] = [];

  results.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const token = unique[index];
    const error = String(result.reason || 'unknown');
    const stale = isStaleTokenError(error);
    failures.push({
      tokenPrefix: token.slice(0, 10),
      error: error.slice(0, 500),
      stale,
    });
    if (stale) staleTokens.push(token);
  });

  return {
    sent: unique.length - failures.length,
    failed: failures.length,
    total: unique.length,
    failures,
    staleTokens,
  };
}
