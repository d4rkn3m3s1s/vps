import { NextResponse } from 'next/server';

// Persists the user's choice to hide the onboarding checklist. Stored as a plain
// cookie (not security-sensitive) read server-side by the dashboard home page.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('fleet_onboarding_dismissed', '1', {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  });
  return res;
}
