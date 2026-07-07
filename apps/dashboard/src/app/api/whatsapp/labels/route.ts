import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// List / create conversation labels (categories).
export async function GET() {
  const res = await apiCall('/whatsapp/labels', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/labels', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
