import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';
import { slimJobs } from '../../../lib/slimJob';

export async function GET() {
  const res = await apiCall<Array<{ result?: unknown }>>('/jobs?limit=50', { auth: true });
  const data = Array.isArray(res.data) ? slimJobs(res.data) : res.data;
  return NextResponse.json({ data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/jobs', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
