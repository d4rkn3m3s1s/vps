import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Unread total for the WhatsApp sidebar badge.
export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get('deviceId') ?? '';
  const res = await apiCall(`/whatsapp/conversations/unread?deviceId=${encodeURIComponent(deviceId)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
