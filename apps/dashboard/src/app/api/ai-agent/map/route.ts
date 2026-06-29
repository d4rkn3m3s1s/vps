import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Persist an AppMap from a completed APP_EXPLORE job.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/device-agent/map', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
