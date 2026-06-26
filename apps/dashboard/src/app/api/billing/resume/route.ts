import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Reverse a scheduled cancellation while the subscription is still active.
export async function POST() {
  const res = await apiCall('/billing/resume', { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
