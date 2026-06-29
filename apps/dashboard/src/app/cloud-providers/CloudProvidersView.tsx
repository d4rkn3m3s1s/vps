'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cloud, Plus, X, Plug, RefreshCw, Trash2, CheckCircle2, AlertTriangle, Boxes } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';

export type Provider = {
  id: string;
  name: string;
  kind: 'SELF' | 'GEELARK' | 'VMOS' | 'DUOPLUS' | 'UGPHONE';
  baseUrl: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckMsg: string | null;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

// Vendor catalogue shown in the "add" modal. `ready` marks which adapters are
// implemented today (GeeLark, VMOS); the rest can be saved but show "yakında".
// Per-vendor field hints. apiKeyLabel / apiSecretLabel tell the operator exactly
// which credential goes where (the adapters map apiKey + apiSecret per their auth
// scheme — see each adapter's header comment).
const KINDS: Array<{
  kind: Provider['kind']; label: string; ready: boolean; note: string;
  needsSecret: boolean; apiKeyLabel: string; apiSecretLabel: string;
}> = [
  {
    kind: 'GEELARK', label: 'GeeLark', ready: true,
    note: 'Native ARM · API + white-label · sosyal medya/otomasyon. Anahtarları GeeLark → Geliştirici → API menüsünden alın.',
    needsSecret: true, apiKeyLabel: 'API Key (TeamApiKey)', apiSecretLabel: 'App ID (TeamAppId)'
  },
  {
    kind: 'VMOS', label: 'VMOS Cloud', ready: true,
    note: 'Native ARM · resmi API · Android 15, anti-detect. AccessKey/SecretKey: VMOS → Developer → API.',
    needsSecret: true, apiKeyLabel: 'Access Key', apiSecretLabel: 'Secret Key'
  },
  { kind: 'DUOPLUS', label: 'DuoPlus', ready: false, note: 'Gerçek ARM cihaz · TikTok matrix (adapter yakında)', needsSecret: false, apiKeyLabel: 'API Key', apiSecretLabel: 'API Secret' },
  { kind: 'UGPHONE', label: 'UGPhone', ready: false, note: 'Native ARM · global node (adapter yakında)', needsSecret: false, apiKeyLabel: 'API Key', apiSecretLabel: 'API Secret' }
];

const KIND_LABEL: Record<Provider['kind'], string> = {
  SELF: 'Kendi Filomuz', GEELARK: 'GeeLark', VMOS: 'VMOS Cloud', DUOPLUS: 'DuoPlus', UGPHONE: 'UGPhone'
};

export function CloudProvidersView({ initial }: { initial: Provider[] }) {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>(initial);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // Add-form state.
  const [kind, setKind] = useState<Provider['kind']>('GEELARK');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const selectedKind = KINDS.find((k) => k.kind === kind);

  function flash(t: Toast) { setToast(t); setTimeout(() => setToast(null), 3500); }

  async function refresh() {
    const res = await fetch('/api/cloud-providers', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (json?.data) setProviders(json.data as Provider[]);
  }

  async function add() {
    if (!name.trim()) { flash({ kind: 'err', text: 'Bir ad girin.' }); return; }
    setBusy('add');
    try {
      const body = {
        name: name.trim(), kind,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {})
      };
      const res = await fetch('/api/cloud-providers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Eklenemedi (${res.status})`);
      setAdding(false); setName(''); setApiKey(''); setApiSecret(''); setBaseUrl('');
      flash({ kind: 'ok', text: 'Sağlayıcı eklendi.' });
      await refresh();
    } catch (e) {
      flash({ kind: 'err', text: e instanceof Error ? e.message : 'Eklenemedi' });
    } finally { setBusy(null); }
  }

  async function check(p: Provider) {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/cloud-providers/${p.id}/check`, { method: 'POST' });
      const json = await res.json();
      const r = json.data as { ok: boolean; detail: string };
      flash({ kind: r.ok ? 'ok' : 'err', text: `${p.name}: ${r.detail}` });
      await refresh();
    } catch { flash({ kind: 'err', text: 'Kontrol başarısız' }); }
    finally { setBusy(null); }
  }

  async function sync(p: Provider) {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/cloud-providers/${p.id}/sync`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.data?.message ?? `Senkron başarısız (${res.status})`);
      flash({ kind: 'ok', text: `${json.data?.imported ?? 0} telefon içe aktarıldı.` });
      router.refresh();
    } catch (e) { flash({ kind: 'err', text: e instanceof Error ? e.message : 'Senkron başarısız' }); }
    finally { setBusy(null); }
  }

  async function createPhone(p: Provider) {
    const name = window.prompt(`${p.name} üzerinde yeni telefon adı:`, 'Cloud Phone');
    if (!name || !name.trim()) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/cloud-providers/${p.id}/phones`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.data?.message ?? json?.message ?? `Oluşturulamadı (${res.status})`);
      flash({ kind: 'ok', text: `Telefon oluşturuldu: ${name.trim()}` });
      router.refresh();
    } catch (e) { flash({ kind: 'err', text: e instanceof Error ? e.message : 'Telefon oluşturulamadı' }); }
    finally { setBusy(null); }
  }

  async function remove(p: Provider) {
    if (!confirm(`"${p.name}" sağlayıcısı silinsin mi? (Cihazlar kalır, bağ kopar.)`)) return;
    setBusy(p.id);
    try {
      await fetch(`/api/cloud-providers/${p.id}`, { method: 'DELETE' });
      flash({ kind: 'ok', text: 'Silindi.' });
      await refresh();
    } catch { flash({ kind: 'err', text: 'Silinemedi' }); }
    finally { setBusy(null); }
  }

  const connected = providers.filter((p) => p.lastCheckOk).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="BULUT SAĞLAYICILAR"
        title="Cloud Providers"
        subtitle="Harici cloud-phone sağlayıcılarını (GeeLark, VMOS, …) bağlayın; kiralık ARM telefonları kendi panelinizden yönetin. Donanım gerekmez."
        actions={
          <button type="button" className="btn-primary" onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={15} /> Sağlayıcı ekle
          </button>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Sağlayıcı" value={<span className="mono">{providers.length}</span>} sub="Bağlı hesap" tone="cyan" icon={<Cloud size={16} />} />
          <HoloStat label="Çevrimiçi" value={<span className="mono">{connected}</span>} sub="Son kontrol başarılı" tone={connected > 0 ? 'success' : 'cyan'} icon={<CheckCircle2 size={16} />} />
          <HoloStat label="Hazır adapter" value={<span className="mono">2</span>} sub="GeeLark · VMOS" tone="violet" icon={<Plug size={16} />} />
          <HoloStat label="Mimari" value={<span className="mono">ARM</span>} sub="WhatsApp/IG/TikTok çalışır" tone="success" icon={<Boxes size={16} />} />
        </div>
      </Reveal>

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      {providers.length === 0 ? (
        <Reveal>
          <HoloPanel title="Bağlı sağlayıcı yok" icon={<Cloud size={16} />}>
            <div className="empty-state">
              <div className="empty-art">☁</div>
              <h3>Henüz bulut sağlayıcı bağlı değil</h3>
              <p>GeeLark veya VMOS hesabınızın API anahtarını ekleyin; kiralık ARM telefonlar buraya gelsin ve filonuza katılsın.</p>
              <button type="button" className="btn-primary" onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Plus size={15} /> Sağlayıcı ekle
              </button>
            </div>
          </HoloPanel>
        </Reveal>
      ) : (
        <Reveal>
          <div className="holo-grid-auto">
            {providers.map((p) => (
              <Holo3D className="holo-card" key={p.id} max={6}>
                <div className="holo-card-top">
                  <div className="holo-card-ico"><Cloud size={18} /></div>
                  <span className="status-chip">{KIND_LABEL[p.kind]}</span>
                </div>
                <div className="holo-card-body">
                  <strong className="holo-card-title">{p.name}</strong>
                  <p className="helper">{p.hasApiKey ? 'API anahtarı ayarlı' : 'API anahtarı yok'}{p.hasApiSecret ? ' · secret ✓' : ''}</p>
                  {p.lastCheckAt ? (
                    <p className="helper" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {p.lastCheckOk
                        ? <CheckCircle2 size={13} style={{ color: 'var(--success,#34d399)' }} />
                        : <AlertTriangle size={13} style={{ color: 'var(--accent)' }} />}
                      <span className="mono" style={{ fontSize: '0.7rem' }}>{(p.lastCheckMsg ?? '').slice(0, 60)}</span>
                    </p>
                  ) : <p className="helper">Henüz kontrol edilmedi</p>}
                </div>
                <div className="row-actions" style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-ghost btn-xs" disabled={busy === p.id} onClick={() => check(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Plug size={13} /> Bağlantıyı test et
                  </button>
                  <button type="button" className="btn-primary btn-xs" disabled={busy === p.id} onClick={() => sync(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <RefreshCw size={13} /> Telefonları çek
                  </button>
                  <button type="button" className="btn-ghost btn-xs" disabled={busy === p.id} onClick={() => createPhone(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Plus size={13} /> Telefon oluştur
                  </button>
                  <button type="button" className="btn-ghost btn-xs action-danger" disabled={busy === p.id} onClick={() => remove(p)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Trash2 size={13} /> Sil
                  </button>
                </div>
              </Holo3D>
            ))}
          </div>
        </Reveal>
      )}

      {adding ? (
        <div className="modal-overlay" onClick={() => busy !== 'add' && setAdding(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Cloud size={18} /> Sağlayıcı ekle</h2>
              <button type="button" className="modal-close" aria-label="Kapat" onClick={() => setAdding(false)}><X size={16} /></button>
            </header>
            <div className="modal-body">
              <label className="field">
                <span>Sağlayıcı</span>
                <select className="field-input" value={kind} onChange={(e) => setKind(e.target.value as Provider['kind'])}>
                  {KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>{k.label}{k.ready ? '' : ' (yakında)'}</option>
                  ))}
                </select>
              </label>
              {selectedKind ? <p className="helper">{selectedKind.note}</p> : null}
              <label className="field">
                <span>Ad (etiket)</span>
                <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`örn. ${selectedKind?.label ?? ''} hesabım`} />
              </label>
              <label className="field">
                <span>{selectedKind?.apiKeyLabel ?? 'API anahtarı'}</span>
                <input className="field-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Sağlayıcı panelinden alın" />
              </label>
              {selectedKind?.needsSecret ? (
                <label className="field">
                  <span>{selectedKind?.apiSecretLabel ?? 'API secret'}</span>
                  <input className="field-input" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="İmza/kimlik için" />
                </label>
              ) : null}
              <label className="field">
                <span>Base URL (opsiyonel)</span>
                <input className="field-input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Varsayılanı kullanmak için boş bırakın" />
              </label>
              <p className="helper">Anahtarlar AES-256-GCM ile şifreli saklanır, asla geri gösterilmez.</p>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setAdding(false)} disabled={busy === 'add'}>İptal</button>
              <button type="button" className="btn-primary" onClick={add} disabled={busy === 'add' || !name.trim()}>
                {busy === 'add' ? 'Ekleniyor…' : 'Ekle'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
