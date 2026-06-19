import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

export async function GET(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const res = await apiCall(`/grants/device/${deviceId}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/grants/device/${deviceId}`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
