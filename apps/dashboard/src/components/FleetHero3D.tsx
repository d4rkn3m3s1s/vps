'use client';

import { useRef, type PointerEvent } from 'react';
import Link from 'next/link';
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useReducedMotion
} from 'framer-motion';
import { ArrowUpRight, Cpu, Globe2, Radio, Sparkles } from 'lucide-react';
import { CountUp } from './CountUp';

/**
 * FleetHero3D — the operator-homepage hero band.
 *
 * Brand metaphor "ORBIT": a fleet of cloud phones orbiting one command core.
 * Three concentric rings of device nodes rotate slowly; the whole stage tilts
 * in 3D toward the pointer and parallaxes as the page scrolls. Everything is
 * GPU-only (transform/opacity) and collapses to a static layout under
 * prefers-reduced-motion. The copy + counters are real fleet data, passed in.
 */

type HeroStat = { key: string; label: string; value: string | number; icon: 'phone' | 'globe' | 'live' | 'ai' };

const ICONS = {
  phone: Cpu,
  globe: Globe2,
  live: Radio,
  ai: Sparkles
} as const;

// Orbit ring geometry: [radius%, node-count, duration-s, direction]
const RINGS: Array<{ r: number; n: number; dur: number; dir: 1 | -1 }> = [
  { r: 30, n: 4, dur: 38, dir: 1 },
  { r: 44, n: 6, dur: 56, dir: -1 },
  { r: 58, n: 8, dur: 78, dir: 1 }
];

export function FleetHero3D({
  online,
  total,
  regions,
  stats
}: {
  online: number;
  total: number;
  regions: number;
  stats: HeroStat[];
}) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Scroll parallax: the orbit field drifts up + fades as you scroll past it.
  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ['start start', 'end start']
  });
  const orbitY = useTransform(scrollYProgress, [0, 1], ['0%', '-22%']);
  const orbitFade = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0, 1], ['0%', '14%']);

  // Pointer-driven 3D tilt of the whole stage.
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const max = 7;
  const rotX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 140, damping: 18 });
  const rotY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 140, damping: 18 });

  function move(e: PointerEvent<HTMLDivElement>) {
    if (reduce || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  }
  function leave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <section
      ref={wrapRef}
      className="fleet-hero"
      onPointerMove={move}
      onPointerLeave={leave}
      aria-label="Filo komuta merkezi"
    >
      {/* ── Orbit field (the brand metaphor) ─────────────────────────────── */}
      <motion.div
        className="fleet-hero-orbits"
        aria-hidden
        {...(reduce ? {} : { style: { y: orbitY, opacity: orbitFade, rotateX: rotX, rotateY: rotY } })}
      >
        {/* Command core — the single point everything orbits */}
        <div className="fh-core">
          <div className="fh-core-pulse" />
          <div className="fh-core-dot" />
          <div className="fh-core-count">
            <strong><CountUp value={online} /></strong>
            <span>/ {total} çevrimiçi</span>
          </div>
        </div>

        {RINGS.map((ring, ri) => (
          <div
            key={ri}
            className="fh-ring"
            style={{
              width: `${ring.r * 2}%`,
              height: `${ring.r * 2}%`,
              animationDuration: reduce ? '0s' : `${ring.dur}s`,
              animationDirection: ring.dir === 1 ? 'normal' : 'reverse'
            }}
          >
            <span className="fh-ring-path" />
            {Array.from({ length: ring.n }).map((_, ni) => {
              const angle = (360 / ring.n) * ni;
              // Light a few nodes as "online" using the online ratio.
              const lit = (ri * 13 + ni * 7) % 10 < Math.max(2, Math.round((online / Math.max(total, 1)) * 10));
              return (
                <span
                  key={ni}
                  className={`fh-node${lit ? ' is-online' : ''}`}
                  style={{ transform: `rotate(${angle}deg) translateX(calc(50% )) rotate(${-angle}deg)` }}
                >
                  <span
                    className="fh-node-inner"
                    style={{ animationDuration: reduce ? '0s' : `${ring.dur}s`, animationDirection: ring.dir === 1 ? 'reverse' : 'normal' }}
                  />
                </span>
              );
            })}
          </div>
        ))}
      </motion.div>

      {/* ── Copy + CTA + live counters ───────────────────────────────────── */}
      <motion.div className="fleet-hero-copy" {...(reduce ? {} : { style: { y: copyY } })}>
        <span className="fh-eyebrow">
          <span className="fh-eyebrow-dot" />
          Bulut Telefon Filo Komutası
        </span>

        <h1 className="fh-title">
          <span>Tek panelden</span>
          <span className="fh-title-grad">binlerce cihazı</span>
          <span>yönet, otomatikleştir, ölçekle.</span>
        </h1>

        <p className="fh-sub">
          Gerçek Android bulut telefonları saniyeler içinde aç, hesapları güvenle
          ısıt, RPA akışlarını tüm filoda eşzamanlı çalıştır — hepsi tek komuta
          merkezinden.
        </p>

        <div className="fh-cta-row">
          <Link href="/profiles" className="btn-primary fh-cta">
            Yeni telefon başlat
            <ArrowUpRight size={16} />
          </Link>
          <Link href="/welcome" className="btn-ghost fh-cta">
            Platformu keşfet
            <ArrowUpRight size={16} />
          </Link>
        </div>

        <div className="fh-stats">
          {stats.map((s) => {
            const Icon = ICONS[s.icon];
            return (
              <div key={s.key} className="fh-stat">
                <span className="fh-stat-icon">
                  <Icon size={15} strokeWidth={2.2} />
                </span>
                <span className="fh-stat-body">
                  <strong>{typeof s.value === 'number' ? <CountUp value={s.value} /> : s.value}</strong>
                  <small>{s.label}</small>
                </span>
              </div>
            );
          })}
          <div className="fh-stat">
            <span className="fh-stat-icon">
              <Globe2 size={15} strokeWidth={2.2} />
            </span>
            <span className="fh-stat-body">
              <strong><CountUp value={regions} /></strong>
              <small>Bölge / coğrafya</small>
            </span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
