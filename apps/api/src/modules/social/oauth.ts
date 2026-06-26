import { env } from '../../config/env';
import { URLSearchParams } from 'node:url';
import crypto from 'node:crypto';

type SignedStatePayload = {
  uid: string;
  p: string;
  ts: number;
  cv?: string;
};

function b64url(value: Buffer | string): string {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return raw.toString('base64url');
}

function signState(payloadBase64: string): string {
  const sig = crypto
    .createHmac('sha256', env.jwtAccessSecret)
    .update(payloadBase64)
    .digest();
  return b64url(sig);
}

export function createSignedState(payload: SignedStatePayload): string {
  const payloadBase64 = b64url(JSON.stringify(payload));
  const signature = signState(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function parseAndVerifyState(state: string): SignedStatePayload | null {
  const [payloadBase64, signature] = String(state).split('.');
  if (!payloadBase64 || !signature) return null;
  const expected = signState(payloadBase64);
  if (expected !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as SignedStatePayload;
    if (!parsed.uid || !parsed.p || !parsed.ts) return null;
    const maxAgeMs = 10 * 60 * 1000;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export async function exchangeXCodeForToken(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; refreshToken?: string | undefined; expiresIn?: number | undefined; scope?: string | undefined }> {
  if (!env.twitterClientId || !env.twitterClientSecret) {
    throw new Error('TWITTER_CLIENT_ID/TWITTER_CLIENT_SECRET are required');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier
  });

  const basic = Buffer.from(`${env.twitterClientId}:${env.twitterClientSecret}`, 'utf8').toString('base64');
  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`X token exchange failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!json.access_token) {
    throw new Error('X token exchange response missing access_token');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope
  };
}

export async function fetchXMe(accessToken: string): Promise<{ id: string; name?: string | undefined; username?: string | undefined }> {
  const response = await fetch('https://api.twitter.com/2/users/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`X /users/me failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    data?: {
      id?: string;
      name?: string;
      username?: string;
    };
  };

  if (!json.data?.id) {
    throw new Error('X /users/me response missing user id');
  }

  return {
    id: json.data.id,
    name: json.data.name,
    username: json.data.username
  };
}

export function getProviderRedirectUrl(provider: string, state: string, redirectUri: string, scopes: string[] = []): string {
  switch (provider) {
    case 'X': {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: env.twitterClientId ?? '',
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state
      });
      if (!params.get('scope')) {
        params.set('scope', 'tweet.read tweet.write users.read offline.access');
      }
      return `https://api.twitter.com/oauth2/authorize?${params.toString()}`;
    }
    case 'META': {
      const params = new URLSearchParams({
        client_id: env.metaClientId ?? '',
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        scope: scopes.join(',')
      });
      return `https://www.facebook.com/v17.0/dialog/oauth?${params.toString()}`;
    }
    case 'INSTAGRAM': {
      const params = new URLSearchParams({
        client_id: env.instagramClientId ?? '',
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        scope: scopes.join(',')
      });
      return `https://api.instagram.com/oauth/authorize?${params.toString()}`;
    }
    default:
      throw new Error('Unsupported provider');
  }
}
