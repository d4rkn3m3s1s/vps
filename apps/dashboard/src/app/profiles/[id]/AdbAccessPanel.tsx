'use client';

import { useEffect, useState } from 'react';
import { Terminal, Copy, Check, Wifi, WifiOff, ShieldAlert } from 'lucide-react';

type ConnectInfo = {
  deviceId: string;
  name: string;
  serial: string;
  exposed: boolean;
  publicHost?: string;
  publicPort?: number;
  allowlist: string[];
  commands: { connect: string; shell: string; scrcpy: string; disconnect: string };
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  }
  return (
    <div className="adb-cmd-row">
      <span className="helper adb-cmd-label">{label}</span>
      <code className="mono adb-cmd">{value}</code>
      <button type="button" className="icon-btn" onClick={copy} title="Kopyala" aria-label={`${label} kopyala`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export function AdbAccessPanel({ deviceId }: { deviceId: string }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Exec console.
  const [cmd, setCmd] = useState('getprop ro.product.model');
  const [output, setOutput] = useState<string | null>(null);

  // Expose form.
  const [publicHost, setPublicHost] = useState('');
  const [publicPort, setPublicPort] = useState('');
  const [allowlist, setAllowlist] = useState('');

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  async function load() {
    try {
      const res = await fetch(`/api/devices/${deviceId}/adb/connect-info`);
      const json = await res.json();
      if (res.ok && json.data) {
        setInfo(json.data as ConnectInfo);
        setPublicHost(json.data.publicHost ?? '');
        setPublicPort(json.data.publicPort ? String(json.data.publicPort) : '');
        setAllowlist((json.data.allowlist ?? []).join(', '));
      } else {
        flash(json.message ?? 'ADB bilgisi yüklenemedi');
      }
    } catch {
      flash('ADB bilgisi yüklenemedi');
    }
  }

  useEffect(() => {
    void load();
  }, [deviceId]);

  async function runExec() {
    if (!cmd.trim()) return;
    setBusy(true);
    setOutput(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/adb/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Komut başarısız');
      const d = json.data;
      setOutput([d.stdout, d.stderr].filter(Boolean).join('\n') || `(çıkış ${d.exitCode}, çıktı yok)`);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : 'Komut başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function expose() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (publicHost.trim()) body.publicHost = publicHost.trim();
      if (publicPort.trim()) body.publicPort = Number(publicPort.trim());
      const list = allowlist.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) body.allowlist = list;
      const res = await fetch(`/api/devices/${deviceId}/adb/expose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Yayınlanamadı');
      flash('ADB portu yayınlandı');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Yayınlanamadı');
    } finally {
      setBusy(false);
    }
  }

  async function unexpose() {
    if (!confirm('Bu cihazın ADB portunun dışarıya yayınlanması durdurulsun mu?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}/adb/expose`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Yayın durdurulamadı');
      }
      flash('ADB yayını devre dışı bırakıldı');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Yayın durdurulamadı');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2>
        <Terminal size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Harici ADB erişimi
      </h2>
      <p className="helper" style={{ marginTop: '-0.25rem' }}>
        Bu bulut telefona kendi makinenizden <span className="mono">adb</span> veya{' '}
        <span className="mono">scrcpy</span> ile bağlanın.
      </p>

      {info ? (
        <>
          <div className="adb-status-row">
            {info.exposed ? (
              <span className="status-chip"><Wifi size={13} /> Genel ADB: {info.publicHost}:{info.publicPort}</span>
            ) : (
              <span className="status-chip"><WifiOff size={13} /> Yalnızca sunucu ağı (genele yayınlanmadı)</span>
            )}
          </div>

          <div className="adb-cmd-block">
            <CopyRow label="Bağlan" value={info.commands.connect} />
            <CopyRow label="Shell" value={info.commands.shell} />
            <CopyRow label="Ekran (scrcpy)" value={info.commands.scrcpy} />
          </div>

          {/* Exec console */}
          <div className="adb-exec">
            <label className="adb-cmd-label helper">Bir shell komutu çalıştır</label>
            <div className="adb-exec-row">
              <input
                className="field-input mono"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder="getprop ro.product.model"
                onKeyDown={(e) => { if (e.key === 'Enter') void runExec(); }}
              />
              <button type="button" className="btn-primary" disabled={busy || !cmd.trim()} onClick={runExec}>
                {busy ? 'Çalışıyor…' : 'Çalıştır'}
              </button>
            </div>
            {output !== null ? <pre className="adb-output mono">{output}</pre> : null}
          </div>

          {/* Expose controls */}
          <div className="adb-expose">
            <h3 className="adb-subhead">
              <ShieldAlert size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Genel yayın
            </h3>
            <p className="helper">
              Genel bir ADB portu açmak, cihaz üzerinde tam denetim sağlar. Daima bir IP izin listesi ayarlayın. Yalnızca yönetici.
            </p>
            <div className="adb-expose-grid">
              <input className="field-input" value={publicHost} onChange={(e) => setPublicHost(e.target.value)} placeholder="Genel sunucu (varsayılan: cihaz sunucusu)" />
              <input className="field-input" value={publicPort} onChange={(e) => setPublicPort(e.target.value)} placeholder="Genel port" type="number" />
              <input className="field-input" value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="İzin listesi örn. 1.2.3.4, 10.0.0.0/24" />
            </div>
            <div className="adb-expose-actions">
              <button type="button" className="btn-primary" disabled={busy} onClick={expose}>
                {info.exposed ? 'Yayını güncelle' : 'ADB portunu yayınla'}
              </button>
              {info.exposed ? (
                <button type="button" className="btn-ghost danger-btn" disabled={busy} onClick={unexpose}>
                  Yayını durdur
                </button>
              ) : null}
            </div>
          </div>

          {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
        </>
      ) : (
        <p className="helper">{msg ?? 'ADB bilgisi yükleniyor…'}</p>
      )}
    </div>
  );
}
