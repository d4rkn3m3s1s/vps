import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Per-device CPU/mem/disk timeseries for the device health chart. ?hours=N.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hours = new URL(request.url).searchParams.get('hours') ?? '6';
  const res = await apiCall(`/devices/${id}/metrics?hours=${encodeURIComponent(hours)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
