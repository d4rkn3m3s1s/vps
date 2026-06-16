// Server-only API client. Holds the API key + admin credentials and exchanges
// them for a JWT so the browser never sees any secret. Used by Next.js route
// handlers under /app/api/*.

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@local.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

type TokenCache = { token: string; expiresAt: number };
let cache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 30_000) {
    return cache.token;
  }

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });

  if (!res.ok) {
    throw new Error(`Auth failed (${res.status})`);
  }

  const json = (await res.json()) as { data: { accessToken: string } };
  // Access tokens default to 15m; cache for 12m to stay safe.
  cache = { token: json.data.accessToken, expiresAt: now + 12 * 60_000 };
  return cache.token;
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
