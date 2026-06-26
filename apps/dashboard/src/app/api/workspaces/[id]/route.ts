import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Rename / edit a workspace (admin-only on the API side).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/workspaces/${id}`, { method: 'PATCH', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
