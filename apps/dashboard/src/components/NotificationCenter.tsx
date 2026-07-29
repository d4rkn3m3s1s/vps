'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFleetEvents } from '../lib/live';
import { fetchJson } from '../lib/safeFetch';

// Bildirim merkezi (üst bardaki zil).
//
// ★2026-07-29 — KÖKTEN DEĞİŞTİ. Eskiden bu bileşen bildirimleri KENDİSİ üretiyordu:
// 5 saniyede bir /api/jobs'u çekip önceki durumla farkını alıyor ve sonucu yalnızca
// `useState` içinde tutuyordu. Üç sonucu vardı:
//   1. Sayfa yenilenince TÜM bildirimler ve "okundu" bilgisi kayboluyordu.
//   2. Her mount'ta ilk tur bilerek atlanıyordu (`bootstrapped` guard) — yani operatör
//      panelde DEĞİLKEN biten işler hiç görünmüyordu.
//   3. `res.json()` `res.ok`/content-type kontrolsüz çağrılıp boş bir catch'e düşüyordu;
//      oturum süresi dolunca bildirimler SESSİZCE sonsuza dek duruyordu.
// Artık kaynak sunucu: bildirimler Notification tablosunda üretiliyor, bu bileşen
// açılışta oradan hidrat ediyor ve WS ile canlı ekliyor. Okundu durumu sunucuda.

type Notification = {
  id: string;
  title: string;
  detail: string;
  kind: 'ok' | 'err' | 'info';
  at: number;
  read: boolean;
};

// Sunucudan gelen satır şekli (feed.service.ts).
type FeedRow = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  read: boolean;
  createdAt: string;
};

function toNotification(r: FeedRow): Notification {
  const kind: Notification['kind'] = r.kind === 'ok' || r.kind === 'err' ? r.kind : 'info';
  return {
    id: r.id,
    title: r.title,
    detail: r.detail ?? '',
    kind,
    at: new Date(r.createdAt).getTime(),
    read: r.read
  };
}

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
  // Oturum düştüyse "bildirim yok" demek yanıltıcı olur — ayrı bir durum gösteriyoruz.
  const [sessionLost, setSessionLost] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((n: Notification) => {
    setToast(n);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Sunucudan hidrat. Bu, "yenilemede kaybolma" ve "sen yokken bitenler görünmüyor"
  // sorunlarının ikisini birden çözer.
  const load = useCallback(async () => {
    const res = await fetchJson<{ data: FeedRow[] }>('/api/notifications/feed?limit=50');
    if (res.unauthorized) {
      setSessionLost(true);
      return;
    }
    if (!res.ok || !res.data) return; // geçici hata: mevcut listeyi koru
    setSessionLost(false);
    const rows = Array.isArray(res.data.data) ? res.data.data : [];
    setItems(rows.map(toNotification));
  }, []);

  useEffect(() => {
    void load();
    // Güvenlik ağı: WS kopuksa bile liste bayatlamasın. Sekme gizliyken atla.
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    }, 30000);
    // Sekmeye dönünce hemen tazele.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [load]);

  // Canlı: sunucu bildirim yazdığı anda ittirir (feed.service → deviceHub).
  useFleetEvents(['notification.created'], (e) => {
    const row = e.payload as FeedRow | undefined;
    if (!row?.id) return;
    const n = toNotification(row);
    setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 50)));
    showToast(n);
  });

  // Alarm olayı ayrıca gelir; sunucu bunu da feed'e yazdığı için burada YALNIZCA
  // anlık toast gösterip listeyi tazeliyoruz (çift kayıt olmasın).
  useFleetEvents(['alert.fired'], () => {
    void load();
  });

  const unread = items.filter((i) => !i.read).length;

  async function toggle() {
    const opening = !open;
    setOpen(opening);
    if (opening && unread > 0) {
      // İyimser güncelleme + sunucuya yaz (okundu durumu artık kalıcı).
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      await fetchJson('/api/notifications/feed/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
    }
  }

  async function clearAll() {
    setItems([]);
    await fetchJson('/api/notifications/feed', { method: 'DELETE' });
    void load();
  }

  return (
    <>
      <button type="button" className="notif-bell" onClick={() => void toggle()} aria-label="Bildirimler">
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
                  <button type="button" className="notif-clear" onClick={() => void clearAll()}>
                    Temizle
                  </button>
                ) : null}
              </div>
              <div className="notif-list">
                {sessionLost ? (
                  <div className="notif-empty">
                    Oturumun süresi dolmuş — bildirimler yüklenemiyor.
                    <br />
                    <button
                      type="button"
                      className="notif-clear"
                      onClick={() => window.location.reload()}
                      style={{ marginTop: '.4rem' }}
                    >
                      Sayfayı yenile
                    </button>
                  </div>
                ) : items.length === 0 ? (
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
