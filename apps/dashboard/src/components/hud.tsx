'use client';

// ── HUD + Holographic design kit ────────────────────────────────────────────
// Shared building blocks every page composes with, so the whole app reads as
// one "sci-fi control deck": holographic glass panels with corner brackets and
// a scan sweep, 3D pointer-tilt cards, a holo page header, sectioned grids, and
// staggered reveals. Pure presentation — no data/API wiring lives here.
// Motion is GPU-only (transform/opacity) and respects reduced-motion via CSS.

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useRef, type ReactNode, type PointerEvent } from 'react';

/* ── 3D pointer-tilt wrapper (spring-damped, glare) ── */
export function Holo3D({
  children, className, max = 6, glare = true
}: { children: ReactNode; className?: string; max?: number; glare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 230, damping: 22 });
  const rotY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 230, damping: 22 });
  const gx = useTransform(px, [0, 1], ['0%', '100%']);
  const gy = useTransform(py, [0, 1], ['0%', '100%']);
  const glow = useTransform([gx, gy], ([x, y]) => `radial-gradient(420px circle at ${x} ${y}, rgba(239,35,60,0.16), transparent 60%)`);

  function move(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return;
    const el = ref.current; if (!el) return;
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
    >
      {children}
      {glare ? <motion.span aria-hidden className="holo-glare" style={{ background: glow }} /> : null}
    </motion.div>
  );
}

/* ── Holographic panel: glass body + corner brackets + scan sweep ── */
export function HoloPanel({
  children, className = '', title, icon, actions, tilt = false, scan = true
}: {
  children: ReactNode; className?: string; title?: ReactNode; icon?: ReactNode;
  actions?: ReactNode; tilt?: boolean; scan?: boolean;
}) {
  const body = (
    <div className={`holo-panel ${className}`}>
      <span className="holo-corner holo-corner-tl" aria-hidden />
      <span className="holo-corner holo-corner-tr" aria-hidden />
      <span className="holo-corner holo-corner-bl" aria-hidden />
      <span className="holo-corner holo-corner-br" aria-hidden />
      {scan ? <span className="holo-scan" aria-hidden /> : null}
      {title ? (
        <div className="holo-panel-head">
          <h2 className="holo-panel-title">{icon ? <span className="holo-panel-ico">{icon}</span> : null}{title}</h2>
          {actions ? <div className="holo-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="holo-panel-body">{children}</div>
    </div>
  );
  if (!tilt) return body;
  return (
    <Holo3D className="holo-tilt-wrap" max={4}>{body}</Holo3D>
  );
}

/* ── Holo page header: eyebrow + big title + actions, with reveal ── */
export function HoloHeader({
  eyebrow, title, subtitle, actions
}: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <motion.header
      className="holo-header"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="holo-header-text">
        {eyebrow ? <div className="holo-eyebrow"><span className="holo-eyebrow-dot" />{eyebrow}</div> : null}
        <h1 className="holo-title">{title}</h1>
        {subtitle ? <p className="holo-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="holo-header-actions">{actions}</div> : null}
    </motion.header>
  );
}

/* ── Reveal: fade+rise children in sequence when they mount/enter view ── */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/* ── HoloStat: a compact holographic metric tile with a corner glow ── */
export function HoloStat({
  label, value, sub, tone = 'accent', icon
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'accent' | 'cyan' | 'info' | 'violet' | 'neutral' | 'success' | 'warning' | 'error'; icon?: ReactNode }) {
  return (
    <Holo3D className={`holo-stat holo-tone-${tone}`} max={7}>
      <div className="holo-stat-top">
        {icon ? <span className="holo-stat-ico">{icon}</span> : null}
        <span className="holo-stat-label">{label}</span>
      </div>
      <div className="holo-stat-value">{value}</div>
      {sub ? <div className="holo-stat-sub">{sub}</div> : null}
    </Holo3D>
  );
}

/* ── HoloTabs: holographic segmented control ── */
export function HoloTabs<T extends string>({
  tabs, active, onChange
}: { tabs: { key: T; label: string; icon?: ReactNode }[]; active: T; onChange: (k: T) => void }) {
  return (
    <div className="holo-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`holo-tab ${active === t.key ? 'is-active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {active === t.key ? <motion.span layoutId="holo-tab-pill" className="holo-tab-pill" /> : null}
          {t.icon ? <span className="holo-tab-ico">{t.icon}</span> : null}
          <span className="holo-tab-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
