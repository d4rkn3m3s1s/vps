import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

// ★2026-07-30 "Sıfırla ve Tekrar Dene" — AYNI hesap satırıyla yeniden dene: çıkış IP'si
// döndürülür (yeni sessid) ve REGISTER_WHATSAPP tekrar gönderilir (ajan kayıt başında
// WhatsApp verisini zaten temizliyor). Kesin ban'da API 409 döner ve modal onu gösterir.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/whatsapp/register/${id}/retry`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
