import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Read workspace security policy (any member).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/workspaces/${id}/settings`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

// Update workspace security policy (admin-only on the API side).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/workspaces/${id}/settings`, { method: 'PUT', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
