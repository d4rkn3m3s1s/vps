'use client';

import { useMemo, useState } from 'react';
import { HoloHeader, HoloPanel, HoloStat, HoloTabs, Holo3D, Reveal } from '../../components/hud';
import {
  Upload,
  Search,
  Download,
  LayoutGrid,
  Users,
  Package,
  Smartphone,
  X,
  CheckCircle2
} from 'lucide-react';

export type AppItem = {
  id: string;
  name: string;
  packageName: string;
  version: string;
  category: string;
  shortLabel: string;
  color: string;
  installs: number;
};

export type AppDevice = { id: string; name: string };

const CATEGORIES = ['All', 'Social', 'Messaging', 'Shopping', 'Finance', 'Lifestyle'];

const CATEGORY_LABELS: Record<string, string> = {
  All: 'Tümü',
  Social: 'Sosyal',
  Messaging: 'Mesajlaşma',
  Shopping: 'Alışveriş',
  Finance: 'Finans',
  Lifestyle: 'Yaşam Tarzı'
};

function AppIcon({ short, color }: { short: string; color: string }) {
  return (
    <span className="app-icon" style={{ background: color }}>
      {short}
    </span>
  );
}

export function ApplicationsView({ apps, devices }: { apps: AppItem[]; devices: AppDevice[] }) {
  const [tab, setTab] = useState<'store' | 'team'>('store');
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [installApp, setInstallApp] = useState<AppItem | null>(null);
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

  function openInstall(app: AppItem) {
    setInstallApp(app);
    setApkUrl('');
    setPicked(new Set());
  }

  function openCustom() {
    setCustomOpen(true);
    setCustomPkg('');
    setApkUrl('');
    setPicked(new Set());
  }

  async function confirmInstall() {
    if (!installApp || picked.size === 0) return;
    // Catalog items have no bundled APK, so an APK download URL is required.
    if (!apkUrl.trim()) { flash('Bir APK indirme URL\'si girin (Play paketi doğrudan kurulamaz).'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/catalog/apps/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: installApp.packageName, deviceIds: Array.from(picked), apkUrl: apkUrl.trim() })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.data?.message ?? json?.message ?? 'Kurulum başarısız');
      flash(`${installApp.name} ${picked.size} telefonda kuyruğa alındı`);
      setInstallApp(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : `${installApp.name} kuyruğa alınamadı`);
    } finally {
      setBusy(false);
    }
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

  const filtered = useMemo(
    () =>
      apps.filter(
        (app) =>
          (category === 'All' || app.category === category) &&
          app.name.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [apps, category, query]
  );

  const totalInstalls = useMemo(() => apps.reduce((sum, app) => sum + app.installs, 0), [apps]);
  const categoryCount = useMemo(() => new Set(apps.map((app) => app.category)).size, [apps]);

  return (
    <div className="page holo-page">
      <HoloHeader
        eyebrow="UYGULAMA MAĞAZASI"
        title="Uygulamalar"
        subtitle="Gerçek APK kataloğu — seçili bulut telefonlara tek tıkla kurun."
        actions={
          <button type="button" className="btn-primary" onClick={openCustom}>
            <Upload size={15} /> APK Yükle
          </button>
        }
      />

      <Reveal className="holo-stats-grid">
        <HoloStat label="Katalog Uygulaması" value={apps.length} sub="toplam paket" tone="info" icon={<Package size={16} />} />
        <HoloStat label="Toplam Kurulum" value={totalInstalls} sub="tüm telefonlar" tone="cyan" icon={<Download size={16} />} />
        <HoloStat label="Kategori" value={categoryCount} sub="aktif segment" tone="violet" icon={<LayoutGrid size={16} />} />
        <HoloStat label="Bağlı Telefon" value={devices.length} sub="kurulum hedefi" tone="success" icon={<Smartphone size={16} />} />
      </Reveal>

      <HoloTabs
        tabs={[
          { key: 'store', label: `Uygulama Mağazası (${apps.length})`, icon: <Package size={15} /> },
          { key: 'team', label: 'Ekip uygulamaları', icon: <Users size={15} /> }
        ]}
        active={tab}
        onChange={setTab}
      />

      <HoloPanel className="holo-toolbar-panel" scan={false}>
        <div className="toolbar-row">
          <select className="field-input group-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat] ?? cat}
              </option>
            ))}
          </select>
          <div className="search-box">
            <span className="search-icon"><Search size={15} /></span>
            <input type="text" placeholder="Anahtar kelime ara" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </HoloPanel>

      {tab === 'team' ? (
        <HoloPanel title="Ekip Uygulamaları" icon={<Users size={16} />}>
          <div className="empty-state">
            <div className="empty-art"><LayoutGrid size={40} /></div>
            <h3>Henüz ekip uygulaması yok</h3>
            <p>Ekibinizin bulut telefonlarında paylaşmak için bir APK yükleyin.</p>
            <button type="button" className="btn-primary" onClick={openCustom}>
              <Upload size={15} /> APK Yükle
            </button>
          </div>
        </HoloPanel>
      ) : (
        <Reveal className="holo-grid-auto app-grid">
          {filtered.map((app) => (
            <Holo3D className="holo-panel app-card" key={app.id} max={5}>
              <span className="holo-corner holo-corner-tl" aria-hidden />
              <span className="holo-corner holo-corner-tr" aria-hidden />
              <span className="holo-corner holo-corner-bl" aria-hidden />
              <span className="holo-corner holo-corner-br" aria-hidden />
              <div className="app-card-main">
                <AppIcon short={app.shortLabel} color={app.color} />
                <div className="app-meta">
                  <strong>{app.name}</strong>
                  <span className="helper mono">
                    {app.version}
                    {app.installs > 0 ? ` · ${app.installs} kurulum` : ''}
                  </span>
                </div>
              </div>
              <button type="button" className="btn-primary btn-xs install-btn" onClick={() => openInstall(app)}>
                <Download size={13} /> Kur
              </button>
            </Holo3D>
          ))}
        </Reveal>
      )}

      {installApp ? (
        <div className="modal-overlay" onClick={() => !busy && setInstallApp(null)}>
          <div className="modal holo-panel" onClick={(e) => e.stopPropagation()}>
            <span className="holo-corner holo-corner-tl" aria-hidden />
            <span className="holo-corner holo-corner-tr" aria-hidden />
            <span className="holo-corner holo-corner-bl" aria-hidden />
            <span className="holo-corner holo-corner-br" aria-hidden />
            <header className="modal-head">
              <h2><Download size={18} /> {installApp.name} Kur</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setInstallApp(null)}>
                <X size={16} />
              </button>
            </header>
            <p className="helper mono">{installApp.packageName} · v{installApp.version}</p>
            <div className="modal-section">
              <label className="field">
                <span>APK indirme URL'si</span>
                <input className="field-input mono" value={apkUrl} onChange={(e) => setApkUrl(e.target.value)} placeholder="https://.../app.apk" />
                <span className="helper">Play Store paketleri doğrudan kurulamaz; doğrudan bir APK bağlantısı gerekir.</span>
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
              <button type="button" className="btn-primary" disabled={busy || picked.size === 0} onClick={confirmInstall}>
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
