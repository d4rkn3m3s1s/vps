'use client';

import { useEffect, useRef, useState, type ReactNode, type ElementType } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Reveal — fades + lifts its children into view the first time they scroll on
 * screen. Pure IntersectionObserver (no scroll listeners), GPU-only transform,
 * honors reduced-motion (renders visible immediately). Use `delay` to stagger a
 * row of siblings. Renders as `as` (default div) so it can wrap sections, cards,
 * or grid items without breaking layout.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
  as: Tag = 'div'
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: ElementType;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (reduce) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  return (
    <Tag
      ref={ref}
      className={`reveal${shown ? ' reveal-in' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
