import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

// Change the device's OWN WhatsApp profile display name — device-scoped. { deviceId, name }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/profile/name', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
