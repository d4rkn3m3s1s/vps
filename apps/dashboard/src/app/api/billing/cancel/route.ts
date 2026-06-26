import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Schedule cancellation at period end (admin/workspace-scoped on the API side).
export async function POST() {
  const res = await apiCall('/billing/cancel', { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
