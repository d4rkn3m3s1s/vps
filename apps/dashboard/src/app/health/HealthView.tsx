'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, Cpu, MemoryStick, HardDrive, RefreshCw, ServerCog, Wifi, AlertTriangle, Gauge } from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, Holo3D } from '../../components/hud';
import { PageMotion } from '../../components/Motion';
import { usePolling } from '../../lib/usePolling';
import { useFleetEvents } from '../../lib/live';

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

// Map an AlertTrigger to a banner severity class. Bans / mass-offline are critical;
// saturation / proxy / device-offline are warnings; the rest neutral.
function alertTone(trigger?: string): string {
  switch (trigger) {
    case 'ACCOUNT_BANNED':
    case 'FLEET_MASS_OFFLINE':
    case 'HOST_OFFLINE':
      return 'alert-crit';
    case 'HOST_SATURATED':
    case 'PROXY_UNHEALTHY':
    case 'DEVICE_OFFLINE':
    case 'FARM_BAN_RISK':
      return 'alert-warn';
    default:
      return 'alert-info';
  }
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

type HostRow = {
  id: string; name: string; status: string;
  load1: number | null; cpuCores: number | null; saturationPct: number | null;
  diskFreeGb: number | null; ramFreeGb: number | null; monitorStale: boolean;
};
type FleetHealth = {
  devices: { total: number; online: number; offline: number; error: number };
  waAccounts: { total: number; active: number; restricted: number; banned: number; loggedOut: number; awaitingOtp: number; awaitingManual: number; failed: number };
  today: { started: number; active: number; failed: number; successRate: number };
  host: { avgCpu: number; avgMem: number; avgDisk: number; onlineDevices: number };
  hosts?: HostRow[];
};
type AlertEvent = {
  id: string; title: string; detail: string; createdAt: string;
  rule?: { name?: string; trigger?: string } | null;
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
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const [devRes, healthRes, anaRes, alertRes] = await Promise.all([
        fetch('/api/devices'),
        fetch('/api/fleet-health/summary'),
        fetch('/api/fleet-health/register-analytics?days=30'),
        fetch('/api/alerts/events')
      ]);
      if (!devRes.ok) throw new Error('fetch failed');
      const devJson = await devRes.json();
      if (Array.isArray(devJson.data)) setDevices(devJson.data);
      if (healthRes.ok) { const j = await healthRes.json(); if (j?.data) setHealth(j.data as FleetHealth); }
      if (anaRes.ok) { const j = await anaRes.json(); if (j?.data) setAnalytics(j.data as RegisterAnalytics); }
      if (alertRes.ok) { const j = await alertRes.json(); if (Array.isArray(j?.data)) setAlerts(j.data as AlertEvent[]); }
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

  // ★2026-07-30 CANLI SAĞLIK. 15 saniyelik yoklama "canlı hissi" veriyordu ama ANLIK
  // değildi: bir cihaz düştüğünde sağlık sayfası 15 saniyeye kadar yanlış rakam
  // gösteriyordu. Durum değişimi ve alarmlar ZATEN WS'te yayınlanıyor (API tarafında
  // ONLINE↔OFFLINE geçişi bu turda yayına eklendi), bu sayfa sadece abone değildi.
  // Yoklama güvenlik ağı olarak KALIYOR (WS kopması / kaçan olay).
  const liveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFleetEvents(['device.updated', 'device.created', 'device.deleted', 'alert.fired'], () => {
    if (liveRef.current) clearTimeout(liveRef.current);
    liveRef.current = setTimeout(() => void load(true), 500);
  });
  useEffect(() => () => { if (liveRef.current) clearTimeout(liveRef.current); }, []);

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

  // Alerts from the last 6 hours — the "something is wrong" banner. Freshest first.
  const recentAlerts = useMemo(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    return alerts.filter((a) => new Date(a.createdAt).getTime() >= cutoff).slice(0, 6);
  }, [alerts]);

  const hosts = health?.hosts ?? [];

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

      {/* Alert banner — anything fired in the last 6h. The "something is wrong" strip. */}
      {recentAlerts.length > 0 ? (
        <div className="health-alert-banner">
          {recentAlerts.map((a) => (
            <div className={`health-alert ${alertTone(a.rule?.trigger)}`} key={a.id}>
              <AlertTriangle size={14} className="health-alert-ico" />
              <span className="health-alert-title">{a.title}</span>
              <span className="health-alert-ago mono">{ago(a.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Host machines — the servers' OWN load/disk (not device averages). */}
      {hosts.length > 0 ? (
        <HoloPanel title="Sunucular" icon={<ServerCog size={16} />}>
          <div className="host-grid">
            {hosts.map((h) => {
              const sat = h.saturationPct ?? 0;
              const diskLow = h.diskFreeGb != null && h.diskFreeGb < 15;
              const cpuBad = sat >= 90;
              return (
                <div className={`host-card ${h.status !== 'ONLINE' ? 'host-off' : ''}`} key={h.id}>
                  <div className="host-head">
                    <span className="host-name">{h.name}</span>
                    <span className="status-chip">
                      <span className={statusClass(h.status)} />
                      {STATUS_LABEL[h.status] ?? h.status}
                    </span>
                  </div>
                  <div className="host-metrics">
                    <div className="host-metric">
                      <span className="host-metric-label"><Cpu size={12} /> Yük</span>
                      <span className={`host-metric-val mono ${cpuBad ? 'host-crit' : sat >= 70 ? 'host-warn' : ''}`}>
                        {h.load1 != null ? h.load1.toFixed(1) : '—'}
                        {h.cpuCores ? <span className="host-metric-sub"> / {h.cpuCores}</span> : null}
                        {h.saturationPct != null ? <span className="host-metric-sub"> ({h.saturationPct}%)</span> : null}
                      </span>
                    </div>
                    <div className="host-metric">
                      <span className="host-metric-label"><HardDrive size={12} /> Boş disk</span>
                      <span className={`host-metric-val mono ${diskLow ? 'host-crit' : ''}`}>
                        {h.diskFreeGb != null ? `${h.diskFreeGb} GB` : '—'}
                      </span>
                    </div>
                    <div className="host-metric">
                      <span className="host-metric-label"><MemoryStick size={12} /> Boş RAM</span>
                      <span className="host-metric-val mono">{h.ramFreeGb != null ? `${h.ramFreeGb} GB` : '—'}</span>
                    </div>
                  </div>
                  {h.monitorStale ? (
                    <div className="host-monitor-down">
                      <AlertTriangle size={12} /> Sağlık izleyici 20+ dk sessiz
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </HoloPanel>
      ) : null}

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
    <div className="analytics-table" style={{ minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
