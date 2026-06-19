'use client';

import { useEffect, useState } from 'react';

// Branded splash shown on the very first load of a session. It mounts above the
// whole app, plays a short logo-reveal + scan animation, then fades out once the
// window has loaded (or after a max timeout, so it can never get stuck). We only
// show it once per browser session (sessionStorage) to avoid re-flashing on every
// client navigation — Next keeps the layout mounted across route changes anyway.
export function Preloader() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Respect reduced-motion and skip if already shown this session.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem('fleet.splash') === '1';
    } catch {
      /* ignore */
    }
    if (reduce || seen) return;

    setShow(true);
    try {
      sessionStorage.setItem('fleet.splash', '1');
    } catch {
      /* ignore */
    }

    // Minimum on-screen time so the reveal animation reads, then fade out.
    const MIN_MS = 1400;
    const MAX_MS = 3200;
    const started = performance.now();

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      const elapsed = performance.now() - started;
      const wait = Math.max(0, MIN_MS - elapsed);
      window.setTimeout(() => {
        setLeaving(true);
        window.setTimeout(() => setShow(false), 650); // matches CSS fade duration
      }, wait);
    }

    if (document.readyState === 'complete') {
      window.setTimeout(finish, MIN_MS);
    } else {
      window.addEventListener('load', finish, { once: true });
    }
    const hardStop = window.setTimeout(finish, MAX_MS);

    return () => {
      window.removeEventListener('load', finish);
      window.clearTimeout(hardStop);
    };
  }, []);

  if (!show) return null;

  return (
    <div className={`preloader${leaving ? ' preloader-leaving' : ''}`} aria-hidden>
      <div className="preloader-aura" />
      <div className="preloader-core">
        <div className="preloader-rings">
          <span className="preloader-ring preloader-ring-1" />
          <span className="preloader-ring preloader-ring-2" />
          <span className="preloader-ring preloader-ring-3" />
          <span className="preloader-mark">V</span>
        </div>
        <div className="preloader-brand">
          <strong>VPS Fleet</strong>
          <span>Cloud Phones</span>
        </div>
        <div className="preloader-bar">
          <span className="preloader-bar-fill" />
        </div>
      </div>
    </div>
  );
}
