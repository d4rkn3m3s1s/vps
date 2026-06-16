import { NextResponse } from 'next/server';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  }

  const json = (await res.json()) as { data: { accessToken: string; refreshToken: string } };

  const response = NextResponse.json({ ok: true });
  // Session marker — httpOnly so JS can't read it. The actual API calls still
  // run server-side via apiClient; this cookie gates dashboard access.
  response.cookies.set('fleet_session', json.data.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12
  });
  return response;
}
