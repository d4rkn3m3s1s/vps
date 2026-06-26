'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Smartphone,
  Search,
  Plus,
  LayoutGrid,
  List,
  CheckSquare,
  Activity,
  Wifi,
  Cpu,
  MemoryStick,
  MapPin,
  Fingerprint,
  Server,
  Layers,
  Hash,
  Globe,
  Power,
  RefreshCw,
  Trash2,
  FolderInput,
  Network,
  Package,
  Send,
  X
} from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, HoloTabs, Holo3D, Reveal } from '../../components/hud';

export type ProvisioningModel = { model: string; manufacturer: string; brand: string; resolution: string; dpi: number; osVersions: string[] };
export type ProvisioningCatalog = { models: ProvisioningModel[]; ramTiers: number[]; cpuTiers: number[] };

export type DeviceGroup = {
  id: string;
  name: string;
};

export type DeviceFingerprint = {
  imei: string;
  androidId: string;
  serialNo: string;
  macAddress: string;
  manufacturer: string;
  model: string;
  brand: string;
  osVersion: string;
  buildNumber: string;
  resolution: string;
  dpi: number;
  carrier: string;
  mcc: string;
  mnc: string;
  phoneNumber: string | null;
  language: string;
  country: string;
  countryCode: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  gpsEnabled: boolean;
};

export type DeviceProfile = {
  id: string;
  uuid: string;
  name: string;
  status: string;
  ipAddress: string | null;
  adbPort: number | null;
  androidVersion: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  lastSeen: string | null;
  group?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
  fingerprint?: DeviceFingerprint | null;
};

export type Country = { countryCode: string; country: string; timezone: string };
export type ProxyOption = { id: string; label: string; host: string; port: number; type: string };
export type AppOption = { id: string; name: string; packageName: string; version: string; apkUrl: string | null };

type ViewMode = 'card' | 'list';

const STATUS_LABEL: Record<string, string> = {
  ONLINE: 'Çalışıyor',
  OFFLINE: 'Durduruldu',
  STARTING: 'Başlatılıyor',
  STOPPING: 'Durduruluyor',
  ERROR: 'Hata',
  UPDATING: 'Güncelleniyor',
  REBOOTING: 'Yeniden başlatılıyor'
};

function statusClass(status: string): string {
  switch (status) {
    case 'ONLINE':
      return 'dot dot-online';
    case 'ERROR':
      return 'dot dot-error';
    case 'STARTING':
    case 'STOPPING':
    case 'UPDATING':
    case 'REBOOTING':
      return 'dot dot-busy';
    default:
      return 'dot dot-offline';
  }
}

function flag(metadata?: Record<string, unknown> | null): string {
  const country = (metadata?.country as string) || (metadata?.region as string) || '';
  return country || 'Küresel';
}

const BULK_ACTIONS = ['Başlat', 'Kapat', 'Yeniden başlat', 'Taşı', 'Proxy ata', 'Uygulama yükle', 'Dosya gönder', 'Sil'] as const;

const BULK_ICONS: Record<string, ReactNode> = {
  'Başlat': <Power size={13} />,
  'Kapat': <Power size={13} />,
  'Yeniden başlat': <RefreshCw size={13} />,
  'Taşı': <FolderInput size={13} />,
  'Proxy ata': <Network size={13} />,
  'Uygulama yükle': <Package size={13} />,
  'Dosya gönder': <Send size={13} />,
  'Sil': <Trash2 size={13} />
};

export function ProfilesView({
  devices,
  groups,
  countries = [],
  proxies = [],
  apps = []
}: {
  devices: DeviceProfile[];
  groups: DeviceGroup[];
  countries?: Country[];
  proxies?: ProxyOption[];
  apps?: AppOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState<string>('all');
  const [mode, setMode] = useState<ViewMode>('card');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', androidVersion: '12', countryCode: 'US', deviceModel: '', ramGb: '6', cpuCores: '8' });
  // Provisioning catalog (device models + hardware tiers), lazy-loaded.
  const [catalog, setCatalog] = useState<ProvisioningCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveGroup, setMoveGroup] = useState('');
  const [newGroup, setNewGroup] = useState('');
  // Fingerprint / GPS detail modal.
  const [fpDevice, setFpDevice] = useState<DeviceProfile | null>(null);
  const [gpsForm, setGpsForm] = useState({ gpsEnabled: false, latitude: '', longitude: '', countryCode: '' });
  const [fpBusy, setFpBusy] = useState(false);
  // Bulk file push modal.
  const [pushOpen, setPushOpen] = useState(false);
  const [pushForm, setPushForm] = useState({ url: '', fileName: '', destination: 'gallery' });
  // Bulk assign-proxy modal.
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyChoice, setProxyChoice] = useState('');
  // Bulk install-app modal.
  const [appOpen, setAppOpen] = useState(false);
  const [appChoice, setAppChoice] = useState('');

  const filtered = useMemo(() => {
    return devices.filter((device) => {
      const matchesGroup =
        groupId === 'all' ||
        (groupId === 'ungrouped' ? !device.group : device.group?.id === groupId);
      const matchesQuery = device.name.toLowerCase().includes(query.trim().toLowerCase());
      return matchesGroup && matchesQuery;
    });
  }, [devices, groupId, query]);

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(() => (allSelected ? new Set() : new Set(filtered.map((d) => d.id))));
  }

  const selectionCount = selected.size;

  // Fleet telemetry derived for the HoloStat deck.
  const onlineCount = useMemo(() => devices.filter((d) => d.status === 'ONLINE').length, [devices]);
  const busyCount = useMemo(
    () => devices.filter((d) => d.status === 'STARTING' || d.status === 'UPDATING' || d.status === 'REBOOTING' || d.status === 'STOPPING').length,
    [devices]
  );
  const errorCount = useMemo(() => devices.filter((d) => d.status === 'ERROR').length, [devices]);

  // Lazy-load the provisioning catalog the first time the create modal opens.
  useEffect(() => {
    if (!createOpen || catalog) return;
    void (async () => {
      try {
        const res = await fetch('/api/devices/provisioning-catalog');
        const json = await res.json();
        if (json?.data?.models) setCatalog(json.data as ProvisioningCatalog);
      } catch { /* ignore — model picker just stays empty */ }
    })();
  }, [createOpen, catalog]);

  // Android versions available for the chosen model (or a sensible default set).
  const modelOsVersions = useMemo(() => {
    const m = catalog?.models.find((x) => x.model === form.deviceModel);
    return m?.osVersions ?? ['11', '12', '13', '14', '15'];
  }, [catalog, form.deviceModel]);

  async function createProfile() {
    if (!form.name.trim()) {
      setError('Profil adı gereklidir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          androidVersion: form.androidVersion,
          countryCode: form.countryCode,
          ...(form.deviceModel ? { deviceModel: form.deviceModel } : {}),
          ramGb: Number(form.ramGb),
          cpuCores: Number(form.cpuCores)
        })
      });
      if (!res.ok) throw new Error(`Oluşturma başarısız (${res.status})`);
      setCreateOpen(false);
      setForm({ name: '', androidVersion: '12', countryCode: 'US', deviceModel: '', ramGb: '6', cpuCores: '8' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oluşturma başarısız');
    } finally {
      setBusy(false);
    }
  }

  function openFingerprint(device: DeviceProfile) {
    setFpDevice(device);
    const fp = device.fingerprint;
    setGpsForm({
      gpsEnabled: fp?.gpsEnabled ?? false,
      latitude: fp?.latitude != null ? String(fp.latitude) : '',
      longitude: fp?.longitude != null ? String(fp.longitude) : '',
      countryCode: fp?.countryCode ?? ''
    });
  }

  async function regenerateFingerprint() {
    if (!fpDevice) return;
    setFpBusy(true);
    try {
      const res = await fetch(`/api/fingerprints/${fpDevice.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gpsForm.countryCode ? { countryCode: gpsForm.countryCode } : {})
      });
      if (!res.ok) throw new Error(`Yeniden oluşturma başarısız (${res.status})`);
      setFpDevice(null);
      router.refresh();
    } finally {
      setFpBusy(false);
    }
  }

  async function saveGps() {
    if (!fpDevice) return;
    setFpBusy(true);
    try {
      const body: Record<string, unknown> = { gpsEnabled: gpsForm.gpsEnabled };
      if (gpsForm.latitude) body.latitude = Number(gpsForm.latitude);
      if (gpsForm.longitude) body.longitude = Number(gpsForm.longitude);
      if (gpsForm.countryCode) body.countryCode = gpsForm.countryCode;
      const res = await fetch(`/api/fingerprints/${fpDevice.id}/gps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`GPS güncellemesi başarısız (${res.status})`);
      setFpDevice(null);
      router.refresh();
    } finally {
      setFpBusy(false);
    }
  }

  async function deleteSelected() {
    if (selectionCount === 0) return;
    if (!confirm(`${selectionCount} profil silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusy(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) => fetch(`/api/devices/${id}`, { method: 'DELETE' }))
      );
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function moveSelected() {
    if (selectionCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      let groupId = moveGroup;
      if (newGroup.trim()) {
        const gRes = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newGroup.trim() })
        });
        const gJson = await gRes.json().catch(() => ({}));
        if (!gRes.ok) throw new Error(gJson?.error ?? 'Grup oluşturulamadı');
        groupId = gJson.data?.id ?? '';
      }
      if (!groupId) {
        setError('Bir grup seçin veya yeni bir grup girin.');
        setBusy(false);
        return;
      }
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/devices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId })
          })
        )
      );
      setMoveOpen(false);
      setMoveGroup('');
      setNewGroup('');
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Taşıma başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function pushFile() {
    if (selectionCount === 0 || !pushForm.url.trim()) {
      setError('Dosya URL adresi gereklidir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/files/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceIds: Array.from(selected),
          url: pushForm.url.trim(),
          destination: pushForm.destination,
          ...(pushForm.fileName.trim() ? { fileName: pushForm.fileName.trim() } : {})
        })
      });
      if (!res.ok) throw new Error(`Gönderme başarısız (${res.status})`);
      setPushOpen(false);
      setPushForm({ url: '', fileName: '', destination: 'gallery' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gönderme başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function bulkJob(jobType: string, status: string) {
    if (selectionCount === 0) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      // Fire one real job per selected device, then reflect the new status.
      await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: ids, jobType })
      });
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/devices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
          })
        )
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Assign one proxy to all selected devices (fires one SET_PROXY job each).
  async function assignProxy() {
    if (selectionCount === 0 || !proxyChoice) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bulk/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: Array.from(selected), proxyId: proxyChoice })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Proxy atanamadı');
      }
      setProxyOpen(false);
      setProxyChoice('');
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Proxy atanamadı');
    } finally {
      setBusy(false);
    }
  }

  // Install one app on all selected devices (one INSTALL_APK job each).
  async function installApp() {
    if (selectionCount === 0 || !appChoice) return;
    const app = apps.find((a) => a.id === appChoice);
    if (!app) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceIds: Array.from(selected),
          jobType: 'EMULATOR_INSTALL_APK',
          payload: { packageName: app.packageName, apkUrl: app.apkUrl, appName: app.name }
        })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Yükleme başlatılamadı');
      }
      setAppOpen(false);
      setAppChoice('');
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yükleme başlatılamadı');
    } finally {
      setBusy(false);
    }
  }

  // Modal open/close helpers — each clears the shared `error` state so a message
  // from one modal never leaks into another (P8).
  function openCreate() {
    setError(null);
    setCreateOpen(true);
  }
  function closeCreate() {
    if (busy) return;
    setError(null);
    setCreateOpen(false);
  }
  function closeMove() {
    if (busy) return;
    setError(null);
    setMoveOpen(false);
  }
  function closePush() {
    if (busy) return;
    setError(null);
    setPushOpen(false);
  }
  function closeProxy() {
    if (busy) return;
    setError(null);
    setProxyOpen(false);
  }
  function closeApp() {
    if (busy) return;
    setError(null);
    setAppOpen(false);
  }

  function runBulk(action: string) {
    if (selectionCount === 0) return undefined;
    if (action === 'Sil') return deleteSelected();
    if (action === 'Başlat') return bulkJob('EMULATOR_START', 'STARTING');
    if (action === 'Kapat') return bulkJob('EMULATOR_STOP', 'STOPPING');
    if (action === 'Yeniden başlat') return bulkJob('EMULATOR_START', 'REBOOTING');
    if (action === 'Dosya gönder') {
      setError(null);
      setPushOpen(true);
      return undefined;
    }
    if (action === 'Proxy ata') {
      setError(null);
      setProxyOpen(true);
      return undefined;
    }
    if (action === 'Uygulama yükle') {
      setError(null);
      setAppOpen(true);
      return undefined;
    }
    if (action === 'Taşı') {
      setError(null);
      setMoveOpen(true);
      return undefined;
    }
    return undefined;
  }

  return (
    <div className="profiles">
      <HoloHeader
        eyebrow="CİHAZ FİLOSU"
        title="Profiller"
        subtitle="Bulut telefon filonuzu yönetin — başlatın, taşıyın, parmak izi ve proxy atayın."
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={15} /> Yeni profil
          </button>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="TOPLAM CİHAZ" value={<span className="mono">{devices.length}</span>} sub="Filodaki profiller" tone="cyan" icon={<Smartphone size={15} />} />
          <HoloStat label="ÇEVRİMİÇİ" value={<span className="mono">{onlineCount}</span>} sub="Aktif çalışan" tone="success" icon={<Activity size={15} />} />
          <HoloStat label="İŞLEMDE" value={<span className="mono">{busyCount}</span>} sub="Geçiş durumunda" tone="warning" icon={<RefreshCw size={15} />} />
          <HoloStat label="HATA" value={<span className="mono">{errorCount}</span>} sub="Müdahale gerekli" tone="error" icon={<Power size={15} />} />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Filtre ve görünüm" icon={<Search size={16} />} scan={false}
          actions={
            <HoloTabs<ViewMode>
              active={mode}
              onChange={setMode}
              tabs={[
                { key: 'card', label: 'Kart', icon: <LayoutGrid size={13} /> },
                { key: 'list', label: 'Liste', icon: <List size={13} /> }
              ]}
            />
          }
        >
          <div className="field-row">
            <label className="field">
              <span>Grup</span>
              <select className="field-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="all">Tüm gruplar</option>
                <option value="ungrouped">Grupsuz</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Ara</span>
              <input
                type="text"
                className="field-input mono"
                placeholder="Profil adı"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.08}>
        <HoloPanel title="Toplu işlemler" icon={<CheckSquare size={16} />} scan={false}
          actions={
            <label className="status-chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="select-check" checked={allSelected} onChange={toggleAll} aria-label="Tümünü seç" />
              <span className="mono">{selectionCount > 0 ? `${selectionCount} seçili` : 'Tümünü seç'}</span>
            </label>
          }
        >
          <div className="action-buttons">
            {BULK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={action === 'Sil' ? 'btn-ghost btn-xs action-danger' : 'btn-ghost btn-xs'}
                disabled={selectionCount === 0 || busy}
                title={selectionCount === 0 ? 'Önce profilleri seçin' : action}
                onClick={() => runBulk(action)}
              >
                {BULK_ICONS[action]} {action}
              </button>
            ))}
          </div>
        </HoloPanel>
      </Reveal>

      {filtered.length === 0 ? (
        <Reveal delay={0.1}>
          <HoloPanel>
            <div className="empty-state">
              <div className="empty-art"><Smartphone size={40} /></div>
              <h3>Henüz profil yok</h3>
              <p>Başlamak için ilk bulut telefon profilinizi oluşturun.</p>
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus size={15} /> Yeni profil
              </button>
            </div>
          </HoloPanel>
        </Reveal>
      ) : mode === 'card' ? (
        <Reveal delay={0.1}>
          <div className="holo-grid-auto">
            <Holo3D className="holo-card create-card" max={5}>
              <button type="button" className="create-card-btn" onClick={openCreate}>
                <div className="create-art"><Plus size={28} /></div>
                <strong>Yeni bir profil oluştur</strong>
                <span className="create-cta">Oluştur</span>
              </button>
            </Holo3D>

            {filtered.map((device) => {
              const isSelected = selected.has(device.id);
              return (
                <Holo3D key={device.id} className={`holo-card profile-card${isSelected ? ' profile-card-selected' : ''}`} max={6}>
                  <div className="card-head">
                    <label className="card-check">
                      <input type="checkbox" className="select-check" checked={isSelected} onChange={() => toggle(device.id)} aria-label={`${device.name} seç`} />
                    </label>
                    <Link href={`/profiles/${device.id}`} className="card-title card-title-link" title={device.name}>
                      {device.name}
                    </Link>
                    <Link href={`/profiles/${device.id}`} className="card-menu" aria-label="Cihazı aç" title="Cihazı aç">
                      ⋮
                    </Link>
                  </div>
                  <ul className="card-meta">
                    <li>
                      <span className="meta-icon"><Hash size={13} /></span>
                      <span className="mono">{device.uuid.slice(0, 18)}</span>
                    </li>
                    <li>
                      <span className="meta-icon"><MapPin size={13} /></span>
                      {device.fingerprint?.country ?? flag(device.metadata)}
                      {device.fingerprint?.gpsEnabled ? <span className="gps-pill">GPS</span> : null}
                    </li>
                    <li>
                      <span className="meta-icon"><Smartphone size={13} /></span>
                      {device.fingerprint ? `${device.fingerprint.manufacturer} ${device.fingerprint.model}` : 'Parmak izi yok'}
                    </li>
                    <li>
                      <span className="meta-icon"><Cpu size={13} /></span>
                      Android {device.fingerprint?.osVersion ?? device.androidVersion ?? '—'}
                    </li>
                    <li>
                      <span className="meta-icon"><Wifi size={13} /></span>
                      {device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : 'Proxy yok'}
                    </li>
                    <li>
                      <span className="meta-icon"><Layers size={13} /></span>
                      {device.group?.name ?? 'Grupsuz'}
                    </li>
                  </ul>
                  <div className="card-foot">
                    <span className="status-chip">
                      <span className={statusClass(device.status)} />
                      {STATUS_LABEL[device.status] ?? device.status}
                    </span>
                    <button type="button" className="fp-btn" onClick={() => openFingerprint(device)}>
                      <Fingerprint size={13} /> Parmak izi
                    </button>
                  </div>
                </Holo3D>
              );
            })}
          </div>
        </Reveal>
      ) : (
        <Reveal delay={0.1}>
          <HoloPanel title="Cihaz listesi" icon={<List size={16} />}>
            <div className="profile-table-wrap">
              <table className="profile-table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input type="checkbox" className="select-check" checked={allSelected} onChange={toggleAll} aria-label="Tümünü seç" />
                    </th>
                    <th>Ad</th>
                    <th>Durum</th>
                    <th>Konum</th>
                    <th>Android</th>
                    <th>IP / Port</th>
                    <th>Grup</th>
                    <th>CPU / RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((device) => {
                    const isSelected = selected.has(device.id);
                    return (
                      <tr key={device.id} className={isSelected ? 'row-selected' : ''}>
                        <td className="col-check">
                          <input type="checkbox" className="select-check" checked={isSelected} onChange={() => toggle(device.id)} aria-label={`${device.name} seç`} />
                        </td>
                        <td>
                          <strong>{device.name}</strong>
                          <div className="helper mono">{device.uuid.slice(0, 14)}</div>
                        </td>
                        <td>
                          <span className="status-chip">
                            <span className={statusClass(device.status)} />
                            {STATUS_LABEL[device.status] ?? device.status}
                          </span>
                        </td>
                        <td>{device.fingerprint?.country ?? flag(device.metadata)}</td>
                        <td>Android {device.fingerprint?.osVersion ?? device.androidVersion ?? '—'}</td>
                        <td className="mono">{device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : '—'}</td>
                        <td>{device.group?.name ?? 'Grupsuz'}</td>
                        <td className="mono">
                          {Math.round(device.cpuUsage)}% / {Math.round(device.memoryUsage)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HoloPanel>
        </Reveal>
      )}

      <footer className="profiles-foot">
        <span className="helper mono">Toplam: {filtered.length} kayıt</span>
      </footer>

      {moveOpen ? (
        <div className="modal-overlay" onClick={closeMove}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><FolderInput size={16} /> {selectionCount} profili taşı</h2>
              <button type="button" className="modal-close" onClick={closeMove}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>Mevcut grup</span>
              <select className="field-input" value={moveGroup} onChange={(e) => setMoveGroup(e.target.value)} disabled={!!newGroup}>
                <option value="">— seçin —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Veya yeni grup oluştur</span>
              <input className="field-input" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="örn. Kampanya A" />
            </label>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeMove}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={moveSelected}>
                {busy ? 'Taşınıyor…' : 'Taşı'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="modal-overlay" onClick={closeCreate}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Plus size={16} /> Yeni profil</h2>
              <button type="button" className="modal-close" onClick={closeCreate}>
                <X size={16} />
              </button>
            </header>

            <label className="field">
              <span>Profil adı</span>
              <input
                type="text"
                className="field-input"
                placeholder="örn. Bulut telefon profili_US_04"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Cihaz modeli</span>
              <select
                className="field-input"
                value={form.deviceModel}
                onChange={(e) => setForm((f) => ({ ...f, deviceModel: e.target.value }))}
              >
                <option value="">Rastgele (otomatik)</option>
                {(catalog?.models ?? []).map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.manufacturer} {m.model} · {m.resolution}
                  </option>
                ))}
              </select>
            </label>

            <div className="field-row">
              <label className="field">
                <span>Android sürümü</span>
                <select
                  className="field-input"
                  value={form.androidVersion}
                  onChange={(e) => setForm((f) => ({ ...f, androidVersion: e.target.value }))}
                >
                  {modelOsVersions.map((v) => (
                    <option key={v} value={v}>Android {v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Konum (SIM / GPS)</span>
                <select
                  className="field-input"
                  value={form.countryCode}
                  onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value }))}
                >
                  {countries.length === 0 ? (
                    <option value="US">Amerika Birleşik Devletleri</option>
                  ) : (
                    countries.map((c) => (
                      <option key={c.countryCode} value={c.countryCode}>
                        {c.country}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>RAM</span>
                <select className="field-input" value={form.ramGb} onChange={(e) => setForm((f) => ({ ...f, ramGb: e.target.value }))}>
                  {(catalog?.ramTiers ?? [4, 6, 8, 12]).map((r) => <option key={r} value={String(r)}>{r} GB</option>)}
                </select>
              </label>
              <label className="field">
                <span>CPU çekirdek</span>
                <select className="field-input" value={form.cpuCores} onChange={(e) => setForm((f) => ({ ...f, cpuCores: e.target.value }))}>
                  {(catalog?.cpuTiers ?? [4, 6, 8]).map((c) => <option key={c} value={String(c)}>{c} çekirdek</option>)}
                </select>
              </label>
            </div>

            <p className="helper">
              Seçilen modele uygun benzersiz bir cihaz parmak izi (IMEI, operatör, MAC, çözünürlük) otomatik oluşturulur. Model boş bırakılırsa rastgele seçilir.
            </p>

            {error ? <p className="field-error">{error}</p> : null}

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeCreate}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={createProfile}>
                {busy ? 'Oluşturuluyor…' : 'Profil oluştur'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {fpDevice ? (
        <div className="modal-overlay" onClick={() => !fpBusy && setFpDevice(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Fingerprint size={16} /> Cihaz parmak izi — {fpDevice.name}</h2>
              <button type="button" className="modal-close" onClick={() => !fpBusy && setFpDevice(null)}>
                <X size={16} />
              </button>
            </header>

            {fpDevice.fingerprint ? (
              <div className="fp-grid">
                <FpRow label="Cihaz" value={`${fpDevice.fingerprint.manufacturer} ${fpDevice.fingerprint.model}`} />
                <FpRow label="OS / Yapı" value={`Android ${fpDevice.fingerprint.osVersion} · ${fpDevice.fingerprint.buildNumber}`} />
                <FpRow label="IMEI" value={fpDevice.fingerprint.imei} mono />
                <FpRow label="Android ID" value={fpDevice.fingerprint.androidId} mono />
                <FpRow label="Seri No" value={fpDevice.fingerprint.serialNo} mono />
                <FpRow label="MAC" value={fpDevice.fingerprint.macAddress} mono />
                <FpRow label="Çözünürlük" value={`${fpDevice.fingerprint.resolution} @ ${fpDevice.fingerprint.dpi}dpi`} />
                <FpRow label="Operatör" value={`${fpDevice.fingerprint.carrier} (${fpDevice.fingerprint.mcc}/${fpDevice.fingerprint.mnc})`} />
                <FpRow label="Telefon" value={fpDevice.fingerprint.phoneNumber ?? '—'} mono />
                <FpRow label="Yerel ayar" value={`${fpDevice.fingerprint.country} · ${fpDevice.fingerprint.language} · ${fpDevice.fingerprint.timezone}`} />
              </div>
            ) : (
              <p className="helper">Henüz parmak izi yok — oluşturmak için yeniden üretin.</p>
            )}

            <div className="modal-section">
              <h3><MapPin size={14} /> GPS / SIM simülasyonu</h3>
              <label className="field-check">
                <input
                  type="checkbox"
                  className="admin-switch"
                  checked={gpsForm.gpsEnabled}
                  onChange={(e) => setGpsForm((g) => ({ ...g, gpsEnabled: e.target.checked }))}
                />
                <span>GPS sahteciliğini etkinleştir</span>
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Enlem</span>
                  <input
                    className="field-input"
                    value={gpsForm.latitude}
                    onChange={(e) => setGpsForm((g) => ({ ...g, latitude: e.target.value }))}
                    placeholder="e.g. 41.0082"
                  />
                </label>
                <label className="field">
                  <span>Boylam</span>
                  <input
                    className="field-input"
                    value={gpsForm.longitude}
                    onChange={(e) => setGpsForm((g) => ({ ...g, longitude: e.target.value }))}
                    placeholder="e.g. 28.9784"
                  />
                </label>
              </div>
              <label className="field">
                <span>Ülke (SIM + saat dilimini günceller)</span>
                <select
                  className="field-input"
                  value={gpsForm.countryCode}
                  onChange={(e) => setGpsForm((g) => ({ ...g, countryCode: e.target.value }))}
                >
                  <option value="">— mevcut kalsın —</option>
                  {countries.map((c) => (
                    <option key={c.countryCode} value={c.countryCode}>
                      {c.country}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" disabled={fpBusy} onClick={regenerateFingerprint}>
                {fpBusy ? '…' : <><RefreshCw size={13} /> Parmak izini yeniden üret</>}
              </button>
              <button type="button" className="btn-primary" disabled={fpBusy} onClick={saveGps}>
                {fpBusy ? 'Kaydediliyor…' : 'GPS kaydet'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {pushOpen ? (
        <div className="modal-overlay" onClick={closePush}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Send size={16} /> {selectionCount} telefona dosya gönder</h2>
              <button type="button" className="modal-close" onClick={closePush}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>Dosya URL</span>
              <input
                className="field-input mono"
                value={pushForm.url}
                onChange={(e) => setPushForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/video.mp4"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Dosya adı (isteğe bağlı)</span>
                <input
                  className="field-input"
                  value={pushForm.fileName}
                  onChange={(e) => setPushForm((f) => ({ ...f, fileName: e.target.value }))}
                  placeholder="video.mp4"
                />
              </label>
              <label className="field">
                <span>Hedef</span>
                <select
                  className="field-input"
                  value={pushForm.destination}
                  onChange={(e) => setPushForm((f) => ({ ...f, destination: e.target.value }))}
                >
                  <option value="gallery">Galeri (DCIM)</option>
                  <option value="downloads">İndirilenler</option>
                </select>
              </label>
            </div>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closePush}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={pushFile}>
                {busy ? 'Gönderiliyor…' : 'Dosya gönder'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {proxyOpen ? (
        <div className="modal-overlay" onClick={closeProxy}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Network size={16} /> {selectionCount} telefona proxy ata</h2>
              <button type="button" className="modal-close" onClick={closeProxy}>
                <X size={16} />
              </button>
            </header>
            {proxies.length === 0 ? (
              <p className="helper">Henüz proxy yapılandırılmadı. Önce Proxy'ler sayfasından bir tane ekleyin.</p>
            ) : (
              <label className="field">
                <span>Proxy</span>
                <select className="field-input" value={proxyChoice} onChange={(e) => setProxyChoice(e.target.value)}>
                  <option value="">Bir proxy seçin…</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.type} {p.host}:{p.port}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeProxy}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy || !proxyChoice} onClick={assignProxy}>
                {busy ? 'Atanıyor…' : 'Proxy ata'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {appOpen ? (
        <div className="modal-overlay" onClick={closeApp}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Package size={16} /> {selectionCount} telefona uygulama yükle</h2>
              <button type="button" className="modal-close" onClick={closeApp}>
                <X size={16} />
              </button>
            </header>
            {apps.length === 0 ? (
              <p className="helper">Katalogda henüz uygulama yok.</p>
            ) : (
              <label className="field">
                <span>Uygulama</span>
                <select className="field-input" value={appChoice} onChange={(e) => setAppChoice(e.target.value)}>
                  <option value="">Bir uygulama seçin…</option>
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.version}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeApp}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy || !appChoice} onClick={installApp}>
                {busy ? 'Yükleniyor…' : 'Uygulama yükle'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FpRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="fp-row">
      <span className="helper">{label}</span>
      <span className={mono ? 'mono' : undefined}>{value}</span>
    </div>
  );
}
