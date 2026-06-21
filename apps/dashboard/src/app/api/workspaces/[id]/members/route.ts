import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// List or invite members of a workspace (admin-only on the API side).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/workspaces/${id}/members`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/workspaces/${id}/members`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
