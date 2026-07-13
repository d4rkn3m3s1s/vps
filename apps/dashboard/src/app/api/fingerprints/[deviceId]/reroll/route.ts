import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// One-click identity reroll: new IMEI/serial/android_id/MAC/build, keeping the
// device's screen/model/OS/GPS intact. Applies to the device in the same call.
export async function POST(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const res = await apiCall(`/fingerprints/${encodeURIComponent(deviceId)}/reroll`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
