'use client';

// ── Command Deck ────────────────────────────────────────────────────────────
// A "fleet ops" overview: a live telemetry strip, 3D glass KPI tiles, a device
// status matrix, an animated sparkline rail, and a terminal-style ops log.
// Pure presentation — all data is passed in from the server component, so no
// API wiring changes. Motion is GPU-only (transform/opacity); 3D tilt follows
// the pointer with spring damping and is disabled for coarse pointers.

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useRef, type ReactNode, type PointerEvent } from 'react';
import Link from 'next/link';
import { CountUp } from './CountUp';
import {
  Smartphone, Network, Activity, ShieldCheck, Cpu, HardDrive, Boxes,
  Radio, ArrowUpRight, Zap, Database, Server
} from 'lucide-react';

/* ── shared types (mirror the server page's shapes) ── */
export type DeckKpi = {
  key: string;
  label: string;
  value: number;
  unit?: string;
  sub: string;
  tone: 'accent' | 'cyan' | 'info' | 'violet' | 'neutral' | 'success' | 'warning' | 'error';
  icon: 'phone' | 'proxy' | 'jobs' | 'plugins' | 'health';
  spark?: number[];
};
export type DeckDevice = { id: string; status: string; label: string; region?: string };
export type DeckMetric = { key: string; label: string; percent: number; detail: string; tone: 'accent' | 'cyan' | 'info' | 'success' | 'warning' | 'error' };
export type DeckJob = { id: string; type: string; status: string; createdAt: string };
export type DeckService = { label: string; status: string | undefined; icon: 'db' | 'queue' | 'docker' };

const ICONS = {
  phone: Smartphone, proxy: Network, jobs: Activity, plugins: Boxes, health: ShieldCheck
} as const;

/* ── 3D tilt wrapper — spring-damped, pointer-tracking, glare overlay ── */
function Tilt({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 240, damping: 24 });
  const rotY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 240, damping: 24 });
  const gx = useTransform(px, [0, 1], ['0%', '100%']);
  const gy = useTransform(py, [0, 1], ['0%', '100%']);
  const glare = useTransform([gx, gy], ([x, y]) => `radial-gradient(380px circle at ${x} ${y}, rgba(120,160,255,0.10), transparent 60%)`);

  function move(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  }
  function leave() { px.set(0.5); py.set(0.5); }

  return (
    <motion.div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      className={className}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1100, transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
      <motion.span aria-hidden className="deck-glare" style={{ background: glare }} />
    </motion.div>
  );
}

/* ── tiny inline sparkline (SVG, no deps) ── */
function Spark({ data, tone }: { data: number[]; tone: string }) {
  if (!data || data.length < 2) return null;
  const w = 120, h = 30;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const d = `M${pts.join(' L')}`;
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg className="deck-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" data-tone={tone}>
      <path className="deck-spark-area" d={area} />
      <path className="deck-spark-line" d={d} />
    </svg>
  );
}

/* ── live telemetry strip (top rail) ── */
function TelemetryBar({ online, total, errors, healthPct, jobsRunning, queueWaiting }: {
  online: number; total: number; errors: number; healthPct: number; jobsRunning: number; queueWaiting: number;
}) {
  const cells = [
    { icon: <Radio size={13} />, label: 'ÇEVRİMİÇİ', value: `${online}/${total}`, tone: 'success' as const, live: true },
    { icon: <Zap size={13} />, label: 'İŞLER', value: `${jobsRunning} aktif`, tone: 'accent' as const, live: jobsRunning > 0 },
    { icon: <Activity size={13} />, label: 'KUYRUK', value: `${queueWaiting} bekliyor`, tone: 'cyan' as const, live: false },
    { icon: <ShieldCheck size={13} />, label: 'FİLO SAĞLIĞI', value: `${healthPct}%`, tone: healthPct >= 80 ? 'success' as const : healthPct >= 50 ? 'warning' as const : 'error' as const, live: false },
    { icon: <Smartphone size={13} />, label: 'HATA', value: `${errors}`, tone: errors > 0 ? 'error' as const : 'success' as const, live: errors > 0 }
  ];
  return (
    <motion.div className="deck-telemetry" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
      <div className="deck-telemetry-scan" aria-hidden />
      {cells.map((c) => (
        <div className="deck-tcell" key={c.label} data-tone={c.tone}>
          <span className="deck-tcell-ico">{c.icon}</span>
          <span className="deck-tcell-label">{c.label}</span>
          <span className="deck-tcell-value">
            {c.live ? <span className="deck-pulse" /> : null}
            {c.value}
          </span>
        </div>
      ))}
    </motion.div>
  );
}

/* ── 3D KPI tile ── */
function KpiTile({ kpi }: { kpi: DeckKpi }) {
  const Ico = ICONS[kpi.icon];
  return (
    <Tilt className={`deck-kpi deck-tone-${kpi.tone}`}>
      <div className="deck-kpi-head">
        <span className="deck-kpi-ico"><Ico size={17} /></span>
        <span className="deck-kpi-label">{kpi.label}</span>
      </div>
      <div className="deck-kpi-value">
        <CountUp value={kpi.value} />{kpi.unit ? <span className="deck-kpi-unit">{kpi.unit}</span> : null}
      </div>
      {kpi.spark ? <Spark data={kpi.spark} tone={kpi.tone} /> : null}
      <div className="deck-kpi-sub">{kpi.sub}</div>
    </Tilt>
  );
}

/* ── device status matrix ── */
function DeviceMatrix({ devices, online, total }: { devices: DeckDevice[]; online: number; total: number }) {
  const cells = devices.slice(0, 96);
  return (
    <Tilt className="deck-card deck-matrix" max={4}>
      <div className="deck-card-head">
        <h3><Smartphone size={15} /> Cihaz Matrisi</h3>
        <span className="deck-card-meta">{online}/{total} çevrimiçi</span>
      </div>
      {cells.length === 0 ? (
        <div className="deck-empty">Henüz cihaz yok — <Link href="/profiles">bir telefon ekleyin</Link>.</div>
      ) : (
        <div className="deck-grid-cells">
          {cells.map((d) => (
            <Link
              key={d.id}
              href={`/profiles/${d.id}`}
              className={`deck-cell deck-cell-${(d.status || 'offline').toLowerCase()}`}
              title={`${d.label} · ${d.status}`}
            />
          ))}
        </div>
      )}
      <div className="deck-legend">
        <span><i className="deck-cell deck-cell-online" /> Çevrimiçi</span>
        <span><i className="deck-cell deck-cell-offline" /> Çevrimdışı</span>
        <span><i className="deck-cell deck-cell-error" /> Hata</span>
      </div>
    </Tilt>
  );
}

/* ── infra meters (radial-ish bars with glow) ── */
function InfraMeters({ metrics }: { metrics: DeckMetric[] }) {
  const ico = { cpu: <Cpu size={14} />, memory: <HardDrive size={14} />, network: <Network size={14} />, storage: <Database size={14} /> } as Record<string, ReactNode>;
  return (
    <Tilt className="deck-card deck-infra" max={4}>
      <div className="deck-card-head"><h3><Activity size={15} /> Canlı Altyapı</h3></div>
      <div className="deck-meters">
        {metrics.map((m) => (
          <div className="deck-meter" key={m.key} data-tone={m.tone}>
            <div className="deck-meter-top">
              <span className="deck-meter-label">{ico[m.key] ?? <Cpu size={14} />} {m.label}</span>
              <span className="deck-meter-pct">{m.percent}%</span>
            </div>
            <div className="deck-meter-track">
              <motion.div
                className="deck-meter-fill"
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.min(100, m.percent)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <div className="deck-meter-detail">{m.detail}</div>
          </div>
        ))}
      </div>
    </Tilt>
  );
}

/* ── terminal-style ops log ── */
function OpsConsole({ jobs }: { jobs: DeckJob[] }) {
  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return '--:--:--'; }
  };
  return (
    <Tilt className="deck-card deck-console" max={4}>
      <div className="deck-card-head">
        <h3><Server size={15} /> Operasyon Konsolu</h3>
        <Link href="/jobs" className="deck-card-link">tümü <ArrowUpRight size={12} /></Link>
      </div>
      <div className="deck-console-body">
        {jobs.length === 0 ? (
          <div className="deck-console-line deck-dim">$ bekleniyor… aktif iş yok</div>
        ) : (
          jobs.map((j) => (
            <div className="deck-console-line" key={j.id} data-status={j.status}>
              <span className="deck-console-ts">{fmt(j.createdAt)}</span>
              <span className="deck-console-dot" />
              <span className="deck-console-type">{j.type}</span>
              <span className="deck-console-status">{j.status}</span>
            </div>
          ))
        )}
      </div>
    </Tilt>
  );
}

/* ── service health pills ── */
function ServiceRail({ services, offline }: { services: DeckService[]; offline?: boolean }) {
  const ico = { db: <Database size={14} />, queue: <Activity size={14} />, docker: <Boxes size={14} /> };
  const ok = (s?: string) => (s || '').toLowerCase().includes('ok') || (s || '').toLowerCase().includes('up') || (s || '').toLowerCase().includes('connect') || (s || '').toLowerCase().includes('running') || (s || '').toLowerCase().includes('healthy');
  // Distinguish "API unreachable" (offline) from a real degraded service. When the
  // API can't be reached, every row reads "Bağlantı yok" instead of a vague
  // "bilinmiyor", and the card flags the connectivity problem at the top.
  const label = (s?: string) => (offline ? 'Bağlantı yok' : s ?? 'bilinmiyor');
  const rowClass = (s?: string) => (offline ? 'is-bad' : ok(s) ? 'is-ok' : 'is-bad');
  return (
    <Tilt className={`deck-card deck-services${offline ? ' deck-services-offline' : ''}`} max={4}>
      <div className="deck-card-head">
        <h3><ShieldCheck size={15} /> Servisler</h3>
        {offline ? <span className="deck-services-warn">API'ye bağlanılamıyor</span> : null}
      </div>
      <div className="deck-service-rail">
        {services.map((s) => (
          <div className={`deck-service ${rowClass(s.status)}`} key={s.label}>
            <span className="deck-service-ico">{ico[s.icon]}</span>
            <span className="deck-service-label">{s.label}</span>
            <span className="deck-service-state">{label(s.status)}</span>
          </div>
        ))}
      </div>
    </Tilt>
  );
}

/* ── the deck composition ── */
export function CommandDeck(props: {
  telemetry: { online: number; total: number; errors: number; healthPct: number; jobsRunning: number; queueWaiting: number };
  kpis: DeckKpi[];
  devices: DeckDevice[];
  metrics: DeckMetric[];
  jobs: DeckJob[];
  services: DeckService[];
  /** True when the API/system overview couldn't be reached (vs. genuinely degraded). */
  servicesOffline?: boolean;
}) {
  return (
    <div className="command-deck">
      <TelemetryBar {...props.telemetry} />

      <div className="deck-kpis">
        {props.kpis.map((k) => <KpiTile key={k.key} kpi={k} />)}
      </div>

      <div className="deck-bento">
        <div className="deck-bento-main">
          <DeviceMatrix devices={props.devices} online={props.telemetry.online} total={props.telemetry.total} />
        </div>
        <div className="deck-bento-side">
          <InfraMeters metrics={props.metrics} />
        </div>
        <div className="deck-bento-wide">
          <OpsConsole jobs={props.jobs} />
        </div>
        <div className="deck-bento-narrow">
          <ServiceRail services={props.services} {...(props.servicesOffline ? { offline: true } : {})} />
        </div>
      </div>
    </div>
  );
}
