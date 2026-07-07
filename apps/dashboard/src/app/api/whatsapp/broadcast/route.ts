import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Launch / list broadcasts (one-to-many throttled send).
export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get('deviceId') ?? '';
  const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
  const res = await apiCall(`/whatsapp/broadcast${qs}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/broadcast', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
