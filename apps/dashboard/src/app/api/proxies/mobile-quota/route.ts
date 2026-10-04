import { NextResponse } from 'next/server';
import { apiCall, apiResponse } from '../../../../lib/apiClient';

// ★2026-10-04 Mobil proxy kotası (Thordata kalan mobil kotayı vermez → paket − alımdan beri kullanım).
// GET ?refresh=1 → önbelleği atlar · POST { packageGb } → yeni paket alındı, sayaç sıfırlanır (admin).
export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  const res = await apiCall(`/proxies/mobile-quota${refresh ? '?refresh=1' : ''}`, { auth: true });
  const { body, status } = apiResponse(res);
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { packageGb?: unknown };
  const res = await apiCall('/proxies/mobile-quota', { method: 'POST', body: { packageGb: Number(body.packageGb) }, auth: true });
  const out = apiResponse(res);
  return NextResponse.json(out.body, { status: out.status });
}
