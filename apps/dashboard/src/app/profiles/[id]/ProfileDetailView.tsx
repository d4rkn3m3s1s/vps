'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../../components/PageHeader';
import { PageMotion } from '../../../components/Motion';
import { AdbAccessPanel } from './AdbAccessPanel';
import { LiveScreen } from './LiveScreen';
import { SnapshotPanel } from './SnapshotPanel';
import { DeviceAccessPanel } from './DeviceAccessPanel';
import { FileClipboardPanel } from './FileClipboardPanel';

export type DetailFingerprint = {
  imei: string;
  manufacturer: string;
  model: string;
  osVersion: string;
  buildNumber: string;
  macAddress: string;
  resolution: string;
  dpi: number;
  carrier: string;
  country: string;
  timezone: string;
  language: string;
  latitude: number | null;
  longitude: number | null;
  gpsEnabled: boolean;
};

export type DetailHost = {
  id: string;
  name: string;
  region?: string | null;
  status: string;
};

export type DetailDevice = {
  id: string;
  name: string;
  status: string;
  ipAddress: string | null;
  adbPort: number | null;
  androidVersion: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  lastSeen: string | null;
  hostId?: string | null;
  group?: { id: string; name: string } | null;
  host?: { id: string; name: string } | null;
  fingerprint?: DetailFingerprint | null;
};

export type DetailJob = {
  id: string;
  type: string;
  status: string;
  emulatorId: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  ONLINE: 'Çalışıyor',
  OFFLINE: 'Durduruldu',
  STARTING: 'Başlatılıyor',
  STOPPING: 'Durduruluyor',
  ERROR: 'Hata'
};

function statusDot(status: string): string {
  if (status === 'ONLINE' || status === 'COMPLETED') return 'dot dot-online';
  if (status === 'ERROR' || status === 'FAILED') return 'dot dot-error';
  if (status === 'STARTING' || status === 'STOPPING' || status === 'RUNNING') return 'dot dot-busy';
  return 'dot dot-offline';
}

export function ProfileDetailView({
  device,
  jobs,
  hosts
}: {
  device: DetailDevice;
  jobs: DetailJob[];
  hosts: DetailHost[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string>(device.host?.id ?? device.hostId ?? '');
  const fp = device.fingerprint;

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 3000);
  }

  async function action(jobType: string, status: string, label: string) {
    setBusy(label);
    try {
      await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [device.id], jobType })
      });
      await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      flash(`${label} sıraya alındı`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function screenshot() {
    setBusy('Ekran görüntüsü');
    try {
      await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [device.id], jobType: 'EMULATOR_SCREENSHOT' })
      });
      flash('Ekran görüntüsü sıraya alındı — Görevler bölümüne bakın');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Assigns (or clears, when empty) the KVM host this device physically runs on.
  // The host agent only claims jobs for devices assigned to it.
  async function assignHost(next: string) {
    setHostId(next);
    setBusy('Host');
    try {
      await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: next === '' ? null : next })
      });
      flash(next === '' ? 'Sunucu kaldırıldı' : 'Sunucu atandı');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title={device.name}
        subtitle={`${STATUS_LABEL[device.status] ?? device.status} · ${fp?.country ?? '—'}`}
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => action('EMULATOR_START', 'STARTING', 'Başlat')}>
              ▷ Başlat
            </button>
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => action('EMULATOR_STOP', 'STOPPING', 'Durdur')}>
              ◻ Durdur
            </button>
            <button type="button" className="btn-primary" disabled={!!busy} onClick={screenshot}>
              ◰ Ekran görüntüsü
            </button>
          </>
        }
      />

      {toast ? <div className="toast toast-ok">{toast}</div> : null}

      <LiveScreen deviceId={device.id} online={device.status === 'ONLINE'} />

      <section className="section-grid" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h2>Canlı durum</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">Durum</span>
              <span className="status-chip"><span className={statusDot(device.status)} /> {STATUS_LABEL[device.status] ?? device.status}</span>
            </div>
            <div className="row"><span className="helper">CPU</span><span className="mono">{Math.round(device.cpuUsage)}%</span></div>
            <div className="row"><span className="helper">Bellek</span><span className="mono">{Math.round(device.memoryUsage)}%</span></div>
            <div className="row"><span className="helper">Disk</span><span className="mono">{Math.round(device.diskUsage)}%</span></div>
            <div className="row"><span className="helper">ADB uç noktası</span><span className="mono">{device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : 'sunucu bekleniyor'}</span></div>
            <div className="row"><span className="helper">Grup</span><span>{device.group?.name ?? 'Grupsuz'}</span></div>
            <div className="row">
              <span className="helper">KVM sunucusu</span>
              <select
                className="inline-select"
                value={hostId}
                disabled={busy === 'Host'}
                onChange={(e) => assignHost(e.target.value)}
              >
                <option value="">Atanmamış</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                    {h.region ? ` · ${h.region}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="row"><span className="helper">Son görülme</span><span className="mono">{device.lastSeen ? new Date(device.lastSeen).toLocaleString('tr-TR') : 'hiç'}</span></div>
          </div>
        </div>

        <div className="panel">
          <h2>Cihaz parmak izi</h2>
          {fp ? (
            <div className="panel-stack">
              <div className="row"><span className="helper">Model</span><span>{fp.manufacturer} {fp.model}</span></div>
              <div className="row"><span className="helper">OS</span><span className="mono">Android {fp.osVersion}</span></div>
              <div className="row"><span className="helper">IMEI</span><span className="mono">{fp.imei}</span></div>
              <div className="row"><span className="helper">MAC</span><span className="mono">{fp.macAddress}</span></div>
              <div className="row"><span className="helper">Ekran</span><span className="mono">{fp.resolution} @ {fp.dpi}dpi</span></div>
              <div className="row"><span className="helper">Operatör</span><span>{fp.carrier}</span></div>
              <div className="row"><span className="helper">Yerel ayar</span><span>{fp.country} · {fp.language} · {fp.timezone}</span></div>
              <div className="row">
                <span className="helper">GPS</span>
                <span className="mono">
                  {fp.gpsEnabled ? `${fp.latitude ?? '—'}, ${fp.longitude ?? '—'}` : 'devre dışı'}
                </span>
              </div>
            </div>
          ) : (
            <p className="helper">Parmak izi oluşturulmadı.</p>
          )}
        </div>
      </section>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h2>Görev geçmişi ({jobs.length})</h2>
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Tür</th>
                <th>Durum</th>
                <th>Zaman</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="table-empty">
                      <div className="empty-art">☰</div>
                      <span>Bu profil için henüz görev yok</span>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id}>
                    <td><strong>{j.type}</strong></td>
                    <td><span className="status-chip"><span className={statusDot(j.status)} /> {j.status}</span></td>
                    <td className="helper">{new Date(j.createdAt).toLocaleString('tr-TR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SnapshotPanel deviceId={device.id} />

      <FileClipboardPanel deviceId={device.id} />

      <DeviceAccessPanel deviceId={device.id} />

      <AdbAccessPanel deviceId={device.id} />
    </PageMotion>
  );
}
