'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * MagicBento — interactive bento card with a mouse-following spotlight, reactive
 * border glow, floating particle stars, 3D tilt and subtle magnetism. Ported from
 * the GSAP reference to a zero-extra-dep implementation (vanilla rAF + CSS vars),
 * recolored to the RED NOIR brand (crimson glow). Wrap any content; each card
 * lights up independently on hover.
 */

const GLOW = '239, 35, 60'; // crimson RGB

type MagicCardProps = {
  children: ReactNode;
  className?: string;
  particleCount?: number;
  tilt?: boolean;
  magnetism?: boolean;
};

export function MagicCard({
  children,
  className = '',
  particleCount = 10,
  tilt = true,
  magnetism = true
}: MagicCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const particles = useRef<HTMLSpanElement[]>([]);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia?.('(max-width: 768px)').matches) return; // skip heavy effects on mobile

    const spawnParticles = () => {
      const { width, height } = el.getBoundingClientRect();
      for (let i = 0; i < particleCount; i++) {
        window.setTimeout(() => {
          if (!el.matches(':hover')) return;
          const p = document.createElement('span');
          p.className = 'mb-particle';
          p.style.left = `${Math.random() * width}px`;
          p.style.top = `${Math.random() * height}px`;
          p.style.setProperty('--dx', `${(Math.random() - 0.5) * 70}px`);
          p.style.setProperty('--dy', `${(Math.random() - 0.5) * 70}px`);
          el.appendChild(p);
          particles.current.push(p);
        }, i * 90);
      }
    };

    const clearParticles = () => {
      particles.current.forEach((p) => {
        p.style.opacity = '0';
        window.setTimeout(() => p.remove(), 300);
      });
      particles.current = [];
    };

    const onEnter = () => spawnParticles();
    const onLeave = () => {
      clearParticles();
      el.style.transform = '';
    };
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      el.style.setProperty('--mx', `${x}px`);
      el.style.setProperty('--my', `${y}px`);
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const rotX = tilt ? ((y - cy) / cy) * -6 : 0;
        const rotY = tilt ? ((x - cx) / cx) * 6 : 0;
        const mX = magnetism ? (x - cx) * 0.03 : 0;
        const mY = magnetism ? (y - cy) * 0.03 : 0;
        el.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) translate(${mX}px, ${mY}px)`;
      });
    };
    const onClick = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'mb-ripple';
      ripple.style.left = `${e.clientX - rect.left}px`;
      ripple.style.top = `${e.clientY - rect.top}px`;
      el.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 700);
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('click', onClick);
      clearParticles();
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [particleCount, tilt, magnetism]);

  return (
    <div ref={ref} className={`mb-card ${className}`} style={{ ['--glow' as string]: GLOW }}>
      <span className="mb-spotlight" aria-hidden />
      <span className="mb-border-glow" aria-hidden />
      {children}
    </div>
  );
}
