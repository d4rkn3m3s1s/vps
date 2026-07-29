// Panelin iç API'sine (`/api/*`) yapılan çağrılar için GÜVENLİ fetch yardımcısı.
//
// ★2026-07-29 — NEDEN VAR: panelde tekrar eden bir sessiz-hata sınıfı vardı. Kod şunu
// yapıyordu:
//
//     const res = await fetch('/api/…');
//     const json = await res.json();      // res.ok KONTROL EDİLMEDEN
//     … catch { /* ignore */ }            // hata sessizce yutuluyor
//
// Oturumun süresi dolduğunda middleware isteği `/welcome`'a YÖNLENDİRİYORDU; fetch
// yönlendirmeyi takip edip 200 + HTML alıyor, `res.ok` TRUE oluyor, `res.json()` HTML'i
// parse edemeyip fırlatıyor ve boş catch bunu "geçici hata" gibi yutuyordu. Sonuç:
// bildirimler/işler sessizce donuyor, kullanıcı hiçbir şey göremiyordu (canlı yaşandı;
// lib/live.tsx'te aynı bug WebSocket'i kalıcı olarak kopuk bırakıyordu).
//
// Bu yardımcı üç şeyi garanti eder: (1) yönlendirme TAKİP EDİLMEZ, (2) content-type
// JSON değilse veri kabul edilmez, (3) 401 çağırana AÇIKÇA bildirilir ki arayüz
// "bağlantı yok" yerine "oturum bitti" diyebilsin.

export type FetchJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  /** Oturum geçersiz/süresi dolmuş — yeniden denemek düzeltmez, giriş gerekir. */
  unauthorized: boolean;
};

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      // Yönlendirmeyi takip etme: /welcome HTML'ini "başarılı JSON" sanmayalım.
      redirect: 'manual',
      ...init
    });

    if (res.status === 401) return { ok: false, status: 401, data: null, unauthorized: true };
    // redirect:'manual' → yönlendirme "opaqueredirect" (status 0) olarak gelir.
    // Bu da oturum kaybı anlamına gelir (middleware giriş sayfasına atıyor).
    if (res.type === 'opaqueredirect' || res.status === 0) {
      return { ok: false, status: 0, data: null, unauthorized: true };
    }
    if (!res.ok) return { ok: false, status: res.status, data: null, unauthorized: false };

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      return { ok: false, status: res.status, data: null, unauthorized: false };
    }
    const json = (await res.json()) as T;
    return { ok: true, status: res.status, data: json, unauthorized: false };
  } catch {
    // Ağ hatası / iptal / parse hatası: çağıran "geçici" muamelesi yapar.
    return { ok: false, status: 0, data: null, unauthorized: false };
  }
}
