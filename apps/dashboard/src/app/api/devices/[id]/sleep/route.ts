import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Cleanly stop a running Waydroid instance (wd-stop.sh).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/devices/${id}/sleep`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
