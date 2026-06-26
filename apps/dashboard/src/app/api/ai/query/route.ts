import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { query?: string };
  const res = await apiCall('/ai/query', { method: 'POST', body: { query: body.query ?? '' }, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
