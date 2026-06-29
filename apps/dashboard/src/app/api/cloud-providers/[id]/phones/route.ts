import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Create a new phone at the provider and mirror it as a Device row.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/cloud-providers/${id}/phones`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
