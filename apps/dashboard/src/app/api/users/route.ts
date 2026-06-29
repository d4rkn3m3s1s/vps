import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiCall } from '../../../lib/apiClient';

export async function GET() {
  const res = await apiCall('/users', { auth: false });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  // Attribution: if this visitor arrived via a referral link (/r/<code> sets the
  // fleet_ref cookie) and no code was passed explicitly, attach it so the backend
  // records the referral (referralService.recordSignup) on user creation.
  if (!body.referralCode) {
    const ref = (await cookies()).get('fleet_ref')?.value;
    if (ref) body.referralCode = ref;
  }
  const res = await apiCall('/users', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
