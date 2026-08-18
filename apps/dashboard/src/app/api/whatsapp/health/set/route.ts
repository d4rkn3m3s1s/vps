import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Operator ELLE bir cihazin WhatsApp hesap sagligini ayarlar (kisitli/yasakli → aktif).
// Monotonik kurali bilerek deler; API tarafinda audit'e yazilir.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/health/set', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
