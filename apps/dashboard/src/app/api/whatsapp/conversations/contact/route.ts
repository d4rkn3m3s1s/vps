import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Get / set a conversation's contact info (friendly name + notes).
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['deviceId', 'peer']) { const v = sp.get(k); if (v) qs.set(k, v); }
  const res = await apiCall(`/whatsapp/conversations/contact?${qs.toString()}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/conversations/contact', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
