import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Mints a short-lived viewer token + returns the public WS origin so the browser
// can open the live stream socket directly against the API.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall<{ token: string; deviceId: string; online: boolean }>(`/stream/${id}/token`, { method: 'POST', auth: true });
  const wsBase = (process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws/devices').replace(/\/ws\/devices$/, '');
  return NextResponse.json({ data: { ...res.data, wsBase } }, { status: res.ok ? 200 : res.status });
}
