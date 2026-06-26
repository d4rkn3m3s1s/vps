import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Revoke a permission grant (admin-only on the API side).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/permissions/${id}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
