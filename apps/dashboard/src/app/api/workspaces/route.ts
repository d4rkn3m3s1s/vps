import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// List the workspaces the service identity (admin) belongs to, and create new ones.
export async function GET() {
  const res = await apiCall('/workspaces', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/workspaces', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
