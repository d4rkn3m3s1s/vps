'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * CountUp — animates a number from 0 to `value` once, when it first scrolls into
 * view. Eased (fast-out) so big fleet counters "spin up" on page entry. Honors
 * reduced-motion (renders the final value immediately). Pure rAF, no deps beyond
 * framer-motion's reduced-motion hook (already in the bundle).
 */
export function CountUp({
  value,
  duration = 1200,
  className,
  suffix = ''
}: {
  value: number;
  duration?: number;
  className?: string;
  suffix?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const run = () => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        // easeOutExpo — snappy start, gentle settle.
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        setDisplay(Math.round(value * eased));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          run();
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration, reduce]);

  return (
    <span ref={ref} className={className}>
      {display.toLocaleString('tr-TR')}
      {suffix}
    </span>
  );
}
