'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

type Command = { label: string; href: string; icon: string; group: string; keywords?: string };

const COMMANDS: Command[] = [
  { label: 'Overview', href: '/', icon: '◴', group: 'Navigate' },
  { label: 'Profiles', href: '/profiles', icon: '▦', group: 'Navigate', keywords: 'cloud phones devices' },
  { label: 'Proxies', href: '/proxies', icon: '⇄', group: 'Navigate' },
  { label: 'Library', href: '/library', icon: '◳', group: 'Navigate', keywords: 'assets files' },
  { label: 'Applications', href: '/applications', icon: '▤', group: 'Navigate', keywords: 'apps apk install' },
  { label: 'Fleet AI', href: '/ai', icon: '✦', group: 'Navigate', keywords: 'assistant chat claude' },
  { label: 'Analytics', href: '/analytics', icon: '∿', group: 'Navigate', keywords: 'metrics performance' },
  { label: 'Automation', href: '/automation', icon: '⚡', group: 'Navigate', keywords: 'templates tasks' },
  { label: 'RPA Studio', href: '/rpa', icon: '⚙', group: 'Navigate', keywords: 'flows steps builder' },
  { label: 'Scheduler', href: '/scheduler', icon: '⏱', group: 'Navigate', keywords: 'cron recurring' },
  { label: 'Synchronizer', href: '/synchronizer', icon: '⧉', group: 'Navigate', keywords: 'mirror sync' },
  { label: 'FleetHub', href: '/geehub', icon: '◈', group: 'Navigate', keywords: 'marketplace' },
  { label: 'Webhooks', href: '/webhooks', icon: '⇲', group: 'Navigate', keywords: 'callbacks notify' },
  { label: 'Jobs', href: '/jobs', icon: '☰', group: 'Navigate', keywords: 'tasks queue' },
  { label: 'Members', href: '/members', icon: '☻', group: 'Navigate', keywords: 'team users' },
  { label: 'Billing', href: '/billing', icon: '▭', group: 'Navigate', keywords: 'plan upgrade' },
  { label: 'Audit log', href: '/audit', icon: '☰', group: 'Navigate' },
  { label: 'Logs', href: '/logs', icon: '☰', group: 'Navigate' },
  { label: 'Settings', href: '/settings', icon: '⚙', group: 'Navigate' },
  // Quick actions
  { label: 'New cloud phone', href: '/profiles', icon: '＋', group: 'Actions', keywords: 'create profile' },
  { label: 'Add proxy', href: '/proxies', icon: '＋', group: 'Actions' },
  { label: 'Install an app', href: '/applications', icon: '＋', group: 'Actions' },
  { label: 'New RPA flow', href: '/rpa', icon: '＋', group: 'Actions', keywords: 'automation' },
  { label: 'Schedule a task', href: '/scheduler', icon: '＋', group: 'Actions' }
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
                placeholder="Search pages and actions…"
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
                <div className="cmdk-empty">No matches</div>
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
