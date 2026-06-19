'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

type Command = { label: string; href: string; icon: string; group: string; keywords?: string };

const COMMANDS: Command[] = [
  { label: 'Genel Bakış', href: '/', icon: '◴', group: 'Git' },
  { label: 'Profiller', href: '/profiles', icon: '▦', group: 'Git', keywords: 'cloud phones devices' },
  { label: 'Proxyler', href: '/proxies', icon: '⇄', group: 'Git' },
  { label: 'Kitaplık', href: '/library', icon: '◳', group: 'Git', keywords: 'assets files' },
  { label: 'Uygulamalar', href: '/applications', icon: '▤', group: 'Git', keywords: 'apps apk install' },
  { label: 'Fleet AI', href: '/ai', icon: '✦', group: 'Git', keywords: 'assistant chat claude' },
  { label: 'Analitik', href: '/analytics', icon: '∿', group: 'Git', keywords: 'metrics performance' },
  { label: 'Otomasyon', href: '/automation', icon: '⚡', group: 'Git', keywords: 'templates tasks' },
  { label: 'RPA Stüdyo', href: '/rpa', icon: '⚙', group: 'Git', keywords: 'flows steps builder' },
  { label: 'Zamanlayıcı', href: '/scheduler', icon: '⏱', group: 'Git', keywords: 'cron recurring' },
  { label: 'Senkronizatör', href: '/synchronizer', icon: '⧉', group: 'Git', keywords: 'mirror sync' },
  { label: 'FleetHub', href: '/geehub', icon: '◈', group: 'Git', keywords: 'marketplace' },
  { label: 'Webhook\'lar', href: '/webhooks', icon: '⇲', group: 'Git', keywords: 'callbacks notify' },
  { label: 'İşler', href: '/jobs', icon: '☰', group: 'Git', keywords: 'tasks queue' },
  { label: 'Üyeler', href: '/members', icon: '☻', group: 'Git', keywords: 'team users' },
  { label: 'Faturalandırma', href: '/billing', icon: '▭', group: 'Git', keywords: 'plan upgrade' },
  { label: 'Denetim günlüğü', href: '/audit', icon: '☰', group: 'Git' },
  { label: 'Günlükler', href: '/logs', icon: '☰', group: 'Git' },
  { label: 'Ayarlar', href: '/settings', icon: '⚙', group: 'Git' },
  // Quick actions
  { label: 'Yeni bulut telefon', href: '/profiles', icon: '＋', group: 'İşlemler', keywords: 'create profile' },
  { label: 'Proxy ekle', href: '/proxies', icon: '＋', group: 'İşlemler' },
  { label: 'Uygulama yükle', href: '/applications', icon: '＋', group: 'İşlemler' },
  { label: 'Yeni RPA akışı', href: '/rpa', icon: '＋', group: 'İşlemler', keywords: 'automation' },
  { label: 'Görev zamanla', href: '/scheduler', icon: '＋', group: 'İşlemler' }
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  // Cmd/Ctrl+K toggles the palette anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setActive(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.keywords ?? '').includes(q) || c.group.toLowerCase().includes(q)
    );
  }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      go(results[active]!.href);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="cmdk-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="cmdk"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cmdk-input-row">
              <span className="cmdk-icon">⌕</span>
              <input
                autoFocus
                className="cmdk-input"
                placeholder="Sayfalarda ve işlemlerde ara…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
              />
              <kbd className="cmdk-kbd">ESC</kbd>
            </div>
            <div className="cmdk-list">
              {results.length === 0 ? (
                <div className="cmdk-empty">Eşleşme yok</div>
              ) : (
                results.map((c, i) => (
                  <button
                    key={`${c.group}-${c.label}`}
                    type="button"
                    className={`cmdk-item${i === active ? ' cmdk-item-active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(c.href)}
                  >
                    <span className="cmdk-item-icon">{c.icon}</span>
                    <span>{c.label}</span>
                    <span className="cmdk-item-group">{c.group}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
