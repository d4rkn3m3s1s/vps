import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// Mints a short-lived access token + returns the public WS base so the browser
// can open the fleet-event socket (/ws/devices) authenticated. The event hub now
// requires a JWT on upgrade (workspace-scoped), so the client must present one.
//
// ★2026-08-12 GÜVENLİK: burası eskiden `getAccessToken()` çağırıp ADMIN SERVİS
// KİMLİĞİNİN token'ını olduğu gibi tarayıcıya dönüyordu. İki sorun vardı:
//   1) Mimari kural açıkça "panel tarayıcıda ASLA JWT tutmaz" diyor (apiClient'ın
//      kendi başlığı da: "so the browser never sees any secret").
//   2) Dönen token 2 SAATLİK ve TAM YETKİLİYDİ — `typ:'access'` taşıdığı için
//      `authenticateJwt` kullanan bütün REST yüzeyinde geçerliydi. Yani panele
//      girebilen herkes fiilen admin anahtarını eline alıyordu.
// Artık admin kimliği YALNIZCA sunucu tarafında kalıyor; onunla API'nin
// `/auth/ws-token` ucu çağrılıyor ve tarayıcıya sadece 10 dakikalık, soket açmaya
// yetecek bir token iniyor. Rol aynen taşınır — yetki yükseltme yok, pencere daraldı.
export async function POST() {
  try {
    const res = await apiCall<{ token?: string }>('/auth/ws-token', { method: 'POST', auth: true });
    const token = res.data?.token;
    if (!res.ok || !token) return NextResponse.json({ data: null }, { status: res.status || 401 });
    const wsBase = (process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws/devices').replace(/\/ws\/devices$/, '');
    return NextResponse.json({ data: { token, wsBase } });
  } catch {
    return NextResponse.json({ data: null }, { status: 401 });
  }
}
