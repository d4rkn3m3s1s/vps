'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFleetEvents } from '../lib/live';

type Notification = {
  id: string;
  title: string;
  detail: string;
  kind: 'ok' | 'err' | 'info';
  at: number;
  read: boolean;
};

type Job = { id: string; type: string; status: string; finishedAt?: string | null };

const KINDS: Record<string, 'ok' | 'err' | 'info'> = {
  COMPLETED: 'ok',
  FAILED: 'err'
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)}dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)}sa önce`;
  return `${Math.floor(s / 86400)}g önce`;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [toast, setToast] = useState<Notification | null>(null);
  // Track which job→status pairs we've already notified so we don't double-fire.
  const seen = useRef<Map<string, string>>(new Map());
  const bootstrapped = useRef(false);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch('/api/jobs', { cache: 'no-store' });
        const json = await res.json();
        const jobs: Job[] = Array.isArray(json.data) ? json.data : [];

        // First pass: record current states silently (don't notify history).
        if (!bootstrapped.current) {
          for (const j of jobs) seen.current.set(j.id, j.status);
          bootstrapped.current = true;
          return;
        }

        const fresh: Notification[] = [];
        for (const j of jobs) {
          const prev = seen.current.get(j.id);
          if (prev !== j.status && (j.status === 'COMPLETED' || j.status === 'FAILED')) {
            fresh.push({
              id: `${j.id}-${j.status}`,
              title: j.status === 'COMPLETED' ? 'İş tamamlandı' : 'İş başarısız oldu',
              detail: j.type,
              kind: KINDS[j.status] ?? 'info',
              at: Date.now(),
              read: false
            });
          }
          seen.current.set(j.id, j.status);
        }

        if (fresh.length > 0 && alive) {
          setItems((prev) => [...fresh, ...prev].slice(0, 50));
          setToast(fresh[0] ?? null);
          setTimeout(() => alive && setToast(null), 4000);
        }
      } catch {
        /* ignore transient errors */
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Real-time: push notifications the instant a job finishes or an alert fires,
  // instead of waiting for the 5s poll. Polling stays as a fallback.
  useFleetEvents(['job.updated', 'alert.fired'], (e) => {
    if (e.type === 'alert.fired') {
      const p = (e.payload ?? {}) as { title?: string; detail?: string };
      const n: Notification = {
        id: `alert-${e.timestamp ?? Date.now()}`,
        title: p.title ?? 'Uyarı',
        detail: p.detail ?? '',
        kind: 'err',
        at: Date.now(),
        read: false
      };
      setItems((prev) => [n, ...prev].slice(0, 50));
      setToast(n);
      setTimeout(() => setToast(null), 4000);
      return;
    }
    const job = (e.payload ?? {}) as { id?: string; type?: string; status?: string };
    if (!job.id || !job.status) return;
    if (seen.current.get(job.id) === job.status) return;
    seen.current.set(job.id, job.status);
    if (job.status !== 'COMPLETED' && job.status !== 'FAILED') return;
    const n: Notification = {
      id: `${job.id}-${job.status}`,
      title: job.status === 'COMPLETED' ? 'İş tamamlandı' : 'İş başarısız oldu',
      detail: job.type ?? '',
      kind: KINDS[job.status] ?? 'info',
      at: Date.now(),
      read: false
    };
    setItems((prev) => [n, ...prev].slice(0, 50));
    setToast(n);
    setTimeout(() => setToast(null), 4000);
  });

  const unread = items.filter((i) => !i.read).length;

  function toggle() {
    setOpen((v) => !v);
    if (!open) setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  }

  return (
    <>
      <button type="button" className="notif-bell" onClick={toggle} aria-label="Bildirimler">
        <span className="notif-bell-icon">◔</span>
        {unread > 0 ? <span className="notif-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div className="notif-backdrop" onClick={() => setOpen(false)} />
            <motion.div
              className="notif-panel"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <div className="notif-head">
                <strong>Bildirimler</strong>
                {items.length > 0 ? (
                  <button type="button" className="notif-clear" onClick={() => setItems([])}>
                    Temizle
                  </button>
                ) : null}
              </div>
              <div className="notif-list">
                {items.length === 0 ? (
                  <div className="notif-empty">Henüz bildirim yok</div>
                ) : (
                  items.map((n) => (
                    <div className="notif-item" key={n.id}>
                      <span className={`notif-dot notif-${n.kind}`} />
                      <div>
                        <div className="notif-title">{n.title}</div>
                        <div className="helper mono">{n.detail}</div>
                      </div>
                      <span className="notif-time">{timeAgo(n.at)}</span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {toast ? (
          <motion.div
            className={`notif-toast notif-toast-${toast.kind}`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <span className={`notif-dot notif-${toast.kind}`} />
            <div>
              <div className="notif-title">{toast.title}</div>
              <div className="helper mono">{toast.detail}</div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
