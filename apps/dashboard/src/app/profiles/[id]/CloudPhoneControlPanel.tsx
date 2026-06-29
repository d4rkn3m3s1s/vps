'use client';

import { useState } from 'react';
import { Cloud, Play, Square, RefreshCw, Terminal, Network, Camera, Loader2 } from 'lucide-react';
import { HoloPanel } from '../../../components/hud';

// Control panel for a device backed by an external cloud-phone vendor (GeeLark /
// VMOS / …). The API resolves our device id → provider adapter + externalId, so
// every action here hits the vendor's real API. Only rendered for provider-backed
// devices (cloudProvider != null/SELF); the KVM fleet uses the ADB panels instead.
export function CloudPhoneControlPanel({
  deviceId,
  provider
}: {
  deviceId: string;
  provider: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  // Shell
  const [cmd, setCmd] = useState('getprop ro.product.model');
  const [shellOut, setShellOut] = useState<string | null>(null);

  // Proxy
  const [proxy, setProxy] = useState({ type: 'HTTP', host: '', port: '', username: '', password: '' });

  // Screenshot
  const [shot, setShot] = useState<string | null>(null);

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setMsg({ text, kind });
    setTimeout(() => setMsg(null), 5000);
  }

  function errText(json: unknown, fallback: string): string {
    const d = (json as { data?: unknown })?.data;
    if (d && typeof d === 'object') {
      const m = (d as { error?: unknown; message?: unknown }).error ?? (d as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m;
    }
    return fallback;
  }

  async function action(act: 'start' | 'stop' | 'reboot', label: string) {
    setBusy(act);
    try {
      const res = await fetch(`/api/cloud-providers/devices/${deviceId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(json, `${label} başarısız`));
      flash(`${label} komutu sağlayıcıya gönderildi.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : `${label} başarısız`, 'err');
    } finally {
      setBusy(null);
    }
  }

  async function runShell() {
    if (!cmd.trim()) return;
    setBusy('shell');
    setShellOut(null);
    try {
      const res = await fetch(`/api/cloud-providers/devices/${deviceId}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.trim() })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(json, 'Komut başarısız'));
      const d = json.data as { stdout?: string; output?: string; result?: string } | string;
      const out = typeof d === 'string' ? d : (d?.stdout ?? d?.output ?? d?.result ?? JSON.stringify(d));
      setShellOut(out || '(çıktı yok)');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Komut başarısız', 'err');
    } finally {
      setBusy(null);
    }
  }

  async function setProxyOn() {
    if (!proxy.host.trim() || !proxy.port.trim()) { flash('Proxy host ve port gerekli', 'err'); return; }
    setBusy('proxy');
    try {
      const res = await fetch(`/api/cloud-providers/devices/${deviceId}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxy: {
            type: proxy.type,
            host: proxy.host.trim(),
            port: Number(proxy.port),
            ...(proxy.username ? { username: proxy.username } : {}),
            ...(proxy.password ? { password: proxy.password } : {})
          }
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(json, 'Proxy atanamadı'));
      flash('Proxy cihaza atandı.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Proxy atanamadı', 'err');
    } finally {
      setBusy(null);
    }
  }

  async function clearProxy() {
    setBusy('proxy');
    try {
      const res = await fetch(`/api/cloud-providers/devices/${deviceId}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy: null })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(json, 'Proxy temizlenemedi'));
      flash('Proxy temizlendi.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Proxy temizlenemedi', 'err');
    } finally {
      setBusy(null);
    }
  }

  async function screenshot() {
    setBusy('shot');
    setShot(null);
    try {
      const res = await fetch(`/api/cloud-providers/devices/${deviceId}/screenshot`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(json, 'Ekran görüntüsü alınamadı'));
      const d = json.data as { url?: string; image?: string; base64?: string } | string;
      const url = typeof d === 'string' ? d : (d?.url ?? (d?.image ? `data:image/png;base64,${d.image}` : d?.base64 ? `data:image/png;base64,${d.base64}` : null));
      if (!url) throw new Error('Sağlayıcı ekran görüntüsü döndürmedi (asenkron olabilir).');
      setShot(url);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Ekran görüntüsü alınamadı', 'err');
    } finally {
      setBusy(null);
    }
  }

  return (
    <HoloPanel title="Bulut Telefon Kontrolü" icon={<Cloud size={16} />} scan={false}>
      <p className="helper" style={{ marginBottom: '0.75rem' }}>
        Bu cihaz <strong>{provider}</strong> bulut sağlayıcısından kiralık. Aşağıdaki işlemler doğrudan sağlayıcının API&apos;sine gider.
      </p>

      {msg ? <p className={msg.kind === 'err' ? 'field-error' : 'helper'} style={msg.kind === 'ok' ? { color: 'var(--success, #22c55e)' } : {}}>{msg.text}</p> : null}

      {/* Lifecycle */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => action('start', 'Başlat')}>
          {busy === 'start' ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Başlat
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => action('stop', 'Durdur')}>
          {busy === 'stop' ? <Loader2 size={14} className="spin" /> : <Square size={14} />} Durdur
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => action('reboot', 'Yeniden başlat')}>
          {busy === 'reboot' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Yeniden başlat
        </button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={screenshot}>
          {busy === 'shot' ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} Ekran görüntüsü
        </button>
      </div>

      {shot ? (
        <div style={{ marginBottom: '1rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt="Cihaz ekran görüntüsü" style={{ maxWidth: 240, borderRadius: 10, border: '1px solid var(--panel-border)' }} />
        </div>
      ) : null}

      {/* Shell */}
      <div style={{ marginBottom: '1rem' }}>
        <label className="helper" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Terminal size={13} /> Uzak komut</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="field-input" style={{ flex: 1 }} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="getprop ro.product.model" />
          <button type="button" className="btn-secondary" disabled={!!busy || !cmd.trim()} onClick={runShell}>
            {busy === 'shell' ? <Loader2 size={14} className="spin" /> : 'Çalıştır'}
          </button>
        </div>
        {shellOut !== null ? (
          <pre className="mono" style={{ fontSize: '0.72rem', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', marginTop: '0.5rem', padding: '0.6rem', background: 'rgba(0,0,0,0.25)', borderRadius: 8 }}>{shellOut}</pre>
        ) : null}
      </div>

      {/* Proxy */}
      <div>
        <label className="helper" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Network size={13} /> Proxy ata</label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select className="inline-select" value={proxy.type} onChange={(e) => setProxy((p) => ({ ...p, type: e.target.value }))}>
            <option value="HTTP">HTTP</option>
            <option value="HTTPS">HTTPS</option>
            <option value="SOCKS5">SOCKS5</option>
          </select>
          <input className="field-input" style={{ flex: 2, minWidth: 120 }} placeholder="host" value={proxy.host} onChange={(e) => setProxy((p) => ({ ...p, host: e.target.value }))} />
          <input className="field-input" style={{ width: 90 }} placeholder="port" value={proxy.port} onChange={(e) => setProxy((p) => ({ ...p, port: e.target.value }))} />
          <input className="field-input" style={{ flex: 1, minWidth: 100 }} placeholder="kullanıcı (ops.)" value={proxy.username} onChange={(e) => setProxy((p) => ({ ...p, username: e.target.value }))} />
          <input className="field-input" style={{ flex: 1, minWidth: 100 }} type="password" placeholder="parola (ops.)" value={proxy.password} onChange={(e) => setProxy((p) => ({ ...p, password: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" className="btn-secondary" disabled={busy === 'proxy'} onClick={setProxyOn}>
            {busy === 'proxy' ? <Loader2 size={14} className="spin" /> : 'Proxy ata'}
          </button>
          <button type="button" className="btn-ghost" disabled={busy === 'proxy'} onClick={clearProxy}>Temizle</button>
        </div>
      </div>
    </HoloPanel>
  );
}
