import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

export async function GET(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const res = await apiCall(`/farm/accounts/${deviceId}/totp`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
