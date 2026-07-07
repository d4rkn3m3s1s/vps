import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Lazy-load one thread's avatar data-URI (kept out of the conversation list).
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['deviceId', 'peer']) { const v = sp.get(k); if (v) qs.set(k, v); }
  const res = await apiCall(`/whatsapp/conversations/avatar?${qs.toString()}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
