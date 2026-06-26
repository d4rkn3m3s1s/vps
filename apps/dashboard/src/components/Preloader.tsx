'use client';

import { useEffect, useState } from 'react';

// Branded splash on the first load of a session. Mounts above the whole app,
// plays a logo-reveal + an orbiting-rings animation, and steps through a short
// "connecting the fleet" status sequence so the wait reads as meaningful work
// rather than a blank spinner. Fades out once the window has loaded (or after a
// max timeout, so it can never get stuck). Shown once per browser session.
const STEPS = [
  'Komuta merkezi başlatılıyor',
  'Filo düğümleri taranıyor',
  'Cihaz akışları senkronize ediliyor',
  'Konsol hazır'
];

export function Preloader() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
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

    // Advance the status line on a cadence so each step reads.
    const stepTimer = window.setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 480);

    const MIN_MS = 1800;
    const MAX_MS = 3400;
    const started = performance.now();

    let done = false;
    function finish() {
      if (done) return;
      done = true;
      const elapsed = performance.now() - started;
      const wait = Math.max(0, MIN_MS - elapsed);
      window.setTimeout(() => {
        setStep(STEPS.length - 1);
        setLeaving(true);
        window.setTimeout(() => setShow(false), 700);
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
      window.clearInterval(stepTimer);
    };
  }, []);

  if (!show) return null;

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className={`preloader${leaving ? ' preloader-leaving' : ''}`} aria-hidden>
      <div className="preloader-aura" />
      <div className="preloader-grid" />
      <div className="preloader-core">
        <div className="preloader-rings">
          <span className="preloader-ring preloader-ring-1" />
          <span className="preloader-ring preloader-ring-2" />
          <span className="preloader-ring preloader-ring-3" />
          {/* orbiting device dots */}
          <span className="preloader-orbit preloader-orbit-1"><i /></span>
          <span className="preloader-orbit preloader-orbit-2"><i /></span>
          <span className="preloader-orbit preloader-orbit-3"><i /></span>
          <span className="preloader-mark">V</span>
        </div>
        <div className="preloader-brand">
          <strong>VPS&nbsp;FLEET</strong>
          <span>Bulut Telefon Komuta Merkezi</span>
        </div>
        <div className="preloader-bar">
          <span className="preloader-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="preloader-status">
          <span className="preloader-status-dot" />
          {STEPS[step]}
          <span className="preloader-status-pct">{pct}%</span>
        </div>
      </div>
    </div>
  );
}
