'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion, StaggerGrid, MotionItem } from '../../components/Motion';

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

  return (
    <PageMotion className="page">
      <PageHeader title="FleetHub" subtitle="Şablonlar, otomasyonlar ve entegrasyonlar için pazar yeri." />

      <div className="tab-row">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={c === cat ? 'tab tab-active' : 'tab'} onClick={() => setCat(c)}>
            {c === 'All' ? 'Tümü' : LABEL[c]}
          </button>
        ))}
      </div>

      <StaggerGrid className="app-grid">
        {filtered.map((l) => (
          <MotionItem className="app-card" key={l.id}>
            <div className="app-icon">{l.icon}</div>
            <div className="app-body">
              <div className="row">
                <strong>{l.title}</strong>
                <span className="badge">{LABEL[l.category] ?? l.category}</span>
              </div>
              <p className="helper">{l.description}</p>
              <div className="row" style={{ marginTop: '8px' }}>
                <span className="helper mono">↓ {l.installs.toLocaleString()} kurulum</span>
                <span className="price-tag">{l.price}</span>
              </div>
            </div>
            <button type="button" className="btn-ghost" disabled={busy === l.id} onClick={() => onInstallClick(l)}>
              {busy === l.id ? '…' : l.apkUrl ? 'Cihaza Kur' : 'Kur'}
            </button>
          </MotionItem>
        ))}
      </StaggerGrid>

      {modalListing ? (
        <div className="modal-overlay" onClick={() => setModalListing(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{modalListing.title} — cihaz seç</h2>
            <p className="helper">Bu uygulamayı hangi cihazlara kuralım?</p>
            <div className="device-pick-list">
              {devices.length === 0 ? (
                <p className="helper">Cihaz yok.</p>
              ) : (
                devices.map((d) => (
                  <label key={d.id} className="device-pick-item">
                    <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggleDevice(d.id)} />
                    <span>{d.name}</span>
                    <span className={`status-dot status-${d.status.toLowerCase()}`} />
                  </label>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setModalListing(null)}>
                İptal
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={selected.length === 0 || busy === modalListing.id}
                onClick={() => postInstall(modalListing, selected)}
              >
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
