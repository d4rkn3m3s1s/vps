import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/alerts/rules/${id}`, { method: 'PUT', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/alerts/rules/${id}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
