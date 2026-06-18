import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Capture a snapshot from a device.
export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/snapshots/device/${deviceId}`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
