import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Fetch a contact's WhatsApp profile (avatar + name/about) — device-scoped.
// Dispatches a WHATSAPP_PROFILE job; the result lands on the thread once the
// agent completes (poll the conversation / avatar endpoints afterwards).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/profile', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
