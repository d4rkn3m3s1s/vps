import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get('deviceId');
  const path = deviceId ? `/device-agent/runs?deviceId=${encodeURIComponent(deviceId)}` : '/device-agent/runs';
  const res = await apiCall(path, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
