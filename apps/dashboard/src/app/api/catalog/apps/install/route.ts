import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/catalog/apps/install', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
