'use client';

import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

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

// Animated number that counts up to its target value.
export { AnimatedNumber } from './AnimatedNumber';
