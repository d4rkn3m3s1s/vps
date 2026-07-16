'use client';

import { useState } from 'react';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import {
  Upload,
  Download,
  Package,
  Smartphone,
  X,
  CheckCircle2
} from 'lucide-react';

export type AppDevice = { id: string; name: string };

// Repo-bundled APKs (WhatsApp / Magisk / a11y / ADBKeyboard) — installed with a
// single click, no APK URL required (the file ships with the fleet host).
export type BundledApk = {
  file: string;
  name: string;
  packageName: string;
  version: string;
  sizeMB: number;
  category: string;
  shortLabel: string;
  color: string;
};

function AppIcon({ short, color }: { short: string; color: string }) {
  return (
    <span className="app-icon" style={{ background: color }}>
      {short}
    </span>
  );
}

export function ApplicationsView({
  devices,
  bundledApks = []
}: {
  devices: AppDevice[];
  bundledApks?: BundledApk[];
}) {
  // Bundled-APK install flow (URL-free, one-click).
  const [installApk, setInstallApk] = useState<BundledApk | null>(null);
  // Custom "upload APK" flow (header buttons): operator types a package + APK URL.
  const [customOpen, setCustomOpen] = useState(false);
  const [customPkg, setCustomPkg] = useState('');
  const [apkUrl, setApkUrl] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  function openInstallApk(apk: BundledApk) {
    setInstallApk(apk);
    setPicked(new Set());
  }

  async function confirmInstallApk() {
    if (!installApk || picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/apks/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apkFile: installApk.file, deviceIds: Array.from(picked) })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.data?.message ?? json?.message ?? 'Kurulum başarısız');
      flash(`${installApk.name} ${picked.size} telefonda kuyruğa alındı`);
      setInstallApk(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : `${installApk.name} kuyruğa alınamadı`);
    } finally {
      setBusy(false);
    }
  }

  function openCustom() {
    setCustomOpen(true);
    setCustomPkg('');
    setApkUrl('');
    setPicked(new Set());
  }

  async function confirmCustom() {
    if (!customPkg.trim() || !apkUrl.trim() || picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/catalog/apps/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: customPkg.trim(), deviceIds: Array.from(picked), apkUrl: apkUrl.trim() })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.data?.message ?? json?.message ?? 'Kurulum başarısız');
      flash(`APK ${picked.size} telefonda kuyruğa alındı`);
      setCustomOpen(false);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'APK kuyruğa alınamadı');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page holo-page">
      <HoloHeader
        eyebrow="UYGULAMALAR"
        title="Uygulamalar"
        subtitle="Fleet ile paketlenmiş APK'lar veya kendi APK bağlantınız — seçili bulut telefonlara tek tıkla kurun."
        actions={
          <button type="button" className="btn-primary" onClick={openCustom}>
            <Upload size={15} /> APK Yükle
          </button>
        }
      />

      <Reveal className="holo-stats-grid">
        <HoloStat label="Fleet APK'sı" value={bundledApks.length} sub="paketlenmiş APK" tone="info" icon={<Package size={16} />} />
        <HoloStat label="Bağlı Telefon" value={devices.length} sub="kurulum hedefi" tone="success" icon={<Smartphone size={16} />} />
      </Reveal>

      {bundledApks.length === 0 ? (
        <HoloPanel title="Fleet APK'ları" icon={<Package size={16} />}>
          <div className="empty-state">
            <div className="empty-art"><Package size={40} /></div>
            <h3>Paketlenmiş APK bulunamadı</h3>
            <p>APK'lar <code>deploy/apks/</code> altında repoda tutulur (Git LFS). Sunucuda bu dizin yoksa görünmez.</p>
          </div>
        </HoloPanel>
      ) : (
        <Reveal className="holo-grid-auto app-grid">
          {bundledApks.map((apk) => (
            <Holo3D className="holo-panel app-card" key={apk.file} max={5}>
              <span className="holo-corner holo-corner-tl" aria-hidden />
              <span className="holo-corner holo-corner-tr" aria-hidden />
              <span className="holo-corner holo-corner-bl" aria-hidden />
              <span className="holo-corner holo-corner-br" aria-hidden />
              <div className="app-card-main">
                <AppIcon short={apk.shortLabel} color={apk.color} />
                <div className="app-meta">
                  <strong>{apk.name}</strong>
                  <span className="helper mono">
                    v{apk.version} · {apk.sizeMB} MB
                  </span>
                  <span className="helper mono">{apk.packageName}</span>
                </div>
              </div>
              <button type="button" className="btn-primary btn-xs install-btn" onClick={() => openInstallApk(apk)}>
                <Download size={13} /> Kur
              </button>
            </Holo3D>
          ))}
        </Reveal>
      )}

      {installApk ? (
        <div className="modal-overlay" onClick={() => !busy && setInstallApk(null)}>
          <div className="modal holo-panel" onClick={(e) => e.stopPropagation()}>
            <span className="holo-corner holo-corner-tl" aria-hidden />
            <span className="holo-corner holo-corner-tr" aria-hidden />
            <span className="holo-corner holo-corner-bl" aria-hidden />
            <span className="holo-corner holo-corner-br" aria-hidden />
            <header className="modal-head">
              <h2><Download size={18} /> {installApk.name} Kur</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setInstallApk(null)}>
                <X size={16} />
              </button>
            </header>
            <p className="helper mono">{installApk.packageName} · v{installApk.version} · {installApk.sizeMB} MB</p>
            <div className="modal-section">
              <h3>Hedef telefonları seçin</h3>
              <div className="run-devices">
                {devices.length === 0 ? (
                  <span className="helper">Kullanılabilir bulut telefon yok — önce bir tane oluşturun.</span>
                ) : (
                  devices.map((d) => (
                    <label className="field-check" key={d.id}>
                      <input
                        type="checkbox"
                        checked={picked.has(d.id)}
                        onChange={(e) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          })
                        }
                      />
                      <span><Smartphone size={13} className="mono" /> {d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <footer className="modal-foot">
              <span className="helper mono">{picked.size} seçili</span>
              <button type="button" className="btn-primary" disabled={busy || picked.size === 0} onClick={confirmInstallApk}>
                {busy ? 'Kuruluyor…' : `${picked.size} telefona kur`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {customOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setCustomOpen(false)}>
          <div className="modal holo-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Upload size={18} /> APK Yükle</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setCustomOpen(false)}><X size={16} /></button>
            </header>
            <div className="modal-section">
              <label className="field">
                <span>Paket adı</span>
                <input className="field-input mono" value={customPkg} onChange={(e) => setCustomPkg(e.target.value)} placeholder="com.example.app" />
              </label>
              <label className="field">
                <span>APK indirme URL'si</span>
                <input className="field-input mono" value={apkUrl} onChange={(e) => setApkUrl(e.target.value)} placeholder="https://.../app.apk" />
              </label>
            </div>
            <div className="modal-section">
              <h3>Hedef telefonları seçin</h3>
              <div className="run-devices">
                {devices.length === 0 ? (
                  <span className="helper">Kullanılabilir bulut telefon yok — önce bir tane oluşturun.</span>
                ) : (
                  devices.map((d) => (
                    <label className="field-check" key={d.id}>
                      <input
                        type="checkbox"
                        checked={picked.has(d.id)}
                        onChange={(e) => setPicked((prev) => { const next = new Set(prev); if (e.target.checked) next.add(d.id); else next.delete(d.id); return next; })}
                      />
                      <span><Smartphone size={13} className="mono" /> {d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <footer className="modal-foot">
              <span className="helper mono">{picked.size} seçili</span>
              <button type="button" className="btn-primary" disabled={busy || !customPkg.trim() || !apkUrl.trim() || picked.size === 0} onClick={confirmCustom}>
                {busy ? 'Kuruluyor…' : `${picked.size} telefona kur`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast toast-ok">
          <CheckCircle2 size={15} /> {toast}
        </div>
      ) : null}
    </div>
  );
}
