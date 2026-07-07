import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Messaging stats (inbound/outbound/failed/open threads/avg response).
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['deviceId', 'sinceHours']) { const v = sp.get(k); if (v) qs.set(k, v); }
  const res = await apiCall(`/whatsapp/stats?${qs.toString()}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
