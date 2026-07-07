import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Delete a message in a chat — device-scoped. { deviceId, to, scope: 'me'|'everyone' }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/delete-message', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
