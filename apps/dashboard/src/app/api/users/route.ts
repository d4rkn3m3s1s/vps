import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

export async function GET() {
  // Kullanıcı/PII listesi — statik referans değil; workspace-scoped JWT ile git.
  const res = await apiCall('/users', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/users', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
