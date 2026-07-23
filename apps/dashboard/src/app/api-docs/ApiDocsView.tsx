'use client';

import { useMemo, useState } from 'react';
import { Download, Search, Copy, Check, KeyRound, ChevronRight } from 'lucide-react';
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
      { method: 'POST', path: '/public/v1/whatsapp/contacts', title: 'Kişileri listele', desc: 'Hesabın rehberi (numara + isim). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 200\n}' }
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
      { method: 'POST', path: '/public/v1/whatsapp/links', title: 'Paylaşılan linkler', desc: 'Sohbetlerde paylaşılan URL’ler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' }
    ]
  },
  {
    title: 'Cihaz Kurma & WA Kayıt',
    endpoints: [
      { method: 'POST', path: '/public/v1/devices/provision', title: 'Cihaz kur', desc: 'Sıfırdan yeni bir cloud phone kurar (boot→root→kimlik→proxy→app→WA-hazır). {deviceId, jobId} döner. proxyCountry = numara alacağınız ülke (ISO-2).', body: '{\n  "name": "yeni-cihaz",\n  "proxyCountry": "tr"\n}' },
      { method: 'GET', path: '/public/v1/devices/provision/:jobId/status', title: 'Kurulum durumu', desc: 'Kurulumun adım-adım ilerlemesi (mevcut adım, yüzde, log).' },
      { method: 'POST', path: '/public/v1/whatsapp/register', title: 'WA kayıt başlat', desc: 'Kendi numaranızla otonom WhatsApp kaydı başlatır. SMS-kod ekranında durur (AWAITING_OTP). accountId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "phoneNumber": "905XXXXXXXXX"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/register/:id/otp', title: 'OTP gönder', desc: 'SMS kodunu gönderir; ajan girer + profili tamamlar. Hesap ACTIVE (veya FAILED) olur.', body: '{\n  "otpCode": "123456"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/register/:id/verify-method', title: 'Doğrulama yöntemi seç', desc: 'Kayıt "nasıl doğrulansın" ekranında durduysa yöntem seçer: sms | voice | missed_call.', body: '{\n  "method": "sms"\n}' },
      { method: 'GET', path: '/public/v1/whatsapp/register/:id/status', title: 'Kayıt durumu', desc: 'Kaydın canlı ilerlemesi (adım, yüzde, log).' }
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
