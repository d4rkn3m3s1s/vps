import { NextResponse } from 'next/server';
import { apiCall, apiResponse } from '../../../../../../../lib/apiClient';

// ★2026-07-30 "Sıfırla ve Tekrar Dene" — AYNI hesap satırıyla yeniden dene: çıkış IP'si
// döndürülür (yeni sessid) ve REGISTER_WHATSAPP tekrar gönderilir. Kesin ban'da API 409
// döner ve modal onu gösterir.
//
// ★★★2026-08-13 İKİ HATA DÜZELTİLDİ (operatör: "sıfırla tekrar dene de çalışmıyor"):
//
// 1) GÖVDE İLETİLMİYORDU. Bu route `request`'i `_request` diye yok sayıyordu, yani
//    panelin gönderdiği JSON gövde (yeni `keepWaData` bayrağı) backend'e HİÇ ulaşmıyordu
//    — bayrak sessizce düşüyor ve "WhatsApp'ı koruyarak devam et" tam sıfırlama gibi
//    davranıyordu (istenenin TAM TERSİ).
//
// 2) HATA SEBEBİ YUTULUYORDU. API hatayı `{ error, code }` gövdesiyle döndürüyor (örn.
//    409 DEVICE_BUSY → "Cihaz meşgul — 'WhatsApp kaydı' işlemi sürüyor."). apiCall bu
//    gövdede `data` alanı bulamayınca TÜM gövdeyi `data`ya koyuyor (apiClient.ts:107
//    `json.data ?? (json as T)`), ama eski kod yanıtı `{ data: res.data }` diye sarınca
//    modal'ın aradığı `body.error` alanı OLUŞMUYORDU → panel sessiz kalıyor, operatör
//    "buton çalışmıyor" görüyordu. CANLI KANIT (+905350124185): son iş RUNNING'di →
//    409 DEVICE_BUSY döndü, panelde hiçbir sebep görünmedi.
//    Çözüm: hata durumunda gövdedeki error/code'u ÜST SEVİYEYE çıkar.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gövde isteğe bağlı: yoksa/bozuksa eski davranış (tam sıfırlama) korunur.
  const body = (await request.json().catch(() => ({}))) as { keepWaData?: unknown };
  const keepWaData = body.keepWaData === true;

  const res = await apiCall<Record<string, unknown>>(`/accounts/whatsapp/register/${id}/retry`, {
    method: 'POST',
    auth: true,
    ...(keepWaData ? { body: { keepWaData: true } } : {})
  });

  const out = apiResponse(res);
  return NextResponse.json(out.body, { status: out.status });
}
