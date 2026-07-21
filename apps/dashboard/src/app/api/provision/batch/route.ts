import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Toplu tek-tıkla cihaz oluştur: `count` adet cihazı benzersiz rastgele isim + her
// birine ayrı proxy ile arka arkaya kurar. Per-device sonuç listesi döner.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/provision/batch', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
