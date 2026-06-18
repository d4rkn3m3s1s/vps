'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, MemoryStick, HardDrive, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

type Device = {
  id: string;
  name: string;
  status: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  lastSeen?: string | null;
};

const STATUS_TONE: Record<string, string> = {
  ONLINE: 'tone-ok',
  OFFLINE: 'tone-muted',
  ERROR: 'tone-bad',
  STARTING: 'tone-warn',
  STOPPING: 'tone-warn',
  REBOOTING: 'tone-warn',
  UPDATING: 'tone-warn'
};

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
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function HealthView() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/devices');
      const json = await res.json();
      if (Array.isArray(json.data)) setDevices(json.data);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    // Auto-refresh every 15s for a live feel.
    const t = setInterval(() => void load(true), 15000);
    return () => clearInterval(t);
  }, []);

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
      <PageHeader
        title="Fleet health"
        subtitle="Live resource usage and status across every cloud phone."
        actions={
          <button type="button" className="btn-ghost" onClick={() => load(true)} disabled={refreshing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
        }
      />

      {/* Top summary */}
      <div className="stats">
        <div className="metric">
          <p className="metric-label">Online</p>
          <p className="metric-value">{stats.online}<span className="metric-sub"> / {stats.total}</span></p>
        </div>
        <div className="metric">
          <p className="metric-label">Avg CPU</p>
          <p className="metric-value">{stats.cpu}%</p>
        </div>
        <div className="metric">
          <p className="metric-label">Avg memory</p>
          <p className="metric-value">{stats.mem}%</p>
        </div>
        <div className="metric">
          <p className="metric-label">Errors</p>
          <p className="metric-value">{stats.error}</p>
        </div>
      </div>

      {/* Fleet-wide averages */}
      <div className="panel">
        <h2><Activity size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Fleet averages</h2>
        <div className="health-avg-grid">
          <GaugeRow icon={<Cpu size={14} />} label="CPU" value={stats.cpu} />
          <GaugeRow icon={<MemoryStick size={14} />} label="Memory" value={stats.mem} />
          <GaugeRow icon={<HardDrive size={14} />} label="Disk" value={stats.disk} />
        </div>
      </div>

      {/* Per-device */}
      <div className="panel">
        <h2>Devices</h2>
        {loading ? (
          <p className="helper">Loading fleet health…</p>
        ) : sorted.length === 0 ? (
          <p className="helper">No devices yet.</p>
        ) : (
          <div className="health-table">
            <div className="health-row health-head">
              <span>Device</span>
              <span>Status</span>
              <span>CPU</span>
              <span>Memory</span>
              <span>Disk</span>
              <span>Last seen</span>
            </div>
            {sorted.map((d) => {
              const c = pct(d.cpuUsage);
              const m = pct(d.memoryUsage);
              const k = pct(d.diskUsage);
              return (
                <div className="health-row" key={d.id}>
                  <span className="health-name">{d.name}</span>
                  <span><span className={`status-dot ${STATUS_TONE[d.status] ?? 'tone-muted'}`} />{d.status.toLowerCase()}</span>
                  <UsageCell value={c} />
                  <UsageCell value={m} />
                  <UsageCell value={k} />
                  <span className="helper">{ago(d.lastSeen)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageMotion>
  );
}

function GaugeRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
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

function UsageCell({ value }: { value: number }) {
  return (
    <span className="health-usage">
      <span className="health-bar health-bar-sm">
        <span className={`health-bar-fill ${barTone(value)}`} style={{ width: `${value}%` }} />
      </span>
      <span className="health-usage-num mono">{value}%</span>
    </span>
  );
}
