'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { StaggerGrid, MotionItem, PageMotion } from '../../components/Motion';

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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 3000);
  }

  function openInstall(app: AppItem) {
    setInstallApp(app);
    setPicked(new Set());
  }

  async function confirmInstall() {
    if (!installApp || picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/catalog/apps/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: installApp.packageName, deviceIds: Array.from(picked) })
      });
      if (!res.ok) throw new Error();
      flash(`${installApp.name} ${picked.size} telefonda kuyruğa alındı`);
      setInstallApp(null);
    } catch {
      flash(`${installApp.name} kuyruğa alınamadı`);
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

  return (
    <PageMotion className="page">
      <PageHeader
        title="Uygulamalar"
        subtitle="Gerçek APK kataloğu — seçili bulut telefonlara tek tıkla kurun."
        actions={<button type="button" className="btn-primary">⬆ APK Yükle</button>}
      />

      <div className="tabs">
        <button type="button" className={tab === 'store' ? 'tab tab-active' : 'tab'} onClick={() => setTab('store')}>
          Uygulama Mağazası ({apps.length})
        </button>
        <button type="button" className={tab === 'team' ? 'tab tab-active' : 'tab'} onClick={() => setTab('team')}>
          Ekip uygulamaları
        </button>
      </div>

      <div className="toolbar-row">
        <select className="group-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat] ?? cat}
            </option>
          ))}
        </select>
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input type="text" placeholder="Anahtar kelime ara" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {tab === 'team' ? (
        <div className="empty-state">
          <div className="empty-art">▤</div>
          <h3>Henüz ekip uygulaması yok</h3>
          <p>Ekibinizin bulut telefonlarında paylaşmak için bir APK yükleyin.</p>
          <button type="button" className="btn-primary">⬆ APK Yükle</button>
        </div>
      ) : (
        <StaggerGrid className="app-grid">
          {filtered.map((app) => (
            <MotionItem className="app-card" key={app.id}>
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
              <button type="button" className="install-btn" onClick={() => openInstall(app)}>
                Kur
              </button>
            </MotionItem>
          ))}
        </StaggerGrid>
      )}

      {installApp ? (
        <div className="modal-overlay" onClick={() => !busy && setInstallApp(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>{installApp.name} Kur</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setInstallApp(null)}>
                ✕
              </button>
            </header>
            <p className="helper mono">{installApp.packageName} · v{installApp.version}</p>
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
                      <span>{d.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <footer className="modal-foot">
              <span className="helper">{picked.size} seçili</span>
              <button type="button" className="btn-primary" disabled={busy || picked.size === 0} onClick={confirmInstall}>
                {busy ? 'Kuruluyor…' : `${picked.size} telefona kur`}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast toast-ok">{toast}</div> : null}
    </PageMotion>
  );
}
