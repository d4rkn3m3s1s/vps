import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Send a WhatsApp message directly from a device (device-scoped, no account id).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/send', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
