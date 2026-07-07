import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// One chat thread's messages (oldest→newest), with scroll-up pagination.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['deviceId', 'peer', 'limit', 'before']) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  const res = await apiCall(`/whatsapp/thread?${qs.toString()}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
