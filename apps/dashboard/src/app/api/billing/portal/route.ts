import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Opens the Stripe billing portal for the active workspace.
export async function POST() {
  const res = await apiCall<{ url: string }>('/billing/portal', { method: 'POST', auth: true });
  return NextResponse.json(res.data ?? {}, { status: res.ok ? 200 : res.status });
}
