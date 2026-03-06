import { createHmac } from 'crypto';

const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function getStateSecret() {
  return (
    process.env.GSC_OAUTH_STATE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'maark-gsc-state-secret'
  );
}

function base64UrlEncode(input: string) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payload: string) {
  return createHmac('sha256', getStateSecret()).update(payload).digest('hex');
}

export function buildGscOAuthState(input: {
  projectId: number;
  userId: string;
  issuedAt?: number;
}) {
  const payload = JSON.stringify({
    p: input.projectId,
    u: input.userId,
    i: input.issuedAt ?? Date.now(),
  });
  const encoded = base64UrlEncode(payload);
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function parseAndVerifyGscOAuthState(state: string, maxAgeMs = 15 * 60 * 1000): {
  projectId: number;
  userId: string;
  issuedAt: number;
} {
  const [encoded, signature] = String(state || '').split('.');
  if (!encoded || !signature) {
    throw new Error('Invalid OAuth state format.');
  }

  const expected = signPayload(encoded);
  if (expected !== signature) {
    throw new Error('OAuth state signature mismatch.');
  }

  const parsed = JSON.parse(base64UrlDecode(encoded)) as {
    p?: unknown;
    u?: unknown;
    i?: unknown;
  };

  const projectId = Number.parseInt(String(parsed.p ?? ''), 10);
  const userId = String(parsed.u ?? '').trim();
  const issuedAt = Number.parseInt(String(parsed.i ?? ''), 10);

  if (!Number.isFinite(projectId) || projectId <= 0 || !userId || !Number.isFinite(issuedAt)) {
    throw new Error('Invalid OAuth state payload.');
  }
  if (Date.now() - issuedAt > maxAgeMs) {
    throw new Error('OAuth state expired.');
  }

  return { projectId, userId, issuedAt };
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for GSC OAuth.');
  }

  return {
    clientId,
    clientSecret,
  };
}

export function getGoogleOAuthRedirectUri(origin: string) {
  return process.env.GSC_OAUTH_REDIRECT_URI || `${origin}/api/admin/crawl-gsc/oauth/callback`;
}

export function buildGoogleOAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: args.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export async function exchangeGoogleCodeForTokens(args: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();

  const body = new URLSearchParams({
    code: args.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Google token exchange failed (${response.status})`);
  }

  return data as GoogleTokenResponse;
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Google token refresh failed (${response.status})`);
  }

  return data as GoogleTokenResponse;
}
