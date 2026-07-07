import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Block / unblock a WhatsApp contact — device-scoped. { deviceId, to, block? }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/block', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
