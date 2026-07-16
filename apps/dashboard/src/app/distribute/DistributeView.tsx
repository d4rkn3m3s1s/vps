'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Send,
  Link2,
  CheckSquare,
  Square,
  Smartphone,
  Target,
  Crosshair,
  Filter,
  HardDriveDownload
} from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';

type Device = { id: string; name: string; status?: string; groupId?: string | null };
type Group = { id: string; name: string };

const STATUS_LABELS: Record<string, string> = {
  online: 'Çevrimiçi',
  ready: 'Hazır',
  busy: 'Meşgul',
  error: 'Hata',
  offline: 'Çevrimdışı'
};

export function DistributeView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Source is a raw file URL that the host agent fetches + pushes.
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [destination, setDestination] = useState<'gallery' | 'downloads'>('gallery');
  const [groupFilter, setGroupFilter] = useState('');

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  useEffect(() => {
    (async () => {
      try {
        const [dRes, gRes] = await Promise.all([
          fetch('/api/devices'),
          fetch('/api/groups')
        ]);
        const [dJson, gJson] = await Promise.all([dRes.json(), gRes.json()]);
        if (Array.isArray(dJson.data)) setDevices(dJson.data);
        if (Array.isArray(gJson.data)) setGroups(gJson.data);
      } catch {
        flash('Cihazlar veya gruplar yüklenemedi.');
      }
    })();
  }, []);

  const visibleDevices = useMemo(
    () => (groupFilter ? devices.filter((d) => d.groupId === groupFilter) : devices),
    [devices, groupFilter]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = visibleDevices.every((d) => next.has(d.id));
      if (allSelected) visibleDevices.forEach((d) => next.delete(d.id));
      else visibleDevices.forEach((d) => next.add(d.id));
      return next;
    });
  }

  async function distribute() {
    const deviceIds = Array.from(selected);
    if (deviceIds.length === 0) return flash('En az bir cihaz seçin.');
    if (!url.trim()) return flash('Bir dosya URL adresi girin.');
    const body: Record<string, unknown> = { deviceIds, destination, url: url.trim() };
    if (fileName.trim()) body.fileName = fileName.trim();
    setBusy(true);
    try {
      const res = await fetch('/api/files/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Dağıtım başarısız');
      flash(`${json.data?.pushed ?? deviceIds.length} cihaza teslimat sıraya alındı.`);
      setSelected(new Set());
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Dağıtım başarısız');
    } finally {
      setBusy(false);
    }
  }

  const allVisibleSelected = visibleDevices.length > 0 && visibleDevices.every((d) => selected.has(d.id));

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="DAĞITIM"
        title="Dosya dağıtımı"
        subtitle="Bir dosyayı herhangi bir URL'den birçok bulut telefona aynı anda gönderin."
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Toplam cihaz"
            value={<span className="mono">{devices.length}</span>}
            sub="filodaki bulut telefon"
            tone="cyan"
            icon={<Smartphone size={16} />}
          />
          <HoloStat
            label="Görünen hedef"
            value={<span className="mono">{visibleDevices.length}</span>}
            sub={groupFilter ? 'filtrelenmiş grup' : 'tüm cihazlar'}
            tone="cyan"
            icon={<Target size={16} />}
          />
          <HoloStat
            label="Seçili hedef"
            value={<span className="mono">{selected.size}</span>}
            sub="teslimat için kilitlendi"
            tone={selected.size > 0 ? 'success' : 'warning'}
            icon={<Crosshair size={16} />}
          />
        </div>
      </Reveal>

      <div className="section-grid distribute-grid">
        {/* Target devices */}
        <Reveal delay={0.05}>
          <HoloPanel
            title={`Hedef cihazlar (${selected.size} seçili)`}
            icon={<Target size={16} />}
            actions={
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={selectAllVisible}
                disabled={visibleDevices.length === 0}
              >
                {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />} Tümünü seç
              </button>
            }
          >
            <div className="field-row distribute-filter-row">
              <span className="holo-stat-ico" aria-hidden>
                <Filter size={14} />
              </span>
              <select
                className="field-input"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="">Tüm cihazlar</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            {visibleDevices.length === 0 ? (
              <div className="table-empty">
                <p className="helper">{groupFilter ? 'Bu grupta cihaz yok' : 'Cihaz yok'}.</p>
              </div>
            ) : (
              <div className="holo-grid-auto distribute-device-list">
                {visibleDevices.map((d) => {
                  const on = selected.has(d.id);
                  const st = d.status ? d.status.toLowerCase() : '';
                  const dotTone =
                    st === 'online' || st === 'ready'
                      ? 'dot-online'
                      : st === 'busy'
                        ? 'dot-busy'
                        : st === 'error' || st === 'offline'
                          ? 'dot-error'
                          : 'dot-offline';
                  return (
                    <Holo3D
                      key={d.id}
                      max={5}
                      className={`holo-pick-card${on ? ' is-active' : ''}`}
                    >
                      <label className={`distribute-device${on ? ' distribute-device-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(d.id)}
                        />
                        <span className="distribute-device-name">
                          <Smartphone size={13} style={{ marginRight: 6, verticalAlign: 'middle', opacity: 0.8 }} />
                          {d.name}
                        </span>
                        {d.status ? (
                          <span className="status-chip">
                            <span className={`dot ${dotTone}`} aria-hidden />
                            {STATUS_LABELS[st] ?? d.status}
                          </span>
                        ) : null}
                      </label>
                    </Holo3D>
                  );
                })}
              </div>
            )}
          </HoloPanel>
        </Reveal>

        {/* Source + send */}
        <Reveal delay={0.1}>
          <HoloPanel title="Gönderilecek dosya" icon={<Send size={16} />} tilt>
            <div className="field distribute-field">
              <label className="helper">
                <Link2 size={13} style={{ marginRight: 5, verticalAlign: 'middle', opacity: 0.8 }} />
                Dosya URL
              </label>
              <input className="field-input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/photo.jpg" />
            </div>
            <div className="field distribute-field">
              <label className="helper">Dosya adı (isteğe bağlı)</label>
              <input className="field-input" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="photo.jpg" />
            </div>

            <div className="field distribute-field">
              <label className="helper">
                <HardDriveDownload size={13} style={{ marginRight: 5, verticalAlign: 'middle', opacity: 0.8 }} />
                Kaydedilecek yer
              </label>
              <select className="field-input" value={destination} onChange={(e) => setDestination(e.target.value as 'gallery' | 'downloads')}>
                <option value="gallery">Galeri</option>
                <option value="downloads">İndirilenler</option>
              </select>
            </div>

            <button type="button" className="btn-primary distribute-send" disabled={busy || selected.size === 0} onClick={distribute}>
              <Send size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {busy ? 'Gönderiliyor…' : `${selected.size} cihaza dağıt`}
            </button>

            {msg ? <p className="helper mono" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
          </HoloPanel>
        </Reveal>
      </div>
    </PageMotion>
  );
}
