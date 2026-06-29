import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

// Run a shell command on a provider-backed device.
export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/cloud-providers/devices/${deviceId}/shell`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
