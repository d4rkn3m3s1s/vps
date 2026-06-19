import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// Proxies the workspace report summary (optional ?from&to date range).
export async function GET(request: Request) {
  const qs = new URL(request.url).searchParams.toString();
  const res = await apiCall(`/reports/summary${qs ? `?${qs}` : ''}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
