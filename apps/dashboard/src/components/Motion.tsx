'use client';

import { motion, useMotionValue, useSpring, useTransform, type Variants } from 'framer-motion';
import { useRef, type ReactNode, type PointerEvent } from 'react';

// Shared motion primitives so every page animates consistently.

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } }
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }
};

// Page wrapper: fades + slides content in on mount.
export function PageMotion({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial="hidden" animate="show" variants={fadeUp} className={className}>
      {children}
    </motion.div>
  );
}

// Stagger container for grids/lists.
export function StaggerGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial="hidden" animate="show" variants={stagger} className={className}>
      {children}
    </motion.div>
  );
}

// A single staggered child that lifts on hover.
export function MotionItem({
  children,
  className,
  lift = true
}: {
  children: ReactNode;
  className?: string;
  lift?: boolean;
}) {
  return (
    <motion.div
      variants={scaleIn}
      className={className}
      {...(lift ? { whileHover: { y: -4, transition: { duration: 0.18 } } } : {})}
    >
      {children}
    </motion.div>
  );
}

// A premium 3D card that tilts subtly toward the pointer (real-world parallax,
// not gimmicky). Spring-damped so it settles softly; resets on leave. The tilt
// is capped low (±6°) to stay tasteful on a data dashboard, and a faint glare
// follows the cursor for a glass-under-light feel. Disabled for coarse pointers.
export function TiltCard({
  children,
  className,
  max = 6,
  glare = true
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 220, damping: 22 });
  const rotY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 220, damping: 22 });
  const glareX = useTransform(px, [0, 1], ['0%', '100%']);
  const glareY = useTransform(py, [0, 1], ['0%', '100%']);

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  }
  function onLeave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <motion.div
      ref={ref}
      variants={scaleIn}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={className}
      style={{ rotateX: rotX, rotateY: rotY, transformPerspective: 1000, transformStyle: 'preserve-3d' }}
      whileHover={{ y: -4, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
    >
      {children}
      {glare ? (
        <motion.span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            background: useTransform(
              [glareX, glareY],
              ([x, y]) => `radial-gradient(420px circle at ${x} ${y}, rgba(255,255,255,0.07), transparent 60%)`
            )
          }}
        />
      ) : null}
    </motion.div>
  );
}

// Animated number that counts up to its target value.
export { AnimatedNumber } from './AnimatedNumber';
