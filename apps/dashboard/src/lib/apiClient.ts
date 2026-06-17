// Server-only API client. Holds the API key + admin credentials and exchanges
// them for a JWT so the browser never sees any secret. Used by Next.js route
// handlers under /app/api/*.

import { cookies } from 'next/headers';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@local.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

// Cache one token per active workspace so switching workspaces uses the right
// scope without re-authenticating on every call.
type TokenCache = { token: string; expiresAt: number };
const cacheByWorkspace = new Map<string, TokenCache>();

// The active workspace comes from a cookie the switcher sets. Empty = default.
async function getActiveWorkspaceId(): Promise<string> {
  try {
    return (await cookies()).get('fleet_workspace')?.value ?? '';
  } catch {
    return '';
  }
}

async function serviceLogin(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    cache: 'no-store',
    // x-service-auth marks this as a trusted server-side call so it bypasses the
    // interactive 2FA gate (2FA protects the browser login, not this service
    // identity). Only honored together with the valid API key above.
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'x-service-auth': '1' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (!res.ok) throw new Error(`Auth failed (${res.status})`);
  const json = (await res.json()) as { data: { accessToken: string } };
  return json.data.accessToken;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const workspaceId = await getActiveWorkspaceId();
  const cached = cacheByWorkspace.get(workspaceId);
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.token;
  }

  // Base token (admin's default workspace).
  let token = await serviceLogin();

  // If a non-default workspace is active, exchange for a token scoped to it.
  if (workspaceId) {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/switch`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const json = (await res.json()) as { data: { accessToken: string } };
      token = json.data.accessToken;
    }
    // If the switch fails (e.g. not a member), fall back to the base token.
  }

  cacheByWorkspace.set(workspaceId, { token, expiresAt: now + 12 * 60_000 });
  return token;
}

export type ApiCallOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean; // include JWT (required for writes)
};

export async function apiCall<T = unknown>(path: string, opts: ApiCallOptions = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY
  };

  if (opts.auth !== false) {
    try {
      headers.Authorization = `Bearer ${await getAccessToken()}`;
    } catch {
      return { ok: false, status: 401, data: null };
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    cache: 'no-store',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
  });

  let data: T | null = null;
  try {
    const json = (await res.json()) as { data?: T };
    data = (json.data ?? (json as T)) ?? null;
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}
