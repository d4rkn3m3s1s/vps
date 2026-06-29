import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Push the stored fingerprint to the physical device (setprop over ADB).
export async function POST(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const res = await apiCall(`/fingerprints/${encodeURIComponent(deviceId)}/apply`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
