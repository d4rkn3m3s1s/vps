import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

async function updateDevice(request: Request, id: string) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/devices/${id}`, { method: 'PUT', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return updateDevice(request, id);
}

// GroupsView (add/remove device) and ProfilesView (edit tags) call PUT — bridge it
// to the same backend PUT so those buttons stop 405'ing.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return updateDevice(request, id);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/devices/${id}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
