import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// List / create canned replies (message templates).
export async function GET() {
  const res = await apiCall('/whatsapp/canned', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/canned', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
