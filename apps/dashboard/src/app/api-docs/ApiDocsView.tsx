'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Search, Copy, Check, KeyRound, ChevronRight, Rocket, Loader2, Terminal, AlertTriangle } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, Reveal } from '../../components/hud';

// Method → colour class (defined in globals.css: .api-m-get etc.)
type Method = 'GET' | 'POST';
type Endpoint = {
  method: Method;
  path: string;
  title: string;
  desc: string;
  body?: string; // örnek JSON gövde (POST için)
};
type Group = { title: string; endpoints: Endpoint[] };

// The full public API surface, grouped the same way as the Postman collection.
// Kept in sync with apps/api/src/modules/public/public.routes.ts.
const GROUPS: Group[] = [
  {
    title: 'Hesap & Cihazlar',
    endpoints: [
      { method: 'GET', path: '/public/v1/me', title: 'Kimlik', desc: 'Bu API anahtarının workspace’i, scope’ları ve cihaz sayısı.' },
      { method: 'GET', path: '/public/v1/devices', title: 'Cihazları listele', desc: 'Her cihaz: id, name, status, whatsappNumber (kayıtlı WA numarası), whatsappHealth (null | RESTRICTED | BANNED | LOGGED_OUT), whatsappReady (mesaj atılabilir mi), tags.' },
      { method: 'POST', path: '/public/v1/devices/:id/rename', title: 'Cihaz adını değiştir', desc: 'Cihazın adını (görünen etiket) değiştirir. Kozmetik — instance / WhatsApp hesabı / proxy etkilenmez. Döner: {id, name, status}.', body: '{\n  "name": "yeni-cihaz-adi"\n}' },
      { method: 'POST', path: '/public/v1/devices/:id/tags', title: 'Cihaza etiket ekle/çıkar', desc: 'Cihaza etiket ekle/çıkar/değiştir. mode: add (varsayılan) | remove | set. "#test" → "test" (baştaki # atılır, küçük harfe çevrilir).', body: '{\n  "tags": ["#test"],\n  "mode": "add"\n}' }
    ]
  },
  {
    title: 'WhatsApp — Gönderim',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/send', title: 'Mesaj gönder', desc: 'Bir cihazdan WhatsApp mesajı gönderir. jobId döner. Hesap BANNED/LOGGED_OUT ise anında 409. Idempotency-Key header’ı ile çift-gönderim önlenir.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "message": "Merhaba, test mesajı."\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/send/bulk', title: 'Toplu gönder', desc: 'Tek çağrıda çok sayıda FARKLI mesaj (en fazla 100). Her biri için {to, jobId, status} döner.', body: '{\n  "messages": [\n    { "deviceId": "CIHAZ_ID", "to": "905400403800", "message": "Mesaj 1" },\n    { "deviceId": "CIHAZ_ID", "to": "905400403801", "message": "Mesaj 2" }\n  ]\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/broadcast', title: 'Yayın / broadcast', desc: 'Aynı mesajı çok kişiye (throttle’lı). peers[] VEYA labelId gerekli. {broadcastId, queued} döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "message": "Herkese duyuru.",\n  "peers": ["905400403800", "905400403801"]\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/send-media', title: 'Medya gönder', desc: 'Bir kişiye resim/belge gönderir. kind: image | document.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "mediaUrl": "https://ornek.com/resim.jpg",\n  "caption": "Açıklama",\n  "kind": "image"\n}' }
    ]
  },
  {
    title: 'WhatsApp — Sohbetler & Etiketler',
    endpoints: [
      { method: 'GET', path: '/public/v1/whatsapp/conversations?deviceId=&limit=50', title: 'Sohbet listesi', desc: 'WhatsApp-Web tarzı sohbet listesi (kişi başına son mesaj + okunmamış). filter: all | unread | favorite | archived.' },
      { method: 'GET', path: '/public/v1/whatsapp/thread?deviceId=&peer=&limit=50', title: 'Sohbet geçmişi', desc: 'Bir sohbetin mesaj geçmişi (eski→yeni), yukarı kaydırma sayfalaması.' },
      { method: 'GET', path: '/public/v1/whatsapp/messages?deviceId=&limit=100', title: 'Mesajları oku', desc: 'Kaydedilmiş konuşma geçmişi (gelen+giden). direction: IN | OUT (opsiyonel).' },
      { method: 'POST', path: '/public/v1/whatsapp/thread/read', title: 'Sohbeti okundu işaretle', desc: 'Bir sohbetin okunmamış rozetini sıfırlar.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "peer": "905400403800"\n}' },
      { method: 'GET', path: '/public/v1/whatsapp/stats?deviceId=&sinceHours=24', title: 'İstatistik', desc: 'Mesaj sayıları + SLA (cihaz opsiyonel).' },
      { method: 'GET', path: '/public/v1/whatsapp/labels', title: 'Etiketleri listele', desc: 'Workspace’in sohbet kategorileri (etiketleri).' },
      { method: 'POST', path: '/public/v1/whatsapp/labels', title: 'Etiket oluştur', desc: 'Yeni bir sohbet kategorisi (etiket) oluşturur, örn "#test". Dönen id ile sohbetlere atayabilirsiniz.', body: '{\n  "name": "#test",\n  "color": "#e11d48"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/conversations/labels', title: 'Sohbete etiket ata', desc: 'Bir sohbete kategori (etiket) atar. labelIds, POST /labels’ten dönen id’ler.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "peer": "905400403800",\n  "labelIds": ["ETIKET_ID"]\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/conversations/state', title: 'Sohbet durumu', desc: 'Sohbeti favori / arşiv / sabitle olarak işaretler.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "peer": "905400403800",\n  "favorite": true,\n  "archived": false,\n  "pinned": false\n}' }
    ]
  },
  {
    title: 'WhatsApp — Kişi işlemleri',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/profile', title: 'Profil getir', desc: 'Kişinin avatar + ismini çeker. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/block', title: 'Engelle / engel kaldır', desc: 'Kişiyi engeller/engeli kaldırır (block, varsayılan true).', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "block": true\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/blocklist', title: 'Engellenenler listesi', desc: 'Cihazın engellenen kişiler listesi. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/mynumber', title: 'Kendi numaram', desc: 'Cihazdaki hesabın kendi numarasını okur. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/contacts', title: 'Kişileri listele', desc: 'Hesabın rehberi (numara + isim). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 200\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/delete-message', title: 'Mesaj sil', desc: 'Bir mesajı siler. scope: me (bende) | everyone (herkesten). matchText ile eşleşen mesajı hedefler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "scope": "everyone",\n  "matchText": "silinecek metin"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/clear-chat', title: 'Sohbeti temizle', desc: 'Bir sohbetteki tüm yerel mesajları temizler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800"\n}' }
    ]
  },
  {
    title: 'WhatsApp — Root-DB Okuma',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/account-health', title: 'Hesap sağlığı', desc: 'Cihaz hesabının sağlığı: kayıtlı numara, WA sürümü, kayıt durumu. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/receipts', title: 'Teslim / okundu', desc: 'Bir sohbetteki mesajların teslim/okundu bilgisi (✓/✓✓/mavi), msgstore.db’den. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 50\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/unread', title: 'Okunmamışlar', desc: 'Okunmamış mesajı olan her sohbet + sayısı. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/search', title: 'Ara / arama', desc: 'Hesabın TÜM mesajlarında tam-metin arama (FTS). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "query": "merhaba",\n  "limit": 50\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/media', title: 'Medya listesi', desc: 'Sohbetteki (veya tüm) medya galerisi. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/calls', title: 'Arama kaydı', desc: 'Hesabın WhatsApp arama kaydı (sesli/görüntülü, gelen/giden/cevapsız). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/group-members', title: 'Grup üyeleri', desc: 'Bir grubun üyeleri (numara + admin). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "group": "Grup adı veya jid",\n  "limit": 200\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/chat-summary', title: 'Sohbet özeti', desc: 'Bir sohbetin toplam/gelen/giden/medya sayıları + ilk-son mesaj zamanı. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/deleted', title: 'Silinen mesajlar', desc: 'Karşı tarafın "herkesten sil" ile sildiği ama DB’de kalan mesajlar (anti-delete). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/links', title: 'Paylaşılan linkler', desc: 'Sohbetlerde paylaşılan URL’ler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/reactions', title: 'Emoji tepkileri', desc: 'Mesajlara verilen emoji tepkileri (isteğe bağlı tek sohbet). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/polls', title: 'Anketler', desc: 'Anketler (soru + seçenekler + oy sayıları). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 50\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/read-by', title: 'Kim okudu (read-by)', desc: 'Gönderdiğiniz mesajları kimin okuduğu (grupta hangi üyeler okudu). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/starred', title: 'Yıldızlı mesajlar', desc: 'Hesabın yıldızladığı (kaydettiği) mesajlar. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/labels-list', title: 'İş etiketleri (Business)', desc: 'WhatsApp Business etiketleri (isim/renk/sohbet sayısı). Sohbet kategorilerinden (/labels) ayrıdır. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/view-once', title: 'Tek görünümlük medya', desc: 'Tek-görünümlük (view-once) medyayı base64 çeker (root, UI açılmış saysa bile görür). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 20\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/voice-notes', title: 'Sesli notlar (PTT)', desc: 'Hesabın sesli notları. withAudio:false sadece meta (daha hızlı). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 20,\n  "withAudio": false\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/fetch-media', title: 'Medya indir (base64)', desc: 'İndirilmiş medyayı base64 olarak çeker. İndirilmemişse pending:true döner (cihazda şifreli blob var). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 10\n}' }
    ]
  },
  {
    title: 'Cihaz Kurma & WA Kayıt',
    endpoints: [
      { method: 'POST', path: '/public/v1/devices/provision', title: 'Cihaz kur (tek)', desc: 'Sıfırdan yeni bir cloud phone kurar (boot→root→kimlik→proxy→app→WA-hazır). {deviceId, jobId} döner. proxyCountry = numara alacağınız ülke (ISO-2). Üstteki "Canlı Dene" kutusuyla deneyebilirsiniz.', body: '{\n  "name": "yeni-cihaz",\n  "proxyCountry": "tr"\n}' },
      { method: 'POST', path: '/public/v1/devices/provision/batch', title: 'Cihaz kur (toplu, 1–20)', desc: 'Tek çağrıda çok cihaz kurar. count = adet (1–20), namePrefix = isim öneki (watest → watest-a3f…), proxyCountry = ülke. Hataya dayanıklı: host dolarsa başlayanlar started[] içinde, başarısızlar failed[] içinde döner. Her başlayan cihazın kendi {jobId, deviceId}’si vardır — durumu tek tek izleyin.', body: '{\n  "count": 3,\n  "namePrefix": "watest",\n  "proxyCountry": "tr"\n}' },
      { method: 'GET', path: '/public/v1/devices/provision/:jobId/status', title: 'Kurulum durumu (canlı)', desc: 'Kurulumun canlı ilerlemesi: phase (provisioning | ready | failed), percent, adım-adım log[] (her satır: adım + not + zaman), lastProgress ve başarısızsa error (hata sebebi). Poll edip panel modalı gibi canlı izleyin.' },
      { method: 'POST', path: '/public/v1/whatsapp/register', title: '1) WA kayıt başlat', desc: 'Kendi numaranızla otonom WhatsApp kaydı başlatır. Ajan SMS-kod ekranına kadar sürer ve DURUR (AWAITING_OTP). accountId döner — bunu status ve otp çağrılarında kullanın.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "phoneNumber": "905XXXXXXXXX"\n}' },
      { method: 'GET', path: '/public/v1/whatsapp/register/:id/status', title: '2) Kayıt durumu (poll → "kodu gir" der)', desc: 'Kaydın CANLI durumu. Poll edin: awaitingOtp:true olunca API "SMS kodunu gir" diyor (→ adım 3). awaitingMethod:true (otpChannel:method_select) olursa önce yöntem seçin (→ adım 2b). Alanlar: status, otpChannel (sms|other_phone|method_select|rate_limited), awaitingOtp, awaitingMethod, note (Türkçe açıklama), percent, log[].' },
      { method: 'POST', path: '/public/v1/whatsapp/register/:id/verify-method', title: '2b) Doğrulama yöntemi seç (modal gelirse)', desc: 'WhatsApp "nasıl doğrulansın" modalı geldiğinde (status awaitingMethod:true) yöntem seçer: sms | voice | missed_call. Ajan uygular, SMS adımına devam eder.', body: '{\n  "method": "sms"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/register/:id/otp', title: '3) OTP / SMS kodunu gir', desc: 'status awaitingOtp:true iken SMS kodunu buradan girin. Ajan kodu girer + profili tamamlar → hesap ACTIVE (veya kod yanlışsa tekrar AWAITING_OTP / FAILED). Çift-gönderime karşı korumalı.', body: '{\n  "otpCode": "123456"\n}' }
    ]
  },
  {
    title: 'İşler (Job sonucu)',
    endpoints: [
      { method: 'GET', path: '/public/v1/jobs/:jobId', title: 'Job sonucu', desc: 'Herhangi bir on-device işlemin sonucu. Cevap: status + result + ok (gerçekten başarılı mı?) + retryable (tekrar denemeye değer mi?) + warning (okunabilir Türkçe sebep, örn "Hesap KISITLI — yeni sohbet başlatamıyor").' },
      { method: 'GET', path: '/public/v1/jobs/:jobId/wait?timeout=30', title: 'Job sonucu — bekle (long-poll)', desc: 'İş bitene (veya timeout saniyesine) kadar bekler, sonucu TEK istekte döndürür. Poll döngüsü yerine bunu kullanın. Aynı ok/retryable/warning alanları gelir.' }
    ]
  }
];

const TOTAL = GROUPS.reduce((n, g) => n + g.endpoints.length, 0);

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="api-copy"
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}
      title="Kopyala"
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ── Canlı "Tek Tık Cihaz Oluştur" denemesi (GERÇEK PUBLIC API) ──────────────
// Panelin provision modalının API karşılığı — ama gerçek public uçlara, entegratörün
// yaşayacağı şekilde: kendi flk_ anahtarını gir → POST /public/v1/devices/provision
// (veya /provision/batch) çağrılır → her jobId'nin GET /provision/:id/status'ü poll
// edilerek canlı log + yüzde + hata gösterilir. x-api-key ile gider (BFF/JWT DEĞİL),
// yani tam olarak harici bir istemcinin gördüğü akış. Anahtar sadece tarayıcıda kalır.
type ProgressLine = { ts: string; step: string; note?: string; status: string };
type LiveJob = { jobId: string; deviceId: string; name: string; percent: number; phase: string; status: string; log: ProgressLine[]; error: string | null };

function lineColor(note?: string, status?: string): string {
  if (status === 'FAILED' || (note ?? '').startsWith('❌')) return '#f87171';
  if ((note ?? '').startsWith('✓')) return '#4ade80';
  if ((note ?? '').startsWith('⚠')) return '#fbbf24';
  return '#94a3b8';
}

function ProvisionTryIt({ baseUrl }: { baseUrl: string }) {
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  const [proxyCountry, setProxyCountry] = useState('tr');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keyRef = useRef(apiKey);
  keyRef.current = apiKey;

  // Poll every started job's status via the REAL public status endpoint (x-api-key)
  // until all are terminal (ready/failed).
  useEffect(() => {
    if (!jobs.length) return;
    const allDone = jobs.every((j) => j.phase === 'ready' || j.phase === 'failed');
    if (allDone) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      const updated = await Promise.all(jobs.map(async (j) => {
        if (j.phase === 'ready' || j.phase === 'failed') return j;
        try {
          const res = await fetch(`${baseUrl}/public/v1/devices/provision/${j.jobId}/status`, { headers: { 'x-api-key': keyRef.current } });
          const d = (await res.json())?.data;
          if (!d) return j;
          return { ...j, percent: d.percent ?? j.percent, phase: d.phase ?? j.phase, status: d.status ?? j.status, log: Array.isArray(d.log) ? d.log : j.log, error: d.error ?? null };
        } catch { return j; }
      }));
      setJobs(updated);
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs, baseUrl]);

  async function launch() {
    if (busy) return;
    if (!apiKey.trim()) { setErr('Önce API anahtarınızı (flk_…) girin.'); return; }
    setBusy(true); setErr(null); setJobs([]);
    try {
      const single = count <= 1;
      const url = single ? `${baseUrl}/public/v1/devices/provision` : `${baseUrl}/public/v1/devices/provision/batch`;
      const body = single
        ? { ...(name.trim() ? { name: name.trim() } : {}), ...(proxyCountry ? { proxyCountry } : {}) }
        : { count, ...(name.trim() ? { namePrefix: name.trim() } : {}), ...(proxyCountry ? { proxyCountry } : {}) };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim() }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      const d = j?.data;
      if (!res.ok || !d) { setErr((j && (j.message || j.error)) || `Kurulum başlatılamadı (HTTP ${res.status})`); return; }
      const started: LiveJob[] = single
        ? [{ jobId: d.jobId, deviceId: d.deviceId, name: d.instance ?? name ?? 'cihaz', percent: 3, phase: 'provisioning', status: 'PENDING', log: [], error: null }]
        : (d.started ?? []).map((s: { jobId: string; deviceId: string; name: string }) => ({ jobId: s.jobId, deviceId: s.deviceId, name: s.name, percent: 3, phase: 'provisioning', status: 'PENDING', log: [], error: null }));
      if (!started.length) { setErr('Hiç cihaz başlatılamadı (host dolu olabilir).'); return; }
      setJobs(started);
    } catch {
      setErr('Ağ hatası — kurulum başlatılamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="api-try">
      <label className="api-try-key">API anahtarı (x-api-key)
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="flk_…" autoComplete="off" />
      </label>
      <div className="api-try-form">
        <label>İsim / önek<input value={name} onChange={(e) => setName(e.target.value)} placeholder="watest (boş = rastgele)" /></label>
        <label>Adet<input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
        <label>Proxy ülke<input value={proxyCountry} onChange={(e) => setProxyCountry(e.target.value.toLowerCase().slice(0, 2))} placeholder="tr" /></label>
        <button className="api-try-btn" onClick={launch} disabled={busy}>
          {busy ? <><Loader2 size={15} className="spin" /> Başlatılıyor…</> : <><Rocket size={15} /> {count > 1 ? `${count} cihaz kur` : 'Cihaz kur'}</>}
        </button>
      </div>
      {err && <p className="api-try-err"><AlertTriangle size={14} /> {err}</p>}
      {jobs.length > 0 && (
        <div className="api-try-jobs">
          {jobs.map((j) => {
            const done = j.phase === 'ready' || j.percent >= 100;
            const failed = j.phase === 'failed';
            const bar = failed ? '#ef4444' : done ? '#22c55e' : 'var(--accent)';
            return (
              <div className="api-try-job" key={j.jobId}>
                <div className="api-try-job-head">
                  <span className="api-try-job-name">{j.name}</span>
                  <span className="api-try-job-pct">{failed ? 'Başarısız' : done ? '✓ Hazır' : `%${j.percent}`}</span>
                </div>
                <span className="api-try-bar"><span className="api-try-bar-fill" style={{ width: `${Math.min(100, j.percent)}%`, background: bar }} /></span>
                <div className="api-try-term">
                  <div className="api-try-term-head"><Terminal size={12} /> Canlı kurulum günlüğü</div>
                  <div className="api-try-term-body">
                    {j.log.length === 0 ? <span style={{ opacity: 0.5 }}>Kuruluma başlanıyor…</span> : j.log.map((l, i) => (
                      <div key={i} style={{ color: lineColor(l.note, l.status) }}><span style={{ opacity: 0.45 }}>{l.step}▸ </span>{l.note ?? l.step}</div>
                    ))}
                    {!done && !failed && <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="spin" /> çalışıyor…</div>}
                    {failed && j.error && <div style={{ color: '#f87171', marginTop: 4 }}>❌ {j.error}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EndpointCard({ ep, baseUrl }: { ep: Endpoint; baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const fullUrl = `${baseUrl}${ep.path}`;
  const curl = ep.method === 'GET'
    ? `curl "${fullUrl}" \\\n  -H "x-api-key: FLK_ANAHTARINIZ"`
    : `curl -X POST "${fullUrl}" \\\n  -H "x-api-key: FLK_ANAHTARINIZ" \\\n  -H "Content-Type: application/json" \\\n  -d '${(ep.body ?? '{}').replace(/\n\s*/g, ' ')}'`;
  return (
    <div className={`api-ep ${open ? 'is-open' : ''}`}>
      <button className="api-ep-head" onClick={() => setOpen((v) => !v)}>
        <span className={`api-m api-m-${ep.method.toLowerCase()}`}>{ep.method}</span>
        <span className="api-ep-path">{ep.path}</span>
        <span className="api-ep-title">{ep.title}</span>
        <ChevronRight size={15} className="api-ep-chev" />
      </button>
      {open && (
        <div className="api-ep-body">
          <p className="api-ep-desc">{ep.desc}</p>
          {ep.body && (
            <div className="api-code-block">
              <div className="api-code-head"><span>İstek gövdesi (JSON)</span><CopyBtn text={ep.body} /></div>
              <pre>{ep.body}</pre>
            </div>
          )}
          <div className="api-code-block">
            <div className="api-code-head"><span>cURL</span><CopyBtn text={curl} /></div>
            <pre>{curl}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApiDocsView() {
  const [q, setQ] = useState('');
  // The API is reachable at the same origin the dashboard is served from (Caddy
  // proxies /public/* to the API). Fall back to a placeholder during SSR.
  const [baseUrl] = useState<string>(() => (typeof window !== 'undefined' ? window.location.origin : 'https://alan-adiniz'));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return GROUPS;
    return GROUPS
      .map((g) => ({ ...g, endpoints: g.endpoints.filter((e) => (e.path + ' ' + e.title + ' ' + e.desc).toLowerCase().includes(s)) }))
      .filter((g) => g.endpoints.length > 0);
  }, [q]);

  return (
    <PageMotion>
      <HoloHeader
        eyebrow="GELİŞTİRİCİ"
        title="API Dokümantasyonu"
        subtitle={`WhatsApp Public API — ${TOTAL} uç nokta. x-api-key ile kimlik doğrulanır (JWT gerekmez).`}
      />

      <Reveal>
        <HoloPanel>
          <div className="api-intro">
            <div className="api-intro-text">
              <h3><KeyRound size={16} /> Başlarken</h3>
              <ol>
                <li><strong>Admin → API Anahtarları</strong>’ndan bir anahtar (<code>flk_…</code>) üretin.</li>
                <li>Her isteğe <code>x-api-key: flk_…</code> başlığını ekleyin.</li>
                <li>Kök adres: <code>{baseUrl}</code> — uçlar <code>/public/v1/…</code> altında.</li>
                <li>On-device işlemler (send, root-DB, kurulum, kayıt) hemen bir <code>jobId</code> döner; sonucu <code>/jobs/:id/wait</code> ile alın (<code>ok</code>, <code>retryable</code>, <code>warning</code> gelir).</li>
              </ol>
            </div>
            <a className="api-postman-btn" href="/fleet-whatsapp-api.postman_collection.json" download>
              <Download size={16} /> Postman koleksiyonunu indir
            </a>
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal>
        <HoloPanel title="Tek Tık Cihaz Oluştur — Canlı Dene" icon={<Rocket size={16} />}>
          <p className="api-try-intro">
            Gerçek <code>POST /public/v1/devices/provision</code> çağrısı. İsim, adet ve proxy ülkesi girin;
            kurulum <strong>canlı</strong> olarak adım-adım günlük + yüzde ile ilerler (panel modalının API karşılığı).
            İstek <code>x-api-key</code> ile gider — anahtarınız yalnızca tarayıcıda kalır.
          </p>
          <ProvisionTryIt baseUrl={baseUrl} />
        </HoloPanel>
      </Reveal>

      <div className="api-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Uç nokta ara (örn. send, etiket, thread)…" />
      </div>

      {filtered.map((g) => (
        <Reveal key={g.title}>
          <HoloPanel>
            <h2 className="api-group-title">{g.title}</h2>
            <div className="api-ep-list">
              {g.endpoints.map((ep) => <EndpointCard key={ep.method + ep.path} ep={ep} baseUrl={baseUrl} />)}
            </div>
          </HoloPanel>
        </Reveal>
      ))}
      {filtered.length === 0 && <HoloPanel><p style={{ opacity: 0.6, padding: '1rem' }}>“{q}” için uç nokta bulunamadı.</p></HoloPanel>}
    </PageMotion>
  );
}
