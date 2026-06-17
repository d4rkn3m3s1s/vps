import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';

// Disables 2FA (requires a valid TOTP/backup code in the body).
export async function POST(request: Request) {
  const session = (await cookies()).get('fleet_session')?.value;
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${BASE_URL}/auth/2fa/disable`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, Authorization: `Bearer ${session}` },
    body: JSON.stringify(body)
  });
  if (res.status === 204) return NextResponse.json({ ok: true });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
