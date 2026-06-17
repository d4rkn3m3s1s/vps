import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Starts a Stripe Checkout session for an upgrade; returns the redirect URL.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall<{ url: string }>('/billing/checkout', { method: 'POST', body, auth: true });
  return NextResponse.json(res.data ?? {}, { status: res.ok ? 200 : res.status });
}
