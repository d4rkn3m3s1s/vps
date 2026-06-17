import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';

// Begins 2FA enrollment for the logged-in user (uses their session JWT).
export async function POST() {
  const session = (await cookies()).get('fleet_session')?.value;
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const res = await fetch(`${BASE_URL}/auth/2fa/setup`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, Authorization: `Bearer ${session}` }
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
