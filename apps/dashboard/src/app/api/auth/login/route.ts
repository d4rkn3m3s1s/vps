import { NextResponse } from 'next/server';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { email, password, twoFactorToken } = body as {
    email?: string;
    password?: string;
    twoFactorToken?: string;
  };

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  // Note: no x-service-auth header here — the browser login MUST go through 2FA.
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ email, password, ...(twoFactorToken ? { twoFactorToken } : {}) })
  });

  if (!res.ok) {
    const status = res.status === 401 ? 401 : res.status;
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    let msg = 'Invalid email or password.';
    if (err.error === 'TWO_FACTOR_INVALID_CODE') {
      msg = 'Invalid verification code.';
    } else if (err.error === 'TWO_FACTOR_REQUIRED') {
      // Policy block — surface the API's actionable guidance verbatim.
      msg = err.message ?? 'This account requires two-factor authentication.';
    }
    return NextResponse.json({ error: msg }, { status });
  }

  const json = (await res.json()) as {
    data: { accessToken?: string; refreshToken?: string; twoFactorRequired?: boolean };
  };

  // Password ok but 2FA code still needed: tell the client to prompt. No cookie.
  if (json.data.twoFactorRequired) {
    return NextResponse.json({ twoFactorRequired: true });
  }
  if (!json.data.accessToken) {
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  // Session marker — httpOnly so JS can't read it. The actual API calls still
  // run server-side via apiClient; this cookie gates dashboard access.
  response.cookies.set('fleet_session', json.data.accessToken!, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12
  });
  return response;
}
