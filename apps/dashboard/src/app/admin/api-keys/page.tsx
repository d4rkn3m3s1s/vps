'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check, Loader2, ShieldCheck, Activity, Ban, Sparkles, X, MessageCircle, Terminal, Play } from 'lucide-react';
import { HoloPanel, HoloStat, Reveal } from '../../../components/hud';

type ApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  scopes: string[];
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
};

const ALL_SCOPES = ['read', 'write', 'admin'] as const;

// Base URL the EXTERNAL API is reached at. The public endpoints live under
// /public on the same host the dashboard is served from (Caddy proxies /public/*
// to the API), so we reuse NEXT_PUBLIC_API_URL. Falls back to a placeholder if the
// env isn't set at build time.
const PUBLIC_API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_PUBLIC_URL || '').replace(/\/$/, '') ||
  'https://<sunucu-adresiniz>';

// A copyable code block for the curl examples.
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }
  return (
    <div className="api-doc-code">
      <button type="button" className="api-doc-copy" onClick={copy} aria-label="Kopyala">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre className="mono">{code}</pre>
    </div>
  );
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [busy, setBusy] = useState(false);
  // id of the key currently being revoked, so its row button disables + spins.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // The freshly created plaintext key — shown exactly once.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The workspace's dedicated documentation key (real, copy-pasteable). Minted
  // on first fetch by the API and embedded into every curl example below so the
  // user can copy-run them as-is. Falls back to the placeholder until loaded.
  const [docKey, setDocKey] = useState('flk_ANAHTARINIZ');

  // ── Canlı API test (playground) ──
  // Which input fields each endpoint needs, so the form + request are built
  // declaratively (label = the <select> text; needs = the fields to show).
  type EndpointKey =
    | 'devices' | 'conversations' | 'thread' | 'send' | 'messages'
    | 'labels' | 'createLabel' | 'setLabels' | 'state' | 'broadcast' | 'stats'
    | 'profile' | 'block' | 'blocklist'
    | 'sendMedia' | 'deleteMessage' | 'clearChat' | 'myNumber'
    | 'provision' | 'register' | 'registerOtp' | 'registerStatus';
  const [testKey, setTestKey] = useState('');
  const [testEndpoint, setTestEndpoint] = useState<EndpointKey>('devices');
  const [testDeviceId, setTestDeviceId] = useState('');
  const [testPeer, setTestPeer] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testLabelName, setTestLabelName] = useState('');
  const [testLabelIds, setTestLabelIds] = useState('');
  const [testFilter, setTestFilter] = useState('all');
  const [testPhone, setTestPhone] = useState('');
  const [testAccountId, setTestAccountId] = useState('');
  const [testOtp, setTestOtp] = useState('');
  const [testCountry, setTestCountry] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<number | null>(null);

  // Endpoint catalogue: label for the picker + which inputs to render.
  const ENDPOINTS: Record<EndpointKey, { label: string; needs: string[] }> = {
    devices:       { label: 'GET  /devices — cihazları listele', needs: [] },
    conversations: { label: 'GET  /whatsapp/conversations — sohbet listesi', needs: ['deviceId', 'filter'] },
    thread:        { label: 'GET  /whatsapp/thread — bir sohbetin mesajları', needs: ['deviceId', 'peer'] },
    messages:      { label: 'GET  /whatsapp/messages — tüm mesajlar', needs: ['deviceId'] },
    stats:         { label: 'GET  /whatsapp/stats — istatistik', needs: ['deviceId'] },
    labels:        { label: 'GET  /whatsapp/labels — kategorileri listele', needs: [] },
    send:          { label: 'POST /whatsapp/send — mesaj gönder (write)', needs: ['deviceId', 'to', 'message'] },
    createLabel:   { label: 'POST /whatsapp/labels — kategori oluştur (write)', needs: ['labelName'] },
    setLabels:     { label: 'POST /whatsapp/conversations/labels — sohbete etiket ata (write)', needs: ['deviceId', 'peer', 'labelIds'] },
    state:         { label: 'POST /whatsapp/conversations/state — favori/sabit (write)', needs: ['deviceId', 'peer'] },
    broadcast:     { label: 'POST /whatsapp/broadcast — toplu mesaj (write)', needs: ['deviceId', 'labelIds', 'message'] },
    profile:       { label: 'POST /whatsapp/profile — profil (avatar+ad) çek (write)', needs: ['deviceId', 'to'] },
    block:         { label: 'POST /whatsapp/block — kişi engelle/kaldır (write)', needs: ['deviceId', 'to'] },
    blocklist:     { label: 'POST /whatsapp/blocklist — engellenenler listesi (write)', needs: ['deviceId'] },
    sendMedia:     { label: 'POST /whatsapp/send-media — medya (foto/belge) gönder (write)', needs: ['deviceId', 'to', 'message'] },
    deleteMessage: { label: 'POST /whatsapp/delete-message — mesaj sil (write)', needs: ['deviceId', 'to'] },
    clearChat:     { label: 'POST /whatsapp/clear-chat — sohbeti temizle (write)', needs: ['deviceId', 'to'] },
    myNumber:      { label: 'POST /whatsapp/mynumber — kendi numarası (write)', needs: ['deviceId'] },
    provision:     { label: 'POST /devices/provision — tek tıkla cihaz oluştur (write)', needs: ['labelName', 'country'] },
    register:      { label: 'POST /whatsapp/register — tek tıkla WhatsApp kaydı (write)', needs: ['deviceId', 'phone'] },
    registerOtp:   { label: 'POST /whatsapp/register/:id/otp — SMS kodu gönder (write)', needs: ['accountId', 'otp'] },
    registerStatus:{ label: 'GET  /whatsapp/register/:id/status — kayıt durumu', needs: ['accountId'] }
  };
  const activeNeeds = ENDPOINTS[testEndpoint].needs;

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  // Build the {method, path, body} for the selected endpoint.
  function buildRequest(): { method: string; path: string; body?: Record<string, unknown> } {
    const dev = testDeviceId.trim();
    const peer = testPeer.replace(/[^\d]/g, '');
    const ids = testLabelIds.split(',').map((s) => s.trim()).filter(Boolean);
    switch (testEndpoint) {
      case 'devices':       return { method: 'GET', path: '/public/v1/devices' };
      case 'conversations': return { method: 'GET', path: `/public/v1/whatsapp/conversations?deviceId=${encodeURIComponent(dev)}&filter=${testFilter}&limit=20` };
      case 'thread':        return { method: 'GET', path: `/public/v1/whatsapp/thread?deviceId=${encodeURIComponent(dev)}&peer=${encodeURIComponent(peer)}&limit=30` };
      case 'messages':      return { method: 'GET', path: `/public/v1/whatsapp/messages?deviceId=${encodeURIComponent(dev)}&limit=20` };
      case 'stats':         return { method: 'GET', path: `/public/v1/whatsapp/stats?deviceId=${encodeURIComponent(dev)}&sinceHours=168` };
      case 'labels':        return { method: 'GET', path: '/public/v1/whatsapp/labels' };
      case 'send':          return { method: 'POST', path: '/public/v1/whatsapp/send', body: { deviceId: dev, to: testTo.replace(/[^\d]/g, ''), message: testMessage } };
      case 'createLabel':   return { method: 'POST', path: '/public/v1/whatsapp/labels', body: { name: testLabelName.trim(), color: 'emerald' } };
      case 'setLabels':     return { method: 'POST', path: '/public/v1/whatsapp/conversations/labels', body: { deviceId: dev, peer, labelIds: ids } };
      case 'state':         return { method: 'POST', path: '/public/v1/whatsapp/conversations/state', body: { deviceId: dev, peer, pinned: true, favorite: true } };
      case 'broadcast':     return { method: 'POST', path: '/public/v1/whatsapp/broadcast', body: { deviceId: dev, ...(ids[0] ? { labelId: ids[0] } : {}), message: testMessage } };
      case 'profile':       return { method: 'POST', path: '/public/v1/whatsapp/profile', body: { deviceId: dev, to: testTo.replace(/[^\d]/g, '') } };
      case 'block':         return { method: 'POST', path: '/public/v1/whatsapp/block', body: { deviceId: dev, to: testTo.replace(/[^\d]/g, ''), block: true } };
      case 'blocklist':     return { method: 'POST', path: '/public/v1/whatsapp/blocklist', body: { deviceId: dev } };
      case 'sendMedia':     return { method: 'POST', path: '/public/v1/whatsapp/send-media', body: { deviceId: dev, to: testTo.replace(/[^\d]/g, ''), mediaUrl: 'https://picsum.photos/600', caption: testMessage } };
      case 'deleteMessage': return { method: 'POST', path: '/public/v1/whatsapp/delete-message', body: { deviceId: dev, to: testTo.replace(/[^\d]/g, ''), scope: 'everyone' } };
      case 'clearChat':     return { method: 'POST', path: '/public/v1/whatsapp/clear-chat', body: { deviceId: dev, to: testTo.replace(/[^\d]/g, '') } };
      case 'myNumber':      return { method: 'POST', path: '/public/v1/whatsapp/mynumber', body: { deviceId: dev } };
      case 'provision':     return { method: 'POST', path: '/public/v1/devices/provision', body: { ...(testLabelName.trim() ? { name: testLabelName.trim() } : {}), ...(testCountry ? { countryCode: testCountry.toUpperCase(), proxyCountry: testCountry.toUpperCase() } : {}) } };
      case 'register':      return { method: 'POST', path: '/public/v1/whatsapp/register', body: { deviceId: dev, phoneNumber: testPhone.replace(/[^\d+]/g, '') } };
      case 'registerOtp':   return { method: 'POST', path: `/public/v1/whatsapp/register/${encodeURIComponent(testAccountId)}/otp`, body: { otpCode: testOtp.replace(/[^\d]/g, '') } };
      case 'registerStatus':return { method: 'GET', path: `/public/v1/whatsapp/register/${encodeURIComponent(testAccountId)}/status` };
    }
  }

  async function runTest() {
    if (!testKey.trim()) { setTestResult('Önce bir API anahtarı girin (flk_…).'); setTestStatus(null); return; }
    setTestBusy(true); setTestResult(null); setTestStatus(null);
    const { method, path, body } = buildRequest();
    try {
      const res = await fetch('/api/public-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, path, apiKey: testKey.trim(), body })
      });
      const json = await res.json();
      setTestStatus(json.status ?? res.status);
      setTestResult(JSON.stringify(json.data ?? json, null, 2));
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : 'İstek başarısız');
    } finally {
      setTestBusy(false);
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/api-keys');
      const json = await res.json();
      if (Array.isArray(json.data)) setKeys(json.data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  // Fetch (minting on first use) the workspace's documentation key so the curl
  // examples show a real, copy-pasteable key instead of a placeholder.
  async function loadDocKey() {
    try {
      const res = await fetch('/api/api-keys/doc-key');
      const json = await res.json();
      if (json.data?.plaintext) {
        const pk = json.data.plaintext as string;
        setDocKey(pk);
        // Prefill the live-test box with the doc key so examples run as-is —
        // but never clobber a key the user already typed.
        setTestKey((cur) => (cur.trim() ? cur : pk));
      }
    } catch {
      /* keep the placeholder */
    }
  }

  useEffect(() => {
    void load();
    void loadDocKey();
  }, []);

  function toggleScope(s: string) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: scopes.length ? scopes : ['read'] })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Anahtar oluşturulamadı');
      // API returns { key, plaintext }
      setRevealed(json.data?.plaintext ?? null);
      setName('');
      setScopes(['read']);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Anahtar oluşturulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKey) {
    if (revokingId) return; // guard against concurrent revokes
    if (!confirm(`"${key.name}" iptal edilsin mi? Bu anahtarı kullanan tüm çağrılar anında çalışmayı durduracaktır.`)) return;
    setRevokingId(key.id);
    try {
      const res = await fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'İptal edilemedi');
      }
      flash(`"${key.name}" iptal edildi`);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'İptal edilemedi');
    } finally {
      setRevokingId(null);
    }
  }

  async function copyKey() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked; user can select manually */
    }
  }

  const activeCount = keys.filter((k) => !k.revoked).length;
  const revokedCount = keys.filter((k) => k.revoked).length;
  const usedCount = keys.filter((k) => k.lastUsedAt).length;

  return (
    <section className="admin-stack">
      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Toplam anahtar" value={<span className="mono">{keys.length}</span>} tone="info" icon={<KeyRound size={15} />} />
          <HoloStat label="Aktif" value={<span className="mono">{activeCount}</span>} sub="çalışan anahtar" tone="success" icon={<ShieldCheck size={15} />} />
          <HoloStat label="Kullanımda" value={<span className="mono">{usedCount}</span>} sub="en az bir kez çağrıldı" tone="cyan" icon={<Activity size={15} />} />
          <HoloStat label="İptal edildi" value={<span className="mono">{revokedCount}</span>} tone={revokedCount > 0 ? 'warning' : 'violet'} icon={<Ban size={15} />} />
        </div>
      </Reveal>

      <div className="holo-grid-2">
        <Reveal delay={0.05}>
          <HoloPanel title="Etkin anahtarlar" icon={<KeyRound size={16} />}>
            <div className="panel-stack">
              {loading
                ? [0, 1, 2].map((i) => <div key={`sk-${i}`} className="skeleton skeleton-row" />)
                : null}
              {!loading && keys.length === 0 ? <p className="helper">Henüz API anahtarı yok.</p> : null}
              {keys.map((k) => (
                <div className="row alert-rule-row" key={k.id}>
                  <div>
                    <strong>{k.name}</strong>{' '}
                    {k.revoked ? <span className="status-chip"><span className="dot dot-error" />İptal edildi</span> : <span className="status-chip"><span className="dot dot-success" />Aktif</span>}
                    <div className="helper mono">
                      {k.maskedKey} · {k.scopes.join(', ')} ·{' '}
                      {k.lastUsedAt ? `son kullanım ${new Date(k.lastUsedAt).toLocaleDateString('tr-TR')}` : 'hiç kullanılmadı'}
                    </div>
                  </div>
                  {!k.revoked ? (
                    <button type="button" className="icon-btn" disabled={revokingId === k.id} onClick={() => revoke(k)} aria-label={`${k.name} anahtarını iptal et`} title="İptal et">
                      {revokingId === k.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {msg ? <p className="helper helper--note">{msg}</p> : null}
          </HoloPanel>
        </Reveal>

        <Reveal delay={0.1}>
          <HoloPanel title="Anahtar oluştur" icon={<Sparkles size={16} />} scan>
            <div className="admin-form">
              <div className="admin-field field">
                <label htmlFor="key-name">Ad</label>
                <input
                  id="key-name"
                  className="field-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="örn. CI hattı, Zapier"
                />
              </div>
              <div className="admin-field field">
                <label>Kapsamlar</label>
                <div className="scope-row">
                  {ALL_SCOPES.map((s) => (
                    <label key={s} className={`scope-chip${scopes.includes(s) ? ' scope-chip-on' : ''}`}>
                      <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
                <Plus size={15} /> {busy ? 'Oluşturuluyor…' : 'Anahtar oluştur'}
              </button>
            </div>
          </HoloPanel>
        </Reveal>
      </div>

      <Reveal delay={0.15}>
        <HoloPanel title="WhatsApp API — harici entegrasyon dokümanı" icon={<MessageCircle size={16} />}>
          {/* Overview */}
          <p className="helper" style={{ marginBottom: '0.6rem' }}>
            Bu API ile kendi sunucunuzdan / kodunuzdan cihazlarınızı listeleyebilir, WhatsApp mesajı
            gönderebilir, gelen/giden tüm sohbetleri WhatsApp-Web tarzı okuyabilir, sohbetleri
            kategorilere (etiketlere) ayırabilir, toplu mesaj atabilir ve istatistik alabilirsiniz.
            Telefonlardaki WhatsApp gerçek cihaz otomasyonuyla sürülür — resmi WhatsApp iş hesabı gerekmez.
          </p>

          <div className="api-doc-meta">
            <div><span className="api-doc-k">Temel URL</span><code className="mono">{PUBLIC_API_BASE}/public/v1</code></div>
            <div><span className="api-doc-k">Kimlik doğrulama</span><code className="mono">x-api-key: flk_…</code> başlığı (JWT yok)</div>
            <div><span className="api-doc-k">İçerik tipi</span><code className="mono">application/json</code></div>
            <div><span className="api-doc-k">Kapsam</span>okuma için herhangi bir anahtar · <strong>yazma (gönder/etiketle/toplu) için write</strong></div>
          </div>

          <div className="api-doc-callout">
            <ShieldCheck size={14} />
            <span>
              <strong>Önce bir anahtar oluşturun</strong> (yukarıdaki “Anahtar oluştur” panelinden, kapsam
              olarak <code className="mono">write</code> seçin). Anahtar bir kez gösterilir — güvenli saklayın.
              Servis (varsayılan) anahtarı bu uçlarda <strong>çalışmaz</strong>; çalışma alanına bağlı bir anahtar gerekir.
            </span>
          </div>

          {/* Endpoint index */}
          <div className="api-doc-index">
            <span className="api-doc-index-cat">Cihazlar</span>
            <span className="api-doc-verb api-doc-get">GET</span><code className="mono">/devices</code>
            <span className="api-doc-index-cat">Sohbetler</span>
            <span className="api-doc-verb api-doc-get">GET</span><code className="mono">/whatsapp/conversations</code>
            <span className="api-doc-verb api-doc-get">GET</span><code className="mono">/whatsapp/thread</code>
            <span className="api-doc-index-cat">Mesaj</span>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/send</code>
            <span className="api-doc-verb api-doc-get">GET</span><code className="mono">/whatsapp/messages</code>
            <span className="api-doc-index-cat">Kategoriler</span>
            <span className="api-doc-verb api-doc-get">GET</span><code className="mono">/whatsapp/labels</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/labels</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/conversations/labels</code>
            <span className="api-doc-index-cat">Sohbet durumu</span>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/conversations/state</code>
            <span className="api-doc-index-cat">Profil & Engelleme</span>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/profile</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/block</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/blocklist</code>
            <span className="api-doc-index-cat">Medya & Silme & Numara</span>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/send-media</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/delete-message</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/clear-chat</code>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/mynumber</code>
            <span className="api-doc-index-cat">Toplu & İstatistik</span>
            <span className="api-doc-verb api-doc-post">POST</span><code className="mono">/whatsapp/broadcast</code>
            <span className="api-doc-verb api-doc-get">GET</span><code className="mono">/whatsapp/stats</code>
          </div>

          {/* ── CİHAZLAR ── */}
          <div className="api-doc-cat">📱 Cihazlar</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/devices</code>
            </div>
            <p className="helper api-doc-desc">Çalışma alanınızdaki cihazları döndürür. Mesaj göndermek için buradan bir <code className="mono">id</code> seçin (yalnızca <code className="mono">ONLINE</code> cihazlar mesaj gönderebilir).</p>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/devices" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{\n  "data": [\n    { "id": "cmr3r9l8s00dwj5rsh1zi8wml", "name": "Telefon 01", "status": "ONLINE" },\n    { "id": "cmr3o72xh000kj5rs2bhpktin", "name": "Telefon 02", "status": "OFFLINE" }\n  ]\n}`} />
          </div>

          {/* ── SOHBETLER ── */}
          <div className="api-doc-cat">💬 Sohbetler</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/whatsapp/conversations</code>
            </div>
            <p className="helper api-doc-desc">Bir cihazın WhatsApp-Web tarzı sohbet listesi: her kişi için tek satır — son mesaj önizlemesi, okunmamış sayısı, etiketler, favori/sabit/arşiv durumu. 200+ sohbet için imleç (cursor) sayfalama.</p>
            <div className="api-doc-sub">Sorgu parametreleri</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — cihazın id’si</li>
              <li><code className="mono">filter</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">all</code> · <code className="mono">unread</code> · <code className="mono">favorite</code> · <code className="mono">archived</code></li>
              <li><code className="mono">labelId</code> <span className="api-doc-opt">opsiyonel</span> — yalnızca bu kategorideki sohbetler</li>
              <li><code className="mono">search</code> <span className="api-doc-opt">opsiyonel</span> — numara/isim araması</li>
              <li><code className="mono">limit</code> <span className="api-doc-opt">opsiyonel</span> — 1–100, varsayılan 40</li>
              <li><code className="mono">cursor</code> <span className="api-doc-opt">opsiyonel</span> — bir önceki yanıttaki <code className="mono">nextCursor</code> (sonraki sayfa)</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/whatsapp/conversations?deviceId=cmr3r9l8s00dwj5rsh1zi8wml&filter=unread&limit=20" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{\n  "data": {\n    "conversations": [\n      {\n        "peer": "905551112233",\n        "displayName": "Ahmet Yılmaz",\n        "lastMessageBody": "Tamamdır, teşekkürler",\n        "lastDirection": "IN",\n        "lastStatus": "DELIVERED",\n        "lastMessageAt": "2026-07-05T09:41:00.000Z",\n        "unreadCount": 2,\n        "favorite": false,\n        "archived": false,\n        "pinned": true,\n        "labelIds": ["cmr7lbl0001"]\n      }\n    ],\n    "nextCursor": "2026-07-05T09:12:00.000Z"\n  }\n}`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/whatsapp/thread</code>
            </div>
            <p className="helper api-doc-desc">Tek bir kişiyle olan sohbetin mesaj geçmişi (eskiden yeniye). Yukarı kaydırma için <code className="mono">before</code> imleciyle sayfalama. Her giden mesajda teslim durumu (<code className="mono">status</code>) döner.</p>
            <div className="api-doc-sub">Sorgu parametreleri</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — cihazın id’si</li>
              <li><code className="mono">peer</code> <span className="api-doc-req">zorunlu</span> — kişi numarası (conversations’taki <code className="mono">peer</code>)</li>
              <li><code className="mono">limit</code> <span className="api-doc-opt">opsiyonel</span> — 1–200, varsayılan 50</li>
              <li><code className="mono">before</code> <span className="api-doc-opt">opsiyonel</span> — bir önceki yanıttaki <code className="mono">nextBefore</code> (daha eski mesajlar)</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/whatsapp/thread?deviceId=cmr3r9l8s00dwj5rsh1zi8wml&peer=905551112233&limit=50" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{\n  "data": {\n    "messages": [\n      {\n        "id": "cmr6fuxiy002c7mr4twaxswrv",\n        "direction": "OUT",\n        "peer": "905551112233",\n        "body": "Merhaba! Nasıl yardımcı olabilirim?",\n        "status": "READ",\n        "failReason": null,\n        "waTimestamp": "2026-07-05T09:40:00.000Z",\n        "createdAt": "2026-07-05T09:40:00.000Z"\n      }\n    ],\n    "nextBefore": null\n  }\n}`} />
            <p className="helper api-doc-note"><code className="mono">status</code>: <code className="mono">QUEUED</code> → <code className="mono">SENT</code> → <code className="mono">DELIVERED</code> → <code className="mono">READ</code>, veya <code className="mono">FAILED</code> (o zaman <code className="mono">failReason</code> dolu olur).</p>
          </div>

          {/* ── MESAJ ── */}
          <div className="api-doc-cat">✉️ Mesaj</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/send</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Seçili cihazdan bir WhatsApp mesajı gönderir (alıcı rehberde kayıtlı olmasa da çalışır). Anında bir <code className="mono">jobId</code> döner; mesaj birkaç saniye içinde cihazda gönderilir.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — cihazın id’si</li>
              <li><code className="mono">to</code> <span className="api-doc-req">zorunlu</span> — alıcı numara, ülke koduyla, + ve boşluksuz (örn. <code className="mono">905551112233</code>)</li>
              <li><code className="mono">message</code> <span className="api-doc-req">zorunlu</span> — mesaj metni (1–4096 karakter)</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/send" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "to": "905551112233",\n    "message": "Merhaba! Bu bir test mesajidir."\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr6fu2wk001o7mr4c0p6py3u", "status": "PENDING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/whatsapp/messages</code>
            </div>
            <p className="helper api-doc-desc">Bir cihazın tüm kayıtlı WhatsApp mesajlarını (kişiye göre gruplamadan, en yeniden eskiye) döndürür. Sohbet bazlı görünüm için <code className="mono">/thread</code> kullanın.</p>
            <div className="api-doc-sub">Sorgu parametreleri</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — cihazın id’si</li>
              <li><code className="mono">limit</code> <span className="api-doc-opt">opsiyonel</span> — 1–500, varsayılan 100</li>
              <li><code className="mono">direction</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">IN</code> / <code className="mono">OUT</code></li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/whatsapp/messages?deviceId=cmr3r9l8s00dwj5rsh1zi8wml&limit=50&direction=IN" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{\n  "data": {\n    "messages": [\n      { "id": "cmr6...", "deviceId": "cmr3...", "direction": "OUT",\n        "peer": "905551112233", "body": "…",\n        "waTimestamp": "2026-07-04T14:09:27.610Z",\n        "createdAt": "2026-07-04T14:09:27.610Z" }\n    ]\n  }\n}`} />
          </div>

          {/* ── KATEGORİLER ── */}
          <div className="api-doc-cat">🏷 Kategoriler (etiketler)</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/whatsapp/labels</code>
            </div>
            <p className="helper api-doc-desc">Çalışma alanınızın sohbet kategorilerini (etiketlerini) döndürür. Her etiketin bir <code className="mono">id</code>, adı ve renk anahtarı vardır.</p>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/whatsapp/labels" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "labels": [\n  { "id": "cmr7lbl0001", "name": "Müşteri", "color": "emerald" },\n  { "id": "cmr7lbl0002", "name": "Satış",   "color": "sky" }\n] } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/labels</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Yeni bir kategori (etiket) oluşturur.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">name</code> <span className="api-doc-req">zorunlu</span> — etiket adı (1–40 karakter)</li>
              <li><code className="mono">color</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">slate·emerald·sky·violet·amber·rose·cyan·lime</code> (varsayılan slate)</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/labels" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{ "name": "VIP", "color": "amber" }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>201 Created</span></div>
            <CodeBlock code={`{ "data": { "id": "cmr7lbl0009", "name": "VIP", "color": "amber" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/conversations/labels</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir sohbetin kategori setini <strong>tamamen değiştirir</strong> (gönderdiğiniz liste ne ise o olur; boş liste tüm etiketleri kaldırır).</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span></li>
              <li><code className="mono">peer</code> <span className="api-doc-req">zorunlu</span> — kişi numarası</li>
              <li><code className="mono">labelIds</code> <span className="api-doc-req">zorunlu</span> — etiket id dizisi (en fazla 20)</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/conversations/labels" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "peer": "905551112233",\n    "labelIds": ["cmr7lbl0001", "cmr7lbl0009"]\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "ok": true } }`} />
          </div>

          {/* ── SOHBET DURUMU ── */}
          <div className="api-doc-cat">⭐ Sohbet durumu</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/conversations/state</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir sohbeti favori / arşiv / sabit (pin) yapar. Yalnızca gönderdiğiniz alanlar değişir.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> · <code className="mono">peer</code> <span className="api-doc-req">zorunlu</span></li>
              <li><code className="mono">favorite</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">true/false</code></li>
              <li><code className="mono">archived</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">true/false</code></li>
              <li><code className="mono">pinned</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">true/false</code></li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/conversations/state" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "peer": "905551112233",\n    "pinned": true, "favorite": true\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "ok": true } }`} />
          </div>

          {/* ── PROFİL & ENGELLEME ── */}
          <div className="api-doc-cat">📷 Profil & 🚫 Engelleme</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/profile</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir kişinin WhatsApp profilini cihazdan çeker: profil fotoğrafı (avatar) + görünen ad/durum bilgisi. Cihazda çalışan bir iş başlatır (~15sn); anında bir <code className="mono">jobId</code> döner. Sonuç (avatar + profil) hazır olduğunda ilgili sohbete işlenir — sohbet listesinden veya panelden görüntüleyin.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
              <li><code className="mono">to</code> <span className="api-doc-opt">opsiyonel</span> — telefon numarası (ülke kodlu, + olmadan). <code className="mono">to</code> veya <code className="mono">from</code>&apos;dan biri gerekli.</li>
              <li><code className="mono">from</code> <span className="api-doc-opt">opsiyonel</span> — kişi adı (rehberde kayıtlıysa).</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/profile" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "to": "905551112233"\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr8xz...", "status": "PENDING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/block</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir kişiyi cihaz üzerinden engeller veya engelini kaldırır. <code className="mono">block</code> alanı verilmezse varsayılan <b>engelle</b>dir. Cihazda çalışan bir iş başlatır; sohbetin engel durumu iş tamamlanınca güncellenir.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
              <li><code className="mono">to</code> <span className="api-doc-opt">opsiyonel</span> — telefon numarası. <code className="mono">to</code> veya <code className="mono">from</code>&apos;dan biri gerekli.</li>
              <li><code className="mono">from</code> <span className="api-doc-opt">opsiyonel</span> — kişi adı.</li>
              <li><code className="mono">block</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">true</code> engelle (varsayılan), <code className="mono">false</code> engeli kaldır.</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/block" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "to": "905551112233",\n    "block": true\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr8yb...", "status": "PENDING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/blocklist</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Cihazın WhatsApp Ayarlar &rsaquo; Gizlilik &rsaquo; Engellenenler listesini okur. Cihazda çalışan bir iş başlatır; taranan liste iş sonucuna düşer. Engel işaretli sohbetler ayrıca sohbet listesinde <code className="mono">blocked: true</code> ile döner.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/blocklist" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{ "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml" }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr8zc...", "status": "PENDING" } }`} />
          </div>

          {/* ── MEDYA & SİLME & NUMARA ── */}
          <div className="api-doc-cat">📎 Medya · 🗑 Silme · 📞 Numara</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/send-media</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir kişiye fotoğraf veya belge gönderir. Medya, herkese açık bir <code className="mono">mediaUrl</code>&apos;den indirilip cihaza yüklenir, sonra WhatsApp&apos;ta gönderilir. İsteğe bağlı bir <code className="mono">caption</code> (açıklama) eklenebilir.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
              <li><code className="mono">to</code> <span className="api-doc-req">zorunlu</span> — telefon numarası (ülke kodlu).</li>
              <li><code className="mono">mediaUrl</code> <span className="api-doc-req">zorunlu</span> — herkese açık medya URL&apos;i (görsel/belge).</li>
              <li><code className="mono">caption</code> <span className="api-doc-opt">opsiyonel</span> — açıklama metni.</li>
              <li><code className="mono">kind</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">image</code> (varsayılan) veya <code className="mono">document</code>.</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/send-media" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "to": "905551112233",\n    "mediaUrl": "https://ornek.com/resim.jpg",\n    "caption": "Merhaba!"\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr9aa...", "status": "PENDING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/delete-message</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir mesajı siler: <b>kendinden</b> (<code className="mono">scope: &quot;me&quot;</code>) veya <b>herkesten</b> (<code className="mono">scope: &quot;everyone&quot;</code>, geri çek). Belirli bir mesajı hedeflemek için <code className="mono">matchText</code> verin; verilmezse son giden mesaj silinir.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
              <li><code className="mono">to</code> <span className="api-doc-req">zorunlu</span> — sohbetteki kişinin numarası.</li>
              <li><code className="mono">scope</code> <span className="api-doc-opt">opsiyonel</span> — <code className="mono">everyone</code> (varsayılan, herkesten) veya <code className="mono">me</code> (kendinden).</li>
              <li><code className="mono">matchText</code> <span className="api-doc-opt">opsiyonel</span> — silinecek mesajın içeriğinden bir parça.</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/delete-message" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "to": "905551112233",\n    "scope": "everyone"\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr9bb...", "status": "PENDING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/clear-chat</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir sohbetteki tüm yerel mesajları temizler (cihazdaki geçmişi siler; karşı taraftan silmez).</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
              <li><code className="mono">to</code> <span className="api-doc-req">zorunlu</span> — sohbetteki kişinin numarası.</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/clear-chat" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "to": "905551112233"\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr9cc...", "status": "PENDING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/mynumber</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Cihazdaki hesabın <b>kendi</b> WhatsApp numarasını okur (Ayarlar &rsaquo; profil satırı). Numara iş sonucuna düşer; <code className="mono">jobId</code> ile sorgulayın.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — hedef cihaz.</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/mynumber" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{ "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml" }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "jobId": "cmr9dd...", "status": "PENDING" } }`} />
          </div>

          {/* ── OTONOM KURULUM & KAYIT ── */}
          <div className="api-doc-cat">🤖 Tek tıkla cihaz & WhatsApp otonom kayıt</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/devices/provision</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Sıfırdan izole bir bulut telefon kurar (boot → root → benzersiz kimlik → proxy → uygulamalar → WhatsApp-hazır). Panelin <b>&quot;Tek Tıkla Cihaz Oluştur&quot;</b> akışının API karşılığı. Asenkron: hemen <code className="mono">deviceId</code>+<code className="mono">jobId</code> döner; cihaz online olana kadar (~2-5 dk) <code className="mono">GET /v1/devices</code> ile izleyin.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">name</code> <span className="api-doc-opt">opsiyonel</span> — cihaz adı.</li>
              <li><code className="mono">countryCode</code> <span className="api-doc-opt">opsiyonel</span> — parmak izi ülkesi (ISO-2).</li>
              <li><code className="mono">deviceModel</code>, <code className="mono">androidVersion</code> <span className="api-doc-opt">opsiyonel</span> — katalog modeli / Android sürümü.</li>
              <li><code className="mono">proxyCountry</code> <span className="api-doc-opt">opsiyonel</span> — ülke-eşleşmeli residential proxy (WhatsApp için numara-ülkesi = çıkış-IP ülkesi ŞART).</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/devices/provision" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{ "name": "Bot-01", "countryCode": "US", "proxyCountry": "US" }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>201</span></div>
            <CodeBlock code={`{ "data": { "deviceId": "cmr9...", "jobId": "cmr9...", "instance": "mi8", "status": "PROVISIONING" } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/register</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Bir cihazda <b>kendi numaranızla</b> otonom WhatsApp kaydı başlatır. Ajan izinleri verir, EULA&apos;yı geçer, numarayı girer ve <b>SMS kodu ekranında durur</b> (<code className="mono">status</code> = <code className="mono">AWAITING_OTP</code>). Numaranın ülkesine göre proxy otomatik atanır. Cihaz durdurulmuş/aracısı kopuksa <b>anında</b> <code className="mono">409</code> döner (sonsuza kadar beklemez).</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> — çevrimiçi + aracısı canlı cihaz.</li>
              <li><code className="mono">phoneNumber</code> <span className="api-doc-req">zorunlu</span> — ülke kodu dahil (örn. <code className="mono">+15551234567</code>).</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/register" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{ "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml", "phoneNumber": "+15551234567" }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>201</span></div>
            <CodeBlock code={`{ "data": { "accountId": "cmr9...", "deviceId": "cmr3...", "phoneNumber": "+15551234567", "status": "REGISTERING", "proxyAssigned": { "country": "US" } } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/register/:id/otp</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc"><code className="mono">:id</code> = kayıt yanıtındaki <code className="mono">accountId</code>. SMS kodunu ajana iletir; ajan girip profili tamamlar. Hesap <code className="mono">ACTIVE</code> (başarılı) veya <code className="mono">FAILED</code> olur.</p>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/register/cmr9.../otp" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{ "otpCode": "123456" }'`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/whatsapp/register/:id/status</code>
            </div>
            <p className="helper api-doc-desc"><code className="mono">:id</code> = <code className="mono">accountId</code>. Canlı adım-adım ilerleme (mevcut adım, yüzde, tüm adım günlüğü). Kaydı takip etmek için birkaç saniyede bir yoklayın; <code className="mono">status</code> <code className="mono">AWAITING_OTP</code> olunca kodu gönderin, <code className="mono">ACTIVE</code>/<code className="mono">FAILED</code> olunca durun.</p>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/whatsapp/register/cmr9.../status" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": { "accountId": "cmr9...", "status": "AWAITING_OTP", "lastProgress": { "step": "otp_wait", "percent": 85, "note": "SMS kodu bekleniyor" }, "log": [ ... ] } }`} />
          </div>

          {/* ── TOPLU & İSTATİSTİK ── */}
          <div className="api-doc-cat">📣 Toplu mesaj & 📈 istatistik</div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-post">POST</span>
              <code className="mono">/public/v1/whatsapp/broadcast</code>
              <span className="api-doc-scope">write</span>
            </div>
            <p className="helper api-doc-desc">Aynı mesajı birçok kişiye gönderir. Alıcılar bir numara listesiyle veya bir <strong>etikete</strong> göre (o kategorideki tüm sohbetler) belirlenir. Ban riskini azaltmak için mesajlar arasına rastgele gecikme (6–20 sn) konur — arka planda ilerler.</p>
            <div className="api-doc-sub">Gövde alanları</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-req">zorunlu</span> · <code className="mono">message</code> <span className="api-doc-req">zorunlu</span></li>
              <li><code className="mono">peers</code> <span className="api-doc-opt">peers veya labelId</span> — numara dizisi (en fazla 1000)</li>
              <li><code className="mono">labelId</code> <span className="api-doc-opt">peers veya labelId</span> — bu kategorideki herkese gönder</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s -X POST "${PUBLIC_API_BASE}/public/v1/whatsapp/broadcast" \\\n  -H "x-api-key: ${docKey}" \\\n  -H "content-type: application/json" \\\n  -d '{\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "labelId": "cmr7lbl0001",\n    "message": "Kampanya: bugün %20 indirim!"\n  }'`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>201 Created</span></div>
            <CodeBlock code={`{ "data": { "id": "cmr7bc00001", "total": 42 } }`} />
          </div>

          <div className="api-doc-block">
            <div className="api-doc-title">
              <span className="api-doc-verb api-doc-get">GET</span>
              <code className="mono">/public/v1/whatsapp/stats</code>
            </div>
            <p className="helper api-doc-desc">Belirtilen zaman aralığında mesajlaşma özeti: gelen/giden/başarısız sayısı, açık (okunmamış) sohbet sayısı ve ortalama ilk yanıt süresi (dakika).</p>
            <div className="api-doc-sub">Sorgu parametreleri</div>
            <ul className="api-doc-params">
              <li><code className="mono">deviceId</code> <span className="api-doc-opt">opsiyonel</span> — belirtilmezse tüm cihazlar</li>
              <li><code className="mono">sinceHours</code> <span className="api-doc-opt">opsiyonel</span> — kaç saat geriye (1–720, varsayılan 24)</li>
            </ul>
            <div className="api-doc-sub">İstek</div>
            <CodeBlock code={`curl -s "${PUBLIC_API_BASE}/public/v1/whatsapp/stats?deviceId=cmr3r9l8s00dwj5rsh1zi8wml&sinceHours=168" \\\n  -H "x-api-key: ${docKey}"`} />
            <div className="api-doc-sub">Yanıt <span className="mono" style={{ opacity: 0.6 }}>200 OK</span></div>
            <CodeBlock code={`{ "data": {\n  "inbound": 128, "outbound": 210, "failed": 3,\n  "openThreads": 12, "avgResponseMinutes": 7\n} }`} />
          </div>

          {/* ── WEBHOOK ── */}
          <div className="api-doc-cat">🔔 Webhook (anlık bildirim)</div>

          <div className="api-doc-block">
            <p className="helper api-doc-desc">Sürekli sorgulamak yerine, <strong>Webhooks</strong> sayfasından olaylara abone olun; her olay kendi URL’nize POST edilir. Desteklenen WhatsApp olayları:</p>
            <ul className="api-doc-params">
              <li><code className="mono">WHATSAPP_MESSAGE</code> — yeni <strong>gelen</strong> mesaj</li>
              <li><code className="mono">WHATSAPP_SENT</code> — <strong>giden</strong> mesaj cihazda gönderildi</li>
              <li><code className="mono">WHATSAPP_FAILED</code> — giden mesaj gönderilemedi (<code className="mono">failReason</code> ile)</li>
            </ul>
            <CodeBlock code={`POST https://sizin-sunucunuz.com/webhook\ncontent-type: application/json\n\n{\n  "event": "WHATSAPP_MESSAGE",\n  "data": {\n    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",\n    "direction": "IN",\n    "peer": "905551112233",\n    "body": "gelen mesaj metni",\n    "waTimestamp": "2026-07-05T14:09:23.445Z"\n  }\n}`} />
          </div>

          {/* Errors */}
          <div className="api-doc-block">
            <div className="api-doc-title"><Ban size={13} /> Hata kodları</div>
            <ul className="api-doc-errors">
              <li><code className="mono">401</code> <strong>UNAUTHORIZED</strong> — <code className="mono">x-api-key</code> eksik veya geçersiz/iptal edilmiş</li>
              <li><code className="mono">403</code> <strong>WORKSPACE_REQUIRED</strong> — servis (varsayılan) anahtarı kullanıldı; çalışma alanına bağlı anahtar gerekli</li>
              <li><code className="mono">403</code> <strong>INSUFFICIENT_SCOPE</strong> — yazma işlemi için anahtarda <code className="mono">write</code> kapsamı yok</li>
              <li><code className="mono">404</code> <strong>DEVICE_NOT_FOUND</strong> — cihaz sizin çalışma alanınızda değil</li>
              <li><code className="mono">400</code> <strong>doğrulama hatası</strong> — eksik/geçersiz alan</li>
              <li><code className="mono">429</code> — çok fazla istek (hız sınırı); biraz bekleyip tekrar deneyin</li>
            </ul>
          </div>

          <p className="helper" style={{ opacity: 0.7 }}>
            Tüm uçlar yalnızca kendi çalışma alanınızın cihaz ve mesajlarına erişir — anahtarınız
            başka bir kiracının verisini <strong>asla</strong> göremez.
          </p>
        </HoloPanel>
      </Reveal>

      {/* Canlı API test playground */}
      <Reveal delay={0.2}>
        <HoloPanel title="Canlı API Test" icon={<Play size={16} />} scan>
          <p className="helper" style={{ marginBottom: '0.9rem' }}>
            API anahtarınızı yapıştırın, bir uç seçin ve <strong>Çalıştır</strong>’a basın — gerçek istek
            gönderilir, yanıt aşağıda görünür. (Anahtar tarayıcıda saklanmaz, yalnızca bu istekte kullanılır.)
          </p>

          <div className="api-test-form">
            <label className="field">
              <span>API anahtarı (flk_…)</span>
              <input
                className="field-input mono"
                placeholder="flk_..."
                value={testKey}
                onChange={(e) => setTestKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>Uç nokta</span>
              <select className="field-input" value={testEndpoint} onChange={(e) => setTestEndpoint(e.target.value as EndpointKey)}>
                {(Object.keys(ENDPOINTS) as EndpointKey[]).map((k) => (
                  <option key={k} value={k}>{ENDPOINTS[k].label}</option>
                ))}
              </select>
            </label>

            {activeNeeds.includes('deviceId') ? (
              <label className="field">
                <span>Cihaz ID</span>
                <input className="field-input mono" placeholder="cmr3r9l8s00dwj5rsh1zi8wml" value={testDeviceId} onChange={(e) => setTestDeviceId(e.target.value)} />
              </label>
            ) : null}

            {activeNeeds.includes('peer') ? (
              <label className="field">
                <span>Kişi numarası (peer)</span>
                <input className="field-input mono" placeholder="905551112233" value={testPeer} onChange={(e) => setTestPeer(e.target.value)} inputMode="tel" />
              </label>
            ) : null}

            {activeNeeds.includes('filter') ? (
              <label className="field">
                <span>Filtre</span>
                <select className="field-input" value={testFilter} onChange={(e) => setTestFilter(e.target.value)}>
                  <option value="all">Tümü</option>
                  <option value="unread">Okunmamış</option>
                  <option value="favorite">Favori</option>
                  <option value="archived">Arşiv</option>
                </select>
              </label>
            ) : null}

            {activeNeeds.includes('to') ? (
              <label className="field">
                <span>Alıcı numara (ülke kodu ile)</span>
                <input className="field-input" placeholder="905551112233" value={testTo} onChange={(e) => setTestTo(e.target.value)} inputMode="tel" />
              </label>
            ) : null}

            {activeNeeds.includes('labelName') ? (
              <label className="field">
                <span>{testEndpoint === 'provision' ? 'Cihaz adı (opsiyonel)' : 'Etiket adı'}</span>
                <input className="field-input" placeholder={testEndpoint === 'provision' ? 'Bot-01' : 'VIP'} value={testLabelName} onChange={(e) => setTestLabelName(e.target.value)} />
              </label>
            ) : null}

            {activeNeeds.includes('country') ? (
              <label className="field">
                <span>Ülke kodu (ISO-2, opsiyonel — proxy + parmak izi)</span>
                <input className="field-input mono" placeholder="US" maxLength={2} value={testCountry} onChange={(e) => setTestCountry(e.target.value)} />
              </label>
            ) : null}

            {activeNeeds.includes('phone') ? (
              <label className="field">
                <span>Telefon numarası (ülke kodu dahil)</span>
                <input className="field-input mono" placeholder="+15551234567" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} inputMode="tel" />
              </label>
            ) : null}

            {activeNeeds.includes('accountId') ? (
              <label className="field">
                <span>accountId (kayıt yanıtından)</span>
                <input className="field-input mono" placeholder="cmr9..." value={testAccountId} onChange={(e) => setTestAccountId(e.target.value)} />
              </label>
            ) : null}

            {activeNeeds.includes('otp') ? (
              <label className="field">
                <span>SMS kodu</span>
                <input className="field-input mono" placeholder="123456" maxLength={8} value={testOtp} onChange={(e) => setTestOtp(e.target.value)} inputMode="numeric" />
              </label>
            ) : null}

            {activeNeeds.includes('labelIds') ? (
              <label className="field">
                <span>{testEndpoint === 'broadcast' ? 'Hedef etiket id (kategori)' : 'Etiket id’leri (virgülle)'}</span>
                <input className="field-input mono" placeholder="cmr7lbl0001, cmr7lbl0009" value={testLabelIds} onChange={(e) => setTestLabelIds(e.target.value)} />
              </label>
            ) : null}

            {activeNeeds.includes('message') ? (
              <label className="field">
                <span>Mesaj</span>
                <input className="field-input" placeholder="Merhaba" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} />
              </label>
            ) : null}

            <button type="button" className="btn-primary" onClick={runTest} disabled={testBusy}>
              {testBusy ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {testBusy ? 'Gönderiliyor…' : 'Çalıştır'}
            </button>
          </div>

          {testResult !== null ? (
            <div className="api-test-result">
              {testStatus !== null ? (
                <div className={`api-test-status ${testStatus >= 200 && testStatus < 300 ? 'ok' : 'err'}`}>
                  HTTP {testStatus} {testStatus >= 200 && testStatus < 300 ? '· Başarılı' : '· Hata'}
                </div>
              ) : null}
              <pre className="mono">{testResult}</pre>
            </div>
          ) : null}
        </HoloPanel>
      </Reveal>

      {revealed ? (
        <div className="modal-overlay" onClick={() => setRevealed(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><KeyRound size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Yeni API anahtarınız</h2>
              <button type="button" className="modal-close" onClick={() => setRevealed(null)} aria-label="Kapat">
                <X size={16} />
              </button>
            </header>
            <p className="helper">
              Bunu şimdi kopyalayın — tekrar <strong>gösterilmeyecek</strong>. Kaybederseniz, iptal edip yeni bir tane oluşturun.
            </p>
            <div className="key-reveal">
              <code className="mono">{revealed}</code>
              <button type="button" className="btn-ghost" onClick={copyKey}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Kopyalandı' : 'Kopyala'}
              </button>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-primary" onClick={() => setRevealed(null)}>
                Tamam
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
