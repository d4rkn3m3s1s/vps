import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Really start a stopped Waydroid instance (wd-run.sh + boot + route).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/devices/${id}/wake`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
