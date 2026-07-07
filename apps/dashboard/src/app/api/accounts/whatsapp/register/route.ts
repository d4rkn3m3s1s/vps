import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Start operator-OTP WhatsApp registration on a device (operator's own number).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/register', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
