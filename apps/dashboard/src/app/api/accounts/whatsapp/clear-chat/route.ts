import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Clear all local messages in a chat — device-scoped. { deviceId, to }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/clear-chat', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
