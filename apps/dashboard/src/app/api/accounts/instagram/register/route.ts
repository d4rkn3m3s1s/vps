import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Start one-click Instagram registration on a device (email-based, autonomous).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/accounts/instagram/register', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
