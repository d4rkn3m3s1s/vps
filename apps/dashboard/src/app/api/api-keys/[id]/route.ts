import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Revoke an API key (admin-only on the API side).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/api-keys/${id}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
