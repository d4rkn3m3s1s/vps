import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

// Change a member's role (admin-only on the API side).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/workspaces/${id}/members/${memberId}`, { method: 'PUT', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

// Remove a member from a workspace (admin-only on the API side).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const res = await apiCall(`/workspaces/${id}/members/${memberId}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
