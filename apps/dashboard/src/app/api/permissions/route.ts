import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// List permission grants (optionally filtered by ?userId=). Admin-only on API.
export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get('userId');
  const path = userId ? `/permissions?userId=${encodeURIComponent(userId)}` : '/permissions';
  const res = await apiCall(path, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

// Grant (or update) a permission. Admin-only on the API side.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/permissions', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
