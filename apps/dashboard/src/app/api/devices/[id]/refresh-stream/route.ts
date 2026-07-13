import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Refresh a live stream stuck on "bağlanıyor" — re-opens ADB + re-sends
// stream.start on the host agent for this device.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/devices/${encodeURIComponent(id)}/refresh-stream`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
