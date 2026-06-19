import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

export async function GET(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const limit = new URL(request.url).searchParams.get('limit') ?? '100';
  const res = await apiCall(`/farm/accounts/${deviceId}/log?limit=${encodeURIComponent(limit)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
