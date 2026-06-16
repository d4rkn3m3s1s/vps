'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';

// Counts up from 0 to `value` once, on mount. Formats large numbers (K/M).
export function AnimatedNumber({ value, format = true }: { value: number; format?: boolean }) {
  const [display, setDisplay] = useState(0);
  const node = useRef(value);

  useEffect(() => {
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v)
    });
    return () => controls.stop();
  }, [value]);

  node.current = display;
  const n = Math.round(display);
  let text: string;
  if (format && n >= 1_000_000) text = `${(n / 1_000_000).toFixed(1)}M`;
  else if (format && n >= 1_000) text = `${(n / 1_000).toFixed(1)}K`;
  else text = String(n);

  return <span>{text}</span>;
}
