'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { HoloPanel } from '../../../components/hud';
import { usePolling } from '../../../lib/usePolling';

type Point = { t: string; cpu: number; mem: number; disk: number };
type Range = 1 | 6 | 24;

const RANGES: { label: string; hours: Range }[] = [
  { label: '1s', hours: 1 },
  { label: '6s', hours: 6 },
  { label: '24s', hours: 24 }
];

// Self-contained SVG sparkline (no chart lib — keeps the bundle lean). Plots a
// 0–100 % series across the panel width with a soft area fill.
function Spark({ values, color }: { values: number[]; color: string }) {
  const W = 100;
  const H = 28;
  if (values.length === 0) return <svg viewBox={`0 0 ${W} ${H}`} className="metric-spark" preserveAspectRatio="none" />;
  const n = values.length;
  const step = n > 1 ? W / (n - 1) : W;
  const pts = values.map((v, i) => {
    const x = n > 1 ? i * step : W / 2;
    const y = H - (Math.min(100, Math.max(0, v)) / 100) * H;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="metric-spark" preserveAspectRatio="none" aria-hidden>
      <path d={area} fill={color} fillOpacity={0.14} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricRow({
  icon, label, color, values, current
}: { icon: React.ReactNode; label: string; color: string; values: number[]; current: number | null }) {
  return (
    <div className="metric-row">
      <div className="metric-row-head">
        <span className="metric-row-label">{icon} {label}</span>
        <span className="metric-row-val mono" style={{ color }}>{current === null ? '—' : `${current.toFixed(0)}%`}</span>
      </div>
      <Spark values={values} color={color} />
    </div>
  );
}

export function DeviceMetricsPanel({ deviceId }: { deviceId: string }) {
  const [hours, setHours] = useState<Range>(6);
  const [points, setPoints] = useState<Point[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/devices/${deviceId}/metrics?hours=${hours}`, { cache: 'no-store' });
      const json = await res.json();
      if (Array.isArray(json.data)) setPoints(json.data as Point[]);
    } catch { /* keep last good series */ }
    finally { setLoaded(true); }
  }

  // Reload on range change.
  useEffect(() => { setLoaded(false); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [deviceId, hours]);
  // Live refresh every 30s (visibility-aware) so the chart trails the fleet.
  usePolling(() => void load(), 30000);

  const cpu = useMemo(() => points.map((p) => p.cpu), [points]);
  const mem = useMemo(() => points.map((p) => p.mem), [points]);
  const disk = useMemo(() => points.map((p) => p.disk), [points]);
  const last = points[points.length - 1] ?? null;

  return (
    <HoloPanel
      title="Cihaz Sağlığı"
      icon={<Activity size={16} />}
      scan={false}
      actions={
        <div className="seg-mini" role="group" aria-label="Zaman aralığı">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              className={r.hours === hours ? 'seg-mini-btn active' : 'seg-mini-btn'}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {loaded && points.length === 0 ? (
        <p className="helper">Henüz ölçüm yok. Cihaz çevrimiçi olduğunda CPU/bellek/disk geçmişi burada birikir (ajan ~30 sn’de bir bildirir).</p>
      ) : (
        <div className="metric-stack">
          <MetricRow icon={<Cpu size={13} />} label="CPU" color="#38bdf8" values={cpu} current={last ? last.cpu : null} />
          <MetricRow icon={<MemoryStick size={13} />} label="Bellek" color="#a78bfa" values={mem} current={last ? last.mem : null} />
          <MetricRow icon={<HardDrive size={13} />} label="Disk" color="#f59e0b" values={disk} current={last ? last.disk : null} />
          {points.length > 0 ? (
            <p className="helper mono" style={{ fontSize: '0.68rem', opacity: 0.6, marginTop: '0.2rem' }}>
              {points.length} ölçüm · son {hours} saat
            </p>
          ) : null}
        </div>
      )}
    </HoloPanel>
  );
}
