import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Stored WhatsApp messages (inbound captured by the agent + outbound we sent) for
// a device. Proxies to the backend, forwarding deviceId/limit/direction.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const deviceId = sp.get('deviceId') ?? '';
  const limit = sp.get('limit') ?? '';
  const direction = sp.get('direction') ?? '';
  const qs = new URLSearchParams({ deviceId });
  if (limit) qs.set('limit', limit);
  if (direction) qs.set('direction', direction);
  const res = await apiCall(`/accounts/whatsapp/messages?${qs.toString()}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
