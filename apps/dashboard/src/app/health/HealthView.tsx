'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Cpu, MemoryStick, HardDrive, RefreshCw, ServerCog, Wifi, AlertTriangle, Gauge } from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, Holo3D } from '../../components/hud';
import { PageMotion } from '../../components/Motion';
import { usePolling } from '../../lib/usePolling';

type Device = {
  id: string;
  name: string;
  status: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  lastSeen?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  ONLINE: 'Çalışıyor',
  OFFLINE: 'Çevrimdışı',
  ERROR: 'Hata',
  BUSY: 'Meşgul',
  STARTING: 'Başlatılıyor',
  STOPPING: 'Durduruluyor',
  REBOOTING: 'Yeniden başlatılıyor',
  UPDATING: 'Güncelleniyor'
};

function statusClass(status: string): string {
  switch (status) {
    case 'ONLINE':
      return 'dot dot-online';
    case 'ERROR':
      return 'dot dot-error';
    case 'BUSY':
    case 'STARTING':
    case 'STOPPING':
    case 'UPDATING':
    case 'REBOOTING':
      return 'dot dot-busy';
    default:
      return 'dot dot-offline';
  }
}

function pct(n?: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  // Values may arrive as 0-1 or 0-100; normalize to 0-100.
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function barTone(p: number): string {
  if (p >= 85) return 'bar-bad';
  if (p >= 60) return 'bar-warn';
  return 'bar-ok';
}

function ago(iso?: string | null): string {
  if (!iso) return 'hiç';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

export function HealthView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/devices');
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      if (Array.isArray(json.data)) setDevices(json.data);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Initial load on mount.
  useEffect(() => { void load(); }, []);
  // Auto-refresh every 15s for a live feel (skips while the tab is hidden).
  usePolling(() => void load(true), 15000);

  const stats = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.status === 'ONLINE').length;
    const error = devices.filter((d) => d.status === 'ERROR').length;
    const offline = devices.filter((d) => d.status === 'OFFLINE').length;
    const avg = (key: 'cpuUsage' | 'memoryUsage' | 'diskUsage') => {
      if (!total) return 0;
      return Math.round(devices.reduce((s, d) => s + pct(d[key]), 0) / total);
    };
    return { total, online, error, offline, cpu: avg('cpuUsage'), mem: avg('memoryUsage'), disk: avg('diskUsage') };
  }, [devices]);

  // Surface the most loaded devices first.
  const sorted = useMemo(
    () => [...devices].sort((a, b) => pct(b.cpuUsage) - pct(a.cpuUsage)),
    [devices]
  );

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="SAĞLIK İZLEME"
        title="Filo sağlığı"
        subtitle="Tüm bulut telefonlardaki canlı kaynak kullanımı ve durum."
        actions={
          <button type="button" className="btn-ghost" onClick={() => load(true)} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Yenile
          </button>
        }
      />

      {/* Top summary */}
      <div className="holo-stats-grid">
        <HoloStat
          label="Çevrimiçi"
          tone="success"
          icon={<Wifi size={16} />}
          value={<span className="mono">{stats.online}</span>}
          sub={<span className="mono">/ {stats.total} cihaz</span>}
        />
        <HoloStat
          label="Ort. CPU"
          tone="cyan"
          icon={<Cpu size={16} />}
          value={<span className="mono">{stats.cpu}%</span>}
        />
        <HoloStat
          label="Ort. bellek"
          tone="violet"
          icon={<MemoryStick size={16} />}
          value={<span className="mono">{stats.mem}%</span>}
        />
        <HoloStat
          label="Hatalar"
          tone={stats.error > 0 ? 'error' : 'neutral'}
          icon={<AlertTriangle size={16} />}
          value={<span className="mono">{stats.error}</span>}
          sub={<span className="mono">{stats.offline} çevrimdışı</span>}
        />
      </div>

      {/* Fleet-wide averages */}
      <HoloPanel title="Filo ortalamaları" icon={<Activity size={16} />}>
        <div className="health-avg-grid">
          <GaugeRow icon={<Cpu size={14} />} label="CPU" value={stats.cpu} />
          <GaugeRow icon={<MemoryStick size={14} />} label="Bellek" value={stats.mem} />
          <GaugeRow icon={<HardDrive size={14} />} label="Disk" value={stats.disk} />
        </div>
      </HoloPanel>

      {/* Per-device */}
      <HoloPanel title="Cihazlar" icon={<ServerCog size={16} />} scan={false}>
        {loading ? (
          <div className="holo-grid-auto">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton-row" key={i} />
            ))}
          </div>
        ) : error ? (
          <div>
            <p className="form-status form-status--err">Filo sağlığı yüklenemedi.</p>
            <button type="button" className="btn-ghost" onClick={() => load(true)}>
              Tekrar dene
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <p className="helper">Henüz cihaz yok.</p>
        ) : (
          <div className="holo-grid-auto">
            {sorted.map((d) => {
              const c = pct(d.cpuUsage);
              const m = pct(d.memoryUsage);
              const k = pct(d.diskUsage);
              return (
                <Holo3D className="holo-card health-card" key={d.id} max={7}>
                  <div className="health-card-head">
                    <span className="health-name">{d.name}</span>
                    <span className="status-chip">
                      <span className={statusClass(d.status)} />
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
                  </div>
                  <div className="health-card-metrics">
                    <MetricLine icon={<Cpu size={13} />} label="CPU" value={c} />
                    <MetricLine icon={<MemoryStick size={13} />} label="Bellek" value={m} />
                    <MetricLine icon={<HardDrive size={13} />} label="Disk" value={k} />
                  </div>
                  <div className="health-card-foot helper">
                    <Gauge size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Son görülme: <span className="mono">{ago(d.lastSeen)}</span>
                  </div>
                </Holo3D>
              );
            })}
          </div>
        )}
      </HoloPanel>
    </PageMotion>
  );
}

function GaugeRow({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="health-gauge">
      <div className="health-gauge-head">
        <span>{icon} {label}</span>
        <span className="mono">{value}%</span>
      </div>
      <div className="health-bar">
        <div className={`health-bar-fill ${barTone(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function MetricLine({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="health-usage">
      <span className="health-usage-head">
        <span className="health-usage-ico">{icon}</span>
        <span>{label}</span>
        <span className="health-usage-num mono">{value}%</span>
      </span>
      <span className="health-bar health-bar-sm">
        <span className={`health-bar-fill ${barTone(value)}`} style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}
