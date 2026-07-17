import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

// Operator picked a verification method (sms | voice | missed_call) on the "Choose
// how to verify" sheet; the agent re-dispatches and selects that row.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/accounts/whatsapp/register/${id}/verify-method`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
