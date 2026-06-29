'use client';

import { useEffect, useRef } from 'react';

// Visibility-aware polling. Runs `fn` every `ms` while enabled, but SKIPS ticks
// when the browser tab is hidden (background tab) — so a dozen open dashboard
// tabs don't each hammer the API every few seconds doing work no one sees. When
// the tab becomes visible again it fires once immediately to catch up, then
// resumes the cadence. Pass enabled=false to stop entirely.
//
// This is the single, shared polling primitive for the dashboard's live views
// (jobs, accounts, profiles, health, …) so the visibility behaviour is uniform.
export function usePolling(fn: () => void | Promise<void>, ms: number, enabled = true): void {
  // Keep the latest callback without re-arming the interval each render.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.hidden) return; // background tab → skip
      void fnRef.current();
    };

    const id = setInterval(tick, ms);

    // Catch up immediately when the tab regains focus (don't wait a full cycle).
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) void fnRef.current(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms, enabled]);
}
