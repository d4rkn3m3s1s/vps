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

type FleetHealth = {
  devices: { total: number; online: number; offline: number; error: number };
  waAccounts: { total: number; active: number; restricted: number; banned: number; loggedOut: number; awaitingOtp: number; awaitingManual: number; failed: number };
  today: { started: number; active: number; failed: number; successRate: number };
  host: { avgCpu: number; avgMem: number; avgDisk: number; onlineDevices: number };
};
type Bucket = { key: string; total: number; active: number; failed: number; successRate: number };
type RegisterAnalytics = {
  byCountry: Bucket[]; byProxyCountry: Bucket[]; byModel: Bucket[];
  overall: { total: number; active: number; failed: number; successRate: number };
};

export function HealthView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [health, setHealth] = useState<FleetHealth | null>(null);
  const [analytics, setAnalytics] = useState<RegisterAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const [devRes, healthRes, anaRes] = await Promise.all([
        fetch('/api/devices'),
        fetch('/api/fleet-health/summary'),
        fetch('/api/fleet-health/register-analytics?days=30')
      ]);
      if (!devRes.ok) throw new Error('fetch failed');
      const devJson = await devRes.json();
      if (Array.isArray(devJson.data)) setDevices(devJson.data);
      if (healthRes.ok) { const j = await healthRes.json(); if (j?.data) setHealth(j.data as FleetHealth); }
      if (anaRes.ok) { const j = await anaRes.json(); if (j?.data) setAnalytics(j.data as RegisterAnalytics); }
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

      {/* WhatsApp hesap sağlığı + bugünkü kayıt özeti */}
      {health ? (
        <HoloPanel title="WhatsApp hesap sağlığı" icon={<Activity size={16} />}>
          <div className="wa-health-grid">
            <WaStat label="Aktif" value={health.waAccounts.active} tone="#22c55e" />
            <WaStat label="Kısıtlı" value={health.waAccounts.restricted} tone="#eab308" />
            <WaStat label="Yasaklı" value={health.waAccounts.banned} tone="#ef4444" />
            <WaStat label="Çıkış yapıldı" value={health.waAccounts.loggedOut} tone="#f59e0b" />
            <WaStat label="OTP bekliyor" value={health.waAccounts.awaitingOtp} tone="#6366f1" />
            <WaStat label="Başarısız" value={health.waAccounts.failed} tone="#94a3b8" />
          </div>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <span>📅 <b>Bugün:</b> {health.today.started} kayıt başladı</span>
            <span style={{ color: '#22c55e' }}>✓ {health.today.active} aktif</span>
            <span style={{ color: '#ef4444' }}>✗ {health.today.failed} başarısız</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700 }}>Başarı: %{health.today.successRate}</span>
          </div>
        </HoloPanel>
      ) : null}

      {/* Kayıt başarı analitiği — hangi ülke/proxy/model daha iyi kaydediyor */}
      {analytics && analytics.overall.total > 0 ? (
        <HoloPanel title={`Kayıt başarı analitiği (son 30 gün · genel %${analytics.overall.successRate})`} icon={<Gauge size={16} />}>
          <div className="analytics-3col">
            <AnalyticsTable title="Ülkeye göre" rows={analytics.byCountry} />
            <AnalyticsTable title="Proxy ülkesine göre" rows={analytics.byProxyCountry} />
            <AnalyticsTable title="Cihaz modeline göre" rows={analytics.byModel} />
          </div>
        </HoloPanel>
      ) : null}

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

// A single WhatsApp-account-health stat tile (count + coloured label).
function WaStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="wa-stat">
      <span className="wa-stat-value mono" style={{ color: tone }}>{value}</span>
      <span className="wa-stat-label">{label}</span>
    </div>
  );
}

// A registration-success breakdown table (by country / proxy / model). Colours the
// success-rate cell green/yellow/red so the operator sees at a glance what works.
function AnalyticsTable({ title, rows }: { title: string; rows: Bucket[] }) {
  const rateTone = (r: number) => (r >= 60 ? '#22c55e' : r >= 30 ? '#eab308' : '#ef4444');
  return (
    <div className="analytics-table">
      <div className="analytics-table-title">{title}</div>
      {rows.length === 0 ? (
        <div style={{ opacity: 0.5, fontSize: 12, padding: '6px 0' }}>Veri yok</div>
      ) : (
        <table>
          <thead>
            <tr><th>Değer</th><th>Top.</th><th>✓</th><th>Başarı</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.key}>
                <td title={r.key}>{r.key}</td>
                <td className="mono">{r.total}</td>
                <td className="mono" style={{ color: '#22c55e' }}>{r.active}</td>
                <td className="mono" style={{ color: rateTone(r.successRate), fontWeight: 700 }}>%{r.successRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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
