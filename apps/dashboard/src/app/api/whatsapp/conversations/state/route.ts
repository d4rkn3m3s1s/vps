import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Toggle a conversation's favourite / archive state.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/conversations/state', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
