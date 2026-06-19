import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// Workspace-scoped audit log with optional ?action&search&limit filters.
export async function GET(request: Request) {
  const qs = new URL(request.url).searchParams.toString();
  const res = await apiCall(`/audit${qs ? `?${qs}` : ''}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
