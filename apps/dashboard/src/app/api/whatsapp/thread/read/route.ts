import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Mark a conversation read (zero its unread count).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/thread/read', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
