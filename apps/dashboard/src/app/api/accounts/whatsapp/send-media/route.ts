import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Send a media message (image/document) from a device — device-scoped.
// { deviceId, to, mediaUrl, caption? }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/send-media', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
