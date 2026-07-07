import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

// Provide the SMS code for an account waiting at AWAITING_OTP; the agent enters
// it and finishes the profile.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/accounts/whatsapp/register/${id}/otp`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
