import { NextResponse } from 'next/server';

// Public referral landing: /r/<code>
// Captures the referral code into a cookie, then redirects the visitor to the
// login/onboarding page. When they are later provisioned an account, the signup
// path reads this cookie and records the referral (referralService.recordSignup),
// closing the attribution loop. No auth required — this is the public entry point.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const url = new URL(request.url);
  const dest = new URL('/login', url.origin);
  if (clean) dest.searchParams.set('ref', clean);
  const res = NextResponse.redirect(dest);
  if (clean) {
    // 30-day attribution window; readable server-side on signup.
    res.cookies.set('fleet_ref', clean, { maxAge: 60 * 60 * 24 * 30, path: '/', sameSite: 'lax' });
  }
  return res;
}
