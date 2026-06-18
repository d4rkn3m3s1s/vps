import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

export async function PUT(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/farm/accounts/${deviceId}/credentials`, { method: 'PUT', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
