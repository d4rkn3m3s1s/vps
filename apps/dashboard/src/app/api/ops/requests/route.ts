import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Canli operasyon ekraninin ilk dolumu (son N istek + ozet). Sonrasi WS ile gelir.
export async function GET(request: Request) {
  const limit = new URL(request.url).searchParams.get('limit') ?? '200';
  const res = await apiCall(`/ops/requests?limit=${encodeURIComponent(limit)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
