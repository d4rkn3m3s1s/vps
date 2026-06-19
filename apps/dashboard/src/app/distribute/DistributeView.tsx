'use client';

import { useEffect, useMemo, useState } from 'react';
import { Send, FolderDown, Link2, CheckSquare, Square } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

type Device = { id: string; name: string; status?: string; groupId?: string | null };
type Group = { id: string; name: string };
type Asset = { id: string; name: string; url?: string | null; type?: string };

export function DistributeView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Source: a library asset or a raw URL.
  const [source, setSource] = useState<'library' | 'url'>('library');
  const [assetId, setAssetId] = useState('');
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
        const [dRes, gRes, aRes] = await Promise.all([
          fetch('/api/devices'),
          fetch('/api/groups'),
          fetch('/api/library')
        ]);
        const [dJson, gJson, aJson] = await Promise.all([dRes.json(), gRes.json(), aRes.json()]);
        if (Array.isArray(dJson.data)) setDevices(dJson.data);
        if (Array.isArray(gJson.data)) setGroups(gJson.data);
        if (Array.isArray(aJson.data)) {
          const onlyWithUrl = (aJson.data as Asset[]).filter((a) => a.url);
          setAssets(onlyWithUrl);
          if (onlyWithUrl[0]) setAssetId(onlyWithUrl[0].id);
        }
      } catch {
        flash('Cihazlar, gruplar veya kütüphane yüklenemedi.');
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
    const body: Record<string, unknown> = { deviceIds, destination };
    if (source === 'library') {
      if (!assetId) return flash('Bir kütüphane öğesi seçin.');
      body.libraryAssetId = assetId;
    } else {
      if (!url.trim()) return flash('Bir dosya URL adresi girin.');
      body.url = url.trim();
      if (fileName.trim()) body.fileName = fileName.trim();
    }
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
      <PageHeader
        title="Dosya dağıtımı"
        subtitle="Bir dosyayı kütüphanenizden veya herhangi bir URL'den birçok bulut telefona aynı anda gönderin."
      />

      <div className="section-grid distribute-grid">
        {/* Target devices */}
        <div className="panel">
          <h2>Hedef cihazlar ({selected.size} seçili)</h2>
          <div className="distribute-filter-row">
            <select className="field-input" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="">Tüm cihazlar</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <button type="button" className="btn-ghost" onClick={selectAllVisible} disabled={visibleDevices.length === 0}>
              {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />} Tümünü seç
            </button>
          </div>
          {visibleDevices.length === 0 ? (
            <p className="helper">{groupFilter ? 'Bu grupta cihaz yok' : 'Cihaz yok'}.</p>
          ) : (
            <div className="distribute-device-list">
              {visibleDevices.map((d) => (
                <label key={d.id} className={`distribute-device${selected.has(d.id) ? ' distribute-device-on' : ''}`}>
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  <span className="distribute-device-name">{d.name}</span>
                  {d.status ? <span className="fp-device-status">{d.status.toLowerCase()}</span> : null}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Source + send */}
        <div className="panel">
          <h2>Gönderilecek dosya</h2>
          <div className="distribute-source-tabs">
            <button type="button" className={source === 'library' ? 'tab tab-active' : 'tab'} onClick={() => setSource('library')}>
              <FolderDown size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> Kütüphane
            </button>
            <button type="button" className={source === 'url' ? 'tab tab-active' : 'tab'} onClick={() => setSource('url')}>
              <Link2 size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} /> URL
            </button>
          </div>

          {source === 'library' ? (
            <div className="distribute-field">
              <label className="helper">Kütüphane öğesi</label>
              {assets.length === 0 ? (
                <p className="helper">Henüz URL'si olan kütüphane öğesi yok. Kütüphaneye bir tane ekleyin veya bir URL kullanın.</p>
              ) : (
                <select className="field-input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.type ? ` (${a.type})` : ''}</option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <>
              <div className="distribute-field">
                <label className="helper">Dosya URL</label>
                <input className="field-input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/photo.jpg" />
              </div>
              <div className="distribute-field">
                <label className="helper">Dosya adı (isteğe bağlı)</label>
                <input className="field-input" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="photo.jpg" />
              </div>
            </>
          )}

          <div className="distribute-field">
            <label className="helper">Kaydedilecek yer</label>
            <select className="field-input" value={destination} onChange={(e) => setDestination(e.target.value as 'gallery' | 'downloads')}>
              <option value="gallery">Galeri</option>
              <option value="downloads">İndirilenler</option>
            </select>
          </div>

          <button type="button" className="btn-primary distribute-send" disabled={busy || selected.size === 0} onClick={distribute}>
            <Send size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {busy ? 'Gönderiliyor…' : `${selected.size} cihaza dağıt`}
          </button>

          {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
        </div>
      </div>
    </PageMotion>
  );
}
