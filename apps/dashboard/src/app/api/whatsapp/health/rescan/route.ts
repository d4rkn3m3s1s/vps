import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Kisitli/yasakli hesaplari YENIDEN TARAT: cihaz basina WHATSAPP_ACCOUNT_HEALTH job'i
// acilir; sonuc saglikli ise damga otomatik kalkar, hala kisitli ise geri konur.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/health/rescan', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
