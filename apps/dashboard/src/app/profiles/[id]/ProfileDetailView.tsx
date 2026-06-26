'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Fingerprint,
  History,
  Play,
  Square,
  Camera,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Layers,
  Server,
  Clock,
  Smartphone,
  Radio,
  MapPin,
  Globe,
  Hash,
  Wifi,
  Monitor
} from 'lucide-react';
import { PageMotion } from '../../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../../components/hud';
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

const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Beklemede',
  RUNNING: 'Çalışıyor',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız'
};

const JOB_TYPE_LABEL: Record<string, string> = {
  EMULATOR_CREATE: 'Cihaz oluştur',
  EMULATOR_START: 'Başlat',
  EMULATOR_STOP: 'Durdur',
  EMULATOR_DELETE: 'Cihaz sil',
  EMULATOR_INSTALL_APK: 'APK kur',
  EMULATOR_SCREENSHOT: 'Ekran görüntüsü',
  EMULATOR_SHELL: 'Kabuk komutu',
  EMULATOR_OPEN_APP: 'Uygulama aç',
  EMULATOR_CLOSE_APP: 'Uygulama kapat',
  EMULATOR_PUSH_FILE: 'Dosya gönder',
  EMULATOR_SET_PROXY: 'Proxy ayarla',
  RPA_RUN: 'RPA çalıştır',
  EMULATOR_SNAPSHOT_CREATE: 'Anlık görüntü oluştur',
  EMULATOR_SNAPSHOT_RESTORE: 'Anlık görüntü geri yükle',
  EMULATOR_RESET: 'Sıfırla',
  EMULATOR_PULL_FILE: 'Dosya çek',
  EMULATOR_CLIPBOARD_SET: 'Pano ayarla',
  EMULATOR_CLIPBOARD_GET: 'Pano oku',
  REGISTER_INSTAGRAM: 'Instagram kaydı',
  REGISTER_WHATSAPP: 'WhatsApp kaydı',
  WHATSAPP_SEND: 'WhatsApp gönder',
  WHATSAPP_READ: 'WhatsApp oku'
};

function statusDot(status: string): string {
  if (status === 'ONLINE' || status === 'COMPLETED') return 'dot dot-online';
  if (status === 'ERROR' || status === 'FAILED') return 'dot dot-error';
  if (status === 'STARTING' || status === 'STOPPING' || status === 'RUNNING') return 'dot dot-busy';
  return 'dot dot-offline';
}

function statusTone(status: string): 'success' | 'error' | 'warning' | 'cyan' {
  if (status === 'ONLINE' || status === 'COMPLETED') return 'success';
  if (status === 'ERROR' || status === 'FAILED') return 'error';
  if (status === 'STARTING' || status === 'STOPPING' || status === 'RUNNING') return 'warning';
  return 'cyan';
}

function usageTone(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 85) return 'error';
  if (pct >= 60) return 'warning';
  return 'success';
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
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [hostId, setHostId] = useState<string>(device.host?.id ?? device.hostId ?? '');
  const fp = device.fingerprint;

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3000);
  }

  async function action(jobType: string, status: string, label: string) {
    setBusy(label);
    try {
      const jobRes = await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [device.id], jobType })
      });
      if (!jobRes.ok) {
        flash(`${label} başarısız oldu`, 'err');
        return;
      }
      const statusRes = await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!statusRes.ok) {
        flash(`${label} başarısız oldu`, 'err');
        return;
      }
      flash(`${label} sıraya alındı`, 'ok');
      router.refresh();
    } catch {
      flash(`${label} başarısız oldu`, 'err');
    } finally {
      setBusy(null);
    }
  }

  async function screenshot() {
    setBusy('Ekran görüntüsü');
    try {
      const res = await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: [device.id], jobType: 'EMULATOR_SCREENSHOT' })
      });
      if (!res.ok) {
        flash('Ekran görüntüsü başarısız oldu', 'err');
        return;
      }
      flash('Ekran görüntüsü sıraya alındı — Görevler bölümüne bakın', 'ok');
      router.refresh();
    } catch {
      flash('Ekran görüntüsü başarısız oldu', 'err');
    } finally {
      setBusy(null);
    }
  }

  // Assigns (or clears, when empty) the KVM host this device physically runs on.
  // The host agent only claims jobs for devices assigned to it.
  async function assignHost(next: string) {
    const prev = hostId;
    setHostId(next);
    setBusy('Host');
    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: next === '' ? null : next })
      });
      if (!res.ok) {
        setHostId(prev);
        flash('Sunucu atanamadı', 'err');
        return;
      }
      flash(next === '' ? 'Sunucu kaldırıldı' : 'Sunucu atandı', 'ok');
      router.refresh();
    } catch {
      setHostId(prev);
      flash('Sunucu atanamadı', 'err');
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="CİHAZ DETAYI"
        title={device.name}
        subtitle={`${STATUS_LABEL[device.status] ?? device.status} · ${fp?.country ?? '—'}`}
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => action('EMULATOR_START', 'STARTING', 'Başlat')}>
              <Play size={14} /> Başlat
            </button>
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => action('EMULATOR_STOP', 'STOPPING', 'Durdur')}>
              <Square size={14} /> Durdur
            </button>
            <button type="button" className="btn-primary" disabled={!!busy} onClick={screenshot}>
              <Camera size={14} /> Ekran görüntüsü
            </button>
          </>
        }
      />

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}

      <Reveal className="holo-stats-grid" delay={0.02}>
        <HoloStat
          label="Durum"
          value={
            <span className="status-chip">
              <span className={statusDot(device.status)} /> {STATUS_LABEL[device.status] ?? device.status}
            </span>
          }
          sub={fp?.country ?? '—'}
          tone={statusTone(device.status)}
          icon={<Radio size={16} />}
        />
        <HoloStat
          label="CPU"
          value={<span className="mono">{Math.round(device.cpuUsage)}%</span>}
          sub="işlemci yükü"
          tone={usageTone(device.cpuUsage)}
          icon={<Cpu size={16} />}
        />
        <HoloStat
          label="Bellek"
          value={<span className="mono">{Math.round(device.memoryUsage)}%</span>}
          sub="RAM kullanımı"
          tone={usageTone(device.memoryUsage)}
          icon={<MemoryStick size={16} />}
        />
        <HoloStat
          label="Disk"
          value={<span className="mono">{Math.round(device.diskUsage)}%</span>}
          sub="depolama"
          tone={usageTone(device.diskUsage)}
          icon={<HardDrive size={16} />}
        />
      </Reveal>

      <Reveal delay={0.06} className="holo-stack-1">
        <LiveScreen deviceId={device.id} online={device.status === 'ONLINE'} />
      </Reveal>

      <Reveal className="holo-grid-2 holo-stack-1" delay={0.08}>
        <HoloPanel title="Canlı durum" icon={<Activity size={16} />} tilt>
          <div className="panel-stack">
            <div className="row">
              <span className="helper"><Radio size={13} /> Durum</span>
              <span className="status-chip"><span className={statusDot(device.status)} /> {STATUS_LABEL[device.status] ?? device.status}</span>
            </div>
            <div className="row"><span className="helper"><Cpu size={13} /> CPU</span><span className="mono">{Math.round(device.cpuUsage)}%</span></div>
            <div className="row"><span className="helper"><MemoryStick size={13} /> Bellek</span><span className="mono">{Math.round(device.memoryUsage)}%</span></div>
            <div className="row"><span className="helper"><HardDrive size={13} /> Disk</span><span className="mono">{Math.round(device.diskUsage)}%</span></div>
            <div className="row"><span className="helper"><Network size={13} /> ADB uç noktası</span><span className="mono">{device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : 'sunucu bekleniyor'}</span></div>
            <div className="row"><span className="helper"><Layers size={13} /> Grup</span><span>{device.group?.name ?? 'Grupsuz'}</span></div>
            <div className="row">
              <span className="helper"><Server size={13} /> KVM sunucusu</span>
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
            <div className="row"><span className="helper"><Clock size={13} /> Son görülme</span><span className="mono">{device.lastSeen ? new Date(device.lastSeen).toLocaleString('tr-TR') : 'hiç'}</span></div>
          </div>
        </HoloPanel>

        <HoloPanel title="Cihaz parmak izi" icon={<Fingerprint size={16} />} tilt>
          {fp ? (
            <div className="panel-stack">
              <div className="row"><span className="helper"><Smartphone size={13} /> Model</span><span>{fp.manufacturer} {fp.model}</span></div>
              <div className="row"><span className="helper"><Hash size={13} /> OS</span><span className="mono">Android {fp.osVersion}</span></div>
              <div className="row"><span className="helper"><Hash size={13} /> IMEI</span><span className="mono">{fp.imei}</span></div>
              <div className="row"><span className="helper"><Wifi size={13} /> MAC</span><span className="mono">{fp.macAddress}</span></div>
              <div className="row"><span className="helper"><Monitor size={13} /> Ekran</span><span className="mono">{fp.resolution} @ {fp.dpi}dpi</span></div>
              <div className="row"><span className="helper"><Radio size={13} /> Operatör</span><span>{fp.carrier}</span></div>
              <div className="row"><span className="helper"><Globe size={13} /> Yerel ayar</span><span>{fp.country} · {fp.language} · {fp.timezone}</span></div>
              <div className="row">
                <span className="helper"><MapPin size={13} /> GPS</span>
                <span className="mono">
                  {fp.gpsEnabled ? `${fp.latitude ?? '—'}, ${fp.longitude ?? '—'}` : 'devre dışı'}
                </span>
              </div>
            </div>
          ) : (
            <p className="helper">Parmak izi oluşturulmadı.</p>
          )}
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.1} className="holo-stack-1">
        <HoloPanel title={`Görev geçmişi (${jobs.length})`} icon={<History size={16} />}>
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
                      <td><strong>{JOB_TYPE_LABEL[j.type] ?? j.type}</strong></td>
                      <td><span className="status-chip"><span className={statusDot(j.status)} /> {JOB_STATUS_LABEL[j.status] ?? j.status}</span></td>
                      <td className="helper">{new Date(j.createdAt).toLocaleString('tr-TR')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.12} className="holo-stack-1">
        <SnapshotPanel deviceId={device.id} />
      </Reveal>

      <Reveal delay={0.14} className="holo-stack-1">
        <FileClipboardPanel deviceId={device.id} />
      </Reveal>

      <Reveal delay={0.16} className="holo-stack-1">
        <DeviceAccessPanel deviceId={device.id} />
      </Reveal>

      <Reveal delay={0.18} className="holo-stack-1">
        <AdbAccessPanel deviceId={device.id} />
      </Reveal>
    </PageMotion>
  );
}
