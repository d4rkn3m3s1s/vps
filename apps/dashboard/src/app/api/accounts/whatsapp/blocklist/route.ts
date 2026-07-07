import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Read the blocked-contacts list off a device — device-scoped. { deviceId }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/whatsapp/blocklist', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
