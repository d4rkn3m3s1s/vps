import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function GET() {
  const res = await apiCall('/calendar/posts', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/calendar/posts', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
