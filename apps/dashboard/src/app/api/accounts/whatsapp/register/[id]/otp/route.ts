import { NextResponse } from 'next/server';
import { apiCall, apiResponse } from '../../../../../../../lib/apiClient';

// Provide the SMS code for an account waiting at AWAITING_OTP; the agent enters
// it and finishes the profile.
// ★2026-08-13 apiResponse: hata sebebi (ör. 409 DEVICE_BUSY) artık YUTULMUYOR —
// gerekçe için apiClient.ts'teki apiResponse yorumuna bakın.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/accounts/whatsapp/register/${id}/otp`, { method: 'POST', body, auth: true });
  const out = apiResponse(res);
  return NextResponse.json(out.body, { status: out.status });
}
