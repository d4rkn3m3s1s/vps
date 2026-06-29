import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Wipe a workspace's operational data (admin-only + slug confirmation on the API).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/workspaces/${id}/reset`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
