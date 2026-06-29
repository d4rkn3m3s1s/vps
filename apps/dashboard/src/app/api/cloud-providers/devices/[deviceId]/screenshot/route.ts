import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

// Capture a screenshot of a provider-backed device.
export async function GET(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const res = await apiCall(`/cloud-providers/devices/${deviceId}/screenshot`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
