'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Package,
  Workflow,
  Plug,
  Download,
  Sparkles,
  Smartphone,
  Boxes,
  Tag,
  X
} from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, HoloTabs, Holo3D, Reveal } from '../../components/hud';

export type Listing = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  price: string;
  installs: number;
  // Present when the listing is a real, installable APK.
  apkUrl?: string | null;
  packageName?: string | null;
};

type Device = { id: string; name: string; status: string };

const CATEGORIES = ['All', 'TEMPLATE', 'AUTOMATION', 'INTEGRATION'];
const LABEL: Record<string, string> = { TEMPLATE: 'Şablon', AUTOMATION: 'Otomasyon', INTEGRATION: 'Entegrasyon' };
const CAT_ICON: Record<string, ReactNode> = {
  All: <LayoutGrid size={14} />,
  TEMPLATE: <Package size={14} />,
  AUTOMATION: <Workflow size={14} />,
  INTEGRATION: <Plug size={14} />
};

export function FleetHubView({ listings }: { listings: Listing[] }) {
  const router = useRouter();
  const [cat, setCat] = useState('All');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Device selection modal (only for installable APK listings).
  const [modalListing, setModalListing] = useState<Listing | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => (cat === 'All' ? listings : listings.filter((l) => l.category === cat)), [listings, cat]);

  // Load devices once so the install modal can offer targets.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/devices')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const list: Device[] = (json.data ?? json ?? []).map((d: { id: string; name: string; status: string }) => ({
          id: d.id,
          name: d.name,
          status: d.status
        }));
        setDevices(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Listings with a real APK open the device picker; the rest just "install"
  // (counter bump) with an empty device list.
  function onInstallClick(l: Listing) {
    if (l.apkUrl && l.packageName) {
      setModalListing(l);
      setSelected([]);
      return;
    }
    void postInstall(l, []);
  }

  async function postInstall(l: Listing, deviceIds: string[]) {
    setBusy(l.id);
    try {
      const res = await fetch(`/api/catalog/listings/${l.id}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds })
      });
      if (!res.ok) throw new Error();
      showToast(deviceIds.length > 0 ? `${l.title} ${deviceIds.length} cihaza kuruldu` : `${l.title} eklendi`);
      setModalListing(null);
      router.refresh();
    } catch {
      showToast(`${l.title} kurulamadı`);
    } finally {
      setBusy(null);
    }
  }

  function toggleDevice(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  // Derived summary metrics (no new fetches — pure projections of state/props).
  const totalInstalls = useMemo(() => listings.reduce((sum, l) => sum + l.installs, 0), [listings]);
  const apkCount = useMemo(() => listings.filter((l) => l.apkUrl && l.packageName).length, [listings]);

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="FİLO MERKEZİ"
        title="FleetHub"
        subtitle="Şablonlar, otomasyonlar ve entegrasyonlar için pazar yeri."
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            tone="cyan"
            icon={<Boxes size={16} />}
            label="Toplam Modül"
            value={<span className="mono">{listings.length}</span>}
            sub="Kataloglanmış öğe"
          />
          <HoloStat
            tone="cyan"
            icon={<LayoutGrid size={16} />}
            label="Görüntülenen"
            value={<span className="mono">{filtered.length}</span>}
            sub={cat === 'All' ? 'Tüm kategoriler' : LABEL[cat] ?? cat}
          />
          <HoloStat
            tone="violet"
            icon={<Download size={16} />}
            label="Toplam Kurulum"
            value={<span className="mono">{totalInstalls.toLocaleString()}</span>}
            sub="Filo geneli"
          />
          <HoloStat
            tone="success"
            icon={<Smartphone size={16} />}
            label="Kurulabilir APK"
            value={<span className="mono">{apkCount}</span>}
            sub={`${devices.length} cihaz hedef`}
          />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Pazar Yeri" icon={<Sparkles size={16} />} scan>
          <HoloTabs
            tabs={CATEGORIES.map((c) => ({
              key: c,
              label: c === 'All' ? 'Tümü' : LABEL[c] ?? c,
              ...(CAT_ICON[c] ? { icon: CAT_ICON[c] } : {})
            }))}
            active={cat}
            onChange={(c) => setCat(c)}
          />

          <div className="holo-grid-auto" style={{ marginTop: '16px' }}>
            {filtered.map((l) => (
              <Holo3D className="holo-card" key={l.id}>
                <div className="holo-card-top">
                  <div className="holo-card-ico">{l.icon}</div>
                  <span className="status-chip">{LABEL[l.category] ?? l.category}</span>
                </div>
                <div className="holo-card-body">
                  <strong className="holo-card-title">{l.title}</strong>
                  <p className="helper">{l.description}</p>
                </div>
                <div className="holo-card-meta field-row">
                  <span className="helper mono">
                    <Download size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} />
                    {l.installs.toLocaleString()} kurulum
                  </span>
                  <span className="status-chip mono">
                    <Tag size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} />
                    {l.price}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy === l.id}
                  onClick={() => onInstallClick(l)}
                >
                  {busy === l.id ? '…' : l.apkUrl ? (
                    <>
                      <Smartphone size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                      Cihaza Kur
                    </>
                  ) : (
                    <>
                      <Download size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                      Kur
                    </>
                  )}
                </button>
              </Holo3D>
            ))}
            {filtered.length === 0 ? <div className="table-empty">Bu kategoride modül yok.</div> : null}
          </div>
        </HoloPanel>
      </Reveal>

      {modalListing ? (
        <div className="modal-overlay" onClick={() => setModalListing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="holo-panel-title">
                <span className="holo-panel-ico"><Smartphone size={16} /></span>
                {modalListing.title} — cihaz seç
              </h2>
              <button type="button" className="modal-close" onClick={() => setModalListing(null)} aria-label="Kapat">
                <X size={16} />
              </button>
            </div>
            <p className="helper">Bu uygulamayı hangi cihazlara kuralım?</p>
            <div className="holo-grid-2" style={{ marginTop: '12px' }}>
              {devices.length === 0 ? (
                <p className="helper table-empty">Cihaz yok.</p>
              ) : (
                devices.map((d) => {
                  const st = d.status.toLowerCase();
                  const dotCls = st === 'online' ? 'dot-online' : st === 'offline' ? 'dot-offline' : 'dot-error';
                  return (
                    <label key={d.id} className="field-row" style={{ cursor: 'pointer', gap: '10px' }}>
                      <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleDevice(d.id)} />
                      <span style={{ flex: 1 }}>{d.name}</span>
                      <span className={`dot ${dotCls}`} />
                    </label>
                  );
                })
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setModalListing(null)}>
                İptal
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={selected.length === 0 || busy === modalListing.id}
                onClick={() => postInstall(modalListing, selected)}
              >
                <Download size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                Kur ({selected.length})
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast toast-ok">{toast}</div> : null}
    </PageMotion>
  );
}
