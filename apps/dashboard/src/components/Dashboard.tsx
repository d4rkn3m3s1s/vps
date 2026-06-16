'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const STORAGE_KEY = 'fleet.dashboard.hidden';

type Ctx = {
  customizing: boolean;
  hidden: Set<string>;
  toggle: (id: string) => void;
};

const DashboardCtx = createContext<Ctx | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [customizing, setCustomizing] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Restore hidden widgets from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <DashboardCtx.Provider value={{ customizing, hidden, toggle }}>
      <div className="dash-controls">
        <button
          type="button"
          className={customizing ? 'btn-primary' : 'btn-ghost'}
          onClick={() => setCustomizing((v) => !v)}
        >
          {customizing ? '✓ Done' : '⚙ Customize'}
        </button>
        {customizing && hidden.size > 0 ? (
          <button type="button" className="btn-ghost" onClick={() => { setHidden(new Set()); localStorage.removeItem(STORAGE_KEY); }}>
            Reset
          </button>
        ) : null}
      </div>
      {loaded ? children : null}
    </DashboardCtx.Provider>
  );
}

// Wraps a dashboard section. Hidden sections collapse out (or show a restore
// chip while customizing).
export function Widget({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const ctx = useContext(DashboardCtx);
  if (!ctx) return <>{children}</>;
  const { customizing, hidden, toggle } = ctx;
  const isHidden = hidden.has(id);

  if (isHidden && !customizing) return null;

  return (
    <motion.div layout className={`widget${isHidden ? ' widget-hidden' : ''}`} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
      {customizing ? (
        <button type="button" className="widget-toggle" onClick={() => toggle(id)} title={isHidden ? 'Show' : 'Hide'}>
          {isHidden ? `+ Show ${title}` : '✕'}
        </button>
      ) : null}
      <AnimatePresence>
        {!isHidden ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
