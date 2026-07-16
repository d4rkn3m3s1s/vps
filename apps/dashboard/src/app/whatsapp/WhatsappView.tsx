'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send, RefreshCw, Search, Star, Archive, ArchiveRestore, Tag, X, Plus, Pin, PinOff,
  UserPlus, KeyRound, CheckCircle2, XCircle, Loader2, MessageSquare, Check, CheckCheck,
  ChevronDown, Smile, Copy, Forward, MessageSquarePlus, Zap, User, AlertTriangle, BarChart3,
  Megaphone, CheckSquare, Square, Ban, ShieldCheck, ImageDown, ShieldBan,
  Trash2, Eraser, Paperclip, Phone
} from 'lucide-react';
import { HoloHeader } from '../../components/hud';
import { useFleetEvents } from '../../lib/live';

type Device = { id: string; name: string; online: boolean };

type Conversation = {
  id: string;
  peer: string;
  displayName: string | null;
  lastMessageBody: string;
  lastDirection: string;
  lastStatus: string;
  lastMessageAt: string;
  unreadCount: number;
  favorite: boolean;
  archived: boolean;
  pinned: boolean;
  labelIds: string[];
  // Whether the contact is blocked on the device.
  blocked?: boolean;
  // Whether a captured avatar exists (lazy-loaded from the avatar endpoint).
  hasAvatar?: boolean;
};

// Scraped WhatsApp profile fields (from WHATSAPP_PROFILE).
type ProfileInfo = { profileName?: string; about?: string; phone?: string; lastSeen?: string };

type ThreadMessage = {
  id: string;
  direction: 'IN' | 'OUT';
  peer: string;
  body: string;
  status: string;
  failReason: string | null;
  waTimestamp: string;
  createdAt: string;
};

type Label = { id: string; name: string; color: string };
type Canned = { id: string; shortcut: string | null; title: string; body: string; sortOrder: number };
type Stats = { inbound: number; outbound: number; failed: number; openThreads: number; avgResponseMinutes: number | null };

type RegAccount = { id: string; status: string; phoneNumber: string | null; fullName: string | null; error: string | null };

type SmartFilter = 'all' | 'unread' | 'favorite' | 'archived';

const LIST_POLL_MS = 8000;
const THREAD_POLL_MS = 5000;
const REG_POLL_MS = 3000;
const PAGE_SIZE = 40;

const LABEL_STYLE: Record<string, { bg: string; fg: string; dot: string }> = {
  slate:   { bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1', dot: '#94a3b8' },
  emerald: { bg: 'rgba(16,185,129,0.16)',  fg: '#6ee7b7', dot: '#10b981' },
  sky:     { bg: 'rgba(56,189,248,0.16)',  fg: '#7dd3fc', dot: '#38bdf8' },
  violet:  { bg: 'rgba(139,92,246,0.16)',  fg: '#c4b5fd', dot: '#8b5cf6' },
  amber:   { bg: 'rgba(245,158,11,0.16)',  fg: '#fcd34d', dot: '#f59e0b' },
  rose:    { bg: 'rgba(244,63,94,0.16)',   fg: '#fda4af', dot: '#f43f5e' },
  cyan:    { bg: 'rgba(34,211,238,0.16)',  fg: '#67e8f9', dot: '#22d3ee' },
  lime:    { bg: 'rgba(132,204,22,0.16)',  fg: '#bef264', dot: '#84cc16' }
};
const LABEL_COLORS = Object.keys(LABEL_STYLE);

const SMART_FILTERS: Array<{ key: SmartFilter; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'unread', label: 'Okunmamış' },
  { key: 'favorite', label: 'Favori' },
  { key: 'archived', label: 'Arşiv' }
];

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥳','👍','👏','🙏','💪','🔥','✨','🎉','❤️','💯','✅','❌','⚠️','📌','📞','💬','⏰','🎁','💰','🚀','👋','🤝','🙌'];

const REG_STATUS: Record<string, { label: string; tone: 'busy' | 'otp' | 'ok' | 'fail' }> = {
  REGISTERING: { label: 'Kaydediliyor…', tone: 'busy' },
  AWAITING_OTP: { label: 'OTP bekleniyor', tone: 'otp' },
  ACTIVE: { label: 'Aktif', tone: 'ok' },
  FAILED: { label: 'Başarısız', tone: 'fail' }
};

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay) return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === yest.toDateString()) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}
function initials(peer: string, name?: string | null): string {
  if (name && name.trim()) return name.trim().slice(0, 2).toUpperCase();
  const s = peer.replace(/[^a-zA-Z0-9]/g, '');
  return (s.slice(-2) || peer.slice(0, 2) || '?').toUpperCase();
}
function convTitle(c: Conversation): string { return c.displayName?.trim() || c.peer; }

// Avatar: shows the captured WhatsApp photo (data-URI) when available, else the
// initials badge. `src` is the lazy-loaded data-URI (null = no photo yet).
function Avatar({ peer, name, src, large, className }: { peer: string; name?: string | null; src?: string | null; large?: boolean; className?: string }) {
  const cls = `wa-avatar${large ? ' wa-avatar-lg' : ''}${className ? ' ' + className : ''}`;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className={cls} style={{ padding: 0, overflow: 'hidden' }}><img src={src} alt="" className="wa-avatar-img" /></span>;
  }
  return <span className={cls}>{initials(peer, name)}</span>;
}

// Delivery-status tick for an OUT message/conversation.
function StatusTick({ status }: { status: string }) {
  if (status === 'FAILED') return <AlertTriangle size={12} className="wa-tick-fail" />;
  if (status === 'READ') return <CheckCheck size={12} className="wa-tick-read" />;
  if (status === 'DELIVERED') return <CheckCheck size={12} className="wa-tick" />;
  return <Check size={12} className="wa-tick" />;
}

export function WhatsappView({ devices }: { devices: Device[] }) {
  const [deviceId, setDeviceId] = useState<string>(devices[0]?.id ?? '');
  const device = useMemo(() => devices.find((d) => d.id === deviceId) ?? null, [devices, deviceId]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<SmartFilter>('all');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [labels, setLabels] = useState<Label[]>([]);
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const [canned, setCanned] = useState<Canned[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  const [activePeer, setActivePeer] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadBefore, setThreadBefore] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [labelEditorOpen, setLabelEditorOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('emerald');

  // Modes / popovers
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [cannedOpen, setCannedOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<ThreadMessage | null>(null);

  // Selection / broadcast
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  // Contact panel state
  const [contactName, setContactName] = useState('');
  const [contactNotes, setContactNotes] = useState('');
  // Blocked flag + scraped profile info for the OPEN thread (contact panel).
  const [contactBlocked, setContactBlocked] = useState(false);
  const [contactProfile, setContactProfile] = useState<ProfileInfo | null>(null);

  // Lazy avatar cache: peer → data-URI ('' = fetched-but-none, avoids re-fetching).
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const avatarInFlight = useRef<Set<string>>(new Set());

  // In-flight flags for the on-device jobs (they take seconds — show a spinner).
  const [profileBusy, setProfileBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);

  // Delete-message scope chooser (benden / herkesten sil) for the open thread.
  const [deleteChooserOpen, setDeleteChooserOpen] = useState(false);
  // Clear-chat confirmation modal.
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Send-media modal (URL + caption).
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');

  // "Kendi numaram" panel — dispatches WHATSAPP_MYNUMBER and polls the job result.
  const [myNumberOpen, setMyNumberOpen] = useState(false);
  const [myNumberBusy, setMyNumberBusy] = useState(false);
  const [myNumber, setMyNumber] = useState<string | null>(null);
  const [myNumberNotice, setMyNumberNotice] = useState<string | null>(null);

  // Blocked-contacts list panel (Settings › Privacy › Blocked scrape).
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedBusy, setBlockedBusy] = useState(false);
  const [blockedList, setBlockedList] = useState<string[] | null>(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);

  const composeRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConv = useMemo(
    () => conversations.find((c) => c.peer === activePeer) ?? null,
    [conversations, activePeer]
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── loaders ──
  const loadLabels = useCallback(async () => {
    try { const r = await fetch('/api/whatsapp/labels'); const j = await r.json(); setLabels((j?.data?.labels ?? []) as Label[]); } catch {}
  }, []);
  const loadCanned = useCallback(async () => {
    try { const r = await fetch('/api/whatsapp/canned'); const j = await r.json(); setCanned((j?.data?.replies ?? []) as Canned[]); } catch {}
  }, []);
  const loadStats = useCallback(async () => {
    if (!deviceId) { setStats(null); return; }
    try { const r = await fetch(`/api/whatsapp/stats?deviceId=${encodeURIComponent(deviceId)}&sinceHours=24`); const j = await r.json(); setStats((j?.data ?? null) as Stats | null); } catch {}
  }, [deviceId]);
  useEffect(() => { void loadLabels(); void loadCanned(); }, [loadLabels, loadCanned]);
  useEffect(() => { void loadStats(); const t = setInterval(() => void loadStats(), 30000); return () => clearInterval(t); }, [loadStats]);

  const loadConversations = useCallback(async () => {
    if (!deviceId) { setConversations([]); return; }
    setListLoading(true);
    try {
      const qs = new URLSearchParams({ deviceId, filter, limit: String(PAGE_SIZE) });
      if (labelFilter) qs.set('labelId', labelFilter);
      if (debouncedSearch) qs.set('search', debouncedSearch);
      const res = await fetch(`/api/whatsapp/conversations?${qs.toString()}`);
      const json = await res.json();
      setConversations((json?.data?.conversations ?? []) as Conversation[]);
      setNextCursor((json?.data?.nextCursor ?? null) as string | null);
    } catch {} finally { setListLoading(false); }
  }, [deviceId, filter, labelFilter, debouncedSearch]);

  const loadMore = useCallback(async () => {
    if (!deviceId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ deviceId, filter, limit: String(PAGE_SIZE), cursor: nextCursor });
      if (labelFilter) qs.set('labelId', labelFilter);
      if (debouncedSearch) qs.set('search', debouncedSearch);
      const res = await fetch(`/api/whatsapp/conversations?${qs.toString()}`);
      const json = await res.json();
      const more = (json?.data?.conversations ?? []) as Conversation[];
      setConversations((prev) => { const seen = new Set(prev.map((c) => c.peer)); return [...prev, ...more.filter((c) => !seen.has(c.peer))]; });
      setNextCursor((json?.data?.nextCursor ?? null) as string | null);
    } catch {} finally { setLoadingMore(false); }
  }, [deviceId, nextCursor, loadingMore, filter, labelFilter, debouncedSearch]);

  useEffect(() => {
    setConversations([]); setNextCursor(null);
    void loadConversations();
    // Pause polling while the tab is hidden — no point refreshing a list nobody's looking at.
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadConversations();
    }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadConversations]);

  const loadThread = useCallback(async (opts?: { silent?: boolean }) => {
    if (!deviceId || !activePeer) return;
    if (!opts?.silent) setThreadLoading(true);
    try {
      const qs = new URLSearchParams({ deviceId, peer: activePeer, limit: '50' });
      const res = await fetch(`/api/whatsapp/thread?${qs.toString()}`);
      const json = await res.json();
      setThread((json?.data?.messages ?? []) as ThreadMessage[]);
      setThreadBefore((json?.data?.nextBefore ?? null) as string | null);
    } catch {} finally { if (!opts?.silent) setThreadLoading(false); }
  }, [deviceId, activePeer]);

  const loadOlder = useCallback(async () => {
    if (!deviceId || !activePeer || !threadBefore) return;
    try {
      const qs = new URLSearchParams({ deviceId, peer: activePeer, limit: '50', before: threadBefore });
      const res = await fetch(`/api/whatsapp/thread?${qs.toString()}`);
      const json = await res.json();
      const older = (json?.data?.messages ?? []) as ThreadMessage[];
      const el = threadRef.current; const prevH = el?.scrollHeight ?? 0;
      setThread((prev) => { const seen = new Set(prev.map((m) => m.id)); return [...older.filter((m) => !seen.has(m.id)), ...prev]; });
      setThreadBefore((json?.data?.nextBefore ?? null) as string | null);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH; });
    } catch {}
  }, [deviceId, activePeer, threadBefore]);

  // Lazy-load one thread's avatar data-URI (cached; '' marks "fetched, none").
  const loadAvatar = useCallback(async (peer: string) => {
    if (!deviceId || !peer) return;
    if (peer in avatars || avatarInFlight.current.has(peer)) return;
    avatarInFlight.current.add(peer);
    try {
      const r = await fetch(`/api/whatsapp/conversations/avatar?deviceId=${encodeURIComponent(deviceId)}&peer=${encodeURIComponent(peer)}`);
      const j = await r.json();
      const uri = (j?.data?.avatarBase64 ?? '') as string;
      setAvatars((prev) => ({ ...prev, [peer]: uri || '' }));
    } catch {} finally { avatarInFlight.current.delete(peer); }
  }, [deviceId, avatars]);

  const openConversation = useCallback(async (peer: string) => {
    setActivePeer(peer); setThread([]); setNotice(null); setContactOpen(false);
    setContactBlocked(false); setContactProfile(null);
    setConversations((prev) => prev.map((c) => (c.peer === peer ? { ...c, unreadCount: 0 } : c)));
    void loadAvatar(peer);
    void fetch('/api/whatsapp/thread/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, peer }) }).catch(() => undefined);
  }, [deviceId, loadAvatar]);

  useEffect(() => {
    if (!activePeer) return;
    void loadThread();
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadThread({ silent: true });
    }, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [activePeer, loadThread]);

  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.length]);
  useEffect(() => { setActivePeer(null); setThread([]); setSelectMode(false); setSelected(new Set()); }, [deviceId]);

  // Load contact info when opening the contact panel (name/notes + blocked flag +
  // scraped profile fields).
  useEffect(() => {
    if (!contactOpen || !activePeer || !deviceId) return;
    void (async () => {
      try {
        const r = await fetch(`/api/whatsapp/conversations/contact?deviceId=${encodeURIComponent(deviceId)}&peer=${encodeURIComponent(activePeer)}`);
        const j = await r.json();
        setContactName(j?.data?.displayName ?? '');
        setContactNotes(j?.data?.notes ?? '');
        setContactBlocked(Boolean(j?.data?.blocked));
        setContactProfile((j?.data?.profileInfo ?? null) as ProfileInfo | null);
      } catch {}
    })();
  }, [contactOpen, activePeer, deviceId]);

  // Kick off avatar loads for threads that report a captured photo.
  useEffect(() => {
    for (const c of conversations) {
      if (c.hasAvatar && !(c.peer in avatars)) void loadAvatar(c.peer);
    }
  }, [conversations, avatars, loadAvatar]);

  // Reset the avatar cache when switching devices (photos are device-scoped).
  useEffect(() => { setAvatars({}); avatarInFlight.current.clear(); }, [deviceId]);

  useFleetEvents(['whatsapp.message'], (e) => {
    if (e.deviceId && e.deviceId !== deviceId) return;
    void loadConversations();
    const p = (e.payload as { peer?: string } | undefined)?.peer;
    if (activePeer && p === activePeer) void loadThread({ silent: true });
  });

  // ── send ──
  async function doSend(to: string, text: string) {
    const res = await fetch('/api/accounts/whatsapp/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, to, message: text })
    });
    return res.ok;
  }
  async function send() {
    if (!deviceId || !activePeer || !body.trim()) return;
    setSending(true); setNotice(null);
    const text = body.trim();
    try {
      const ok = await doSend(activePeer, text);
      if (!ok) { setNotice('Gönderilemedi.'); }
      else {
        setBody(''); setEmojiOpen(false);
        setThread((prev) => [...prev, { id: `tmp-${Date.now()}`, direction: 'OUT', peer: activePeer, body: text, status: 'QUEUED', failReason: null, waTimestamp: new Date().toISOString(), createdAt: new Date().toISOString() }]);
        setTimeout(() => { void loadThread({ silent: true }); void loadConversations(); }, 4000);
      }
    } catch { setNotice('Ağ hatası.'); } finally { setSending(false); }
  }

  async function startNewChat() {
    const to = newChatNumber.replace(/[^\d]/g, '');
    if (!to) return;
    setNewChatOpen(false); setNewChatNumber('');
    await openConversation(to);
    void loadConversations();
  }

  // ── conversation actions ──
  async function convState(peer: string, patch: Record<string, boolean>) {
    await fetch('/api/whatsapp/conversations/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, peer, ...patch }) }).catch(() => undefined);
  }
  async function toggleFavorite(c: Conversation) {
    setConversations((prev) => prev.map((x) => (x.peer === c.peer ? { ...x, favorite: !x.favorite } : x)));
    await convState(c.peer, { favorite: !c.favorite });
  }
  async function togglePin(c: Conversation) {
    setConversations((prev) => prev.map((x) => (x.peer === c.peer ? { ...x, pinned: !x.pinned } : x)));
    await convState(c.peer, { pinned: !c.pinned }); void loadConversations();
  }
  async function toggleArchive(c: Conversation) {
    await convState(c.peer, { archived: !c.archived });
    if (c.peer === activePeer) setActivePeer(null);
    void loadConversations();
  }
  async function toggleLabelOnConv(c: Conversation, labelId: string) {
    const has = c.labelIds.includes(labelId);
    const next = has ? c.labelIds.filter((l) => l !== labelId) : [...c.labelIds, labelId];
    setConversations((prev) => prev.map((x) => (x.peer === c.peer ? { ...x, labelIds: next } : x)));
    await fetch('/api/whatsapp/conversations/labels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, peer: c.peer, labelIds: next }) }).catch(() => undefined);
  }

  async function saveContact() {
    if (!activePeer) return;
    await fetch('/api/whatsapp/conversations/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, peer: activePeer, displayName: contactName, notes: contactNotes }) }).catch(() => undefined);
    setContactOpen(false); void loadConversations();
  }

  // ── profile picture + block/unblock (on-device jobs, ~seconds) ──
  // Fetch the contact's avatar + profile text. The agent screenshots the photo
  // and scrapes name/about; we poll the thread a few seconds later to pick up
  // the freshly-stored avatar/profileInfo.
  async function fetchProfile() {
    if (!deviceId || !activePeer || profileBusy) return;
    setProfileBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, to: activePeer })
      });
      if (!res.ok) { setNotice('Profil çekme başlatılamadı.'); return; }
      setNotice('Profil çekiliyor… (cihazda ~10sn)');
      // Re-fetch the avatar + contact info after the agent has had time to run.
      const peer = activePeer;
      setTimeout(() => {
        setAvatars((prev) => { const n = { ...prev }; delete n[peer]; return n; }); // force re-fetch
        void loadAvatar(peer);
        void loadConversations();
        if (contactOpen) {
          void (async () => {
            try {
              const r = await fetch(`/api/whatsapp/conversations/contact?deviceId=${encodeURIComponent(deviceId)}&peer=${encodeURIComponent(peer)}`);
              const j = await r.json();
              setContactProfile((j?.data?.profileInfo ?? null) as ProfileInfo | null);
            } catch {}
          })();
        }
        setNotice(null);
      }, 12000);
    } catch { setNotice('Ağ hatası.'); } finally { setProfileBusy(false); }
  }

  // Block or unblock the open contact. Optimistically flips the local flag; the
  // agent reconciles it on completion.
  async function toggleBlock() {
    if (!deviceId || !activePeer || blockBusy) return;
    const next = !contactBlocked;
    setBlockBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/block', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, to: activePeer, block: next })
      });
      if (!res.ok) { setNotice(next ? 'Engellenemedi.' : 'Engel kaldırılamadı.'); return; }
      setContactBlocked(next);
      const peer = activePeer;
      setConversations((prev) => prev.map((c) => (c.peer === peer ? { ...c, blocked: next } : c)));
      setNotice(next ? 'Engelleniyor… (cihazda)' : 'Engel kaldırılıyor… (cihazda)');
      setTimeout(() => { void loadConversations(); setNotice(null); }, 6000);
    } catch { setNotice('Ağ hatası.'); } finally { setBlockBusy(false); }
  }

  // Read the device's blocked-contacts list off WhatsApp settings.
  async function loadBlockedList() {
    if (!deviceId || blockedBusy) return;
    setBlockedBusy(true); setBlockedNotice('Engellenenler listesi çekiliyor… (cihazda ~15sn)'); setBlockedList(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/blocklist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId })
      });
      if (!res.ok) { setBlockedNotice('Liste çekilemedi.'); return; }
      const j = await res.json();
      const jobId = j?.data?.job?.id as string | undefined;
      if (!jobId) { setBlockedNotice('İş oluşturulamadı.'); return; }
      // Poll the job for its result (the agent scrapes the list, ~15s).
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const jr = await fetch(`/api/jobs/${jobId}`);
          const jj = await jr.json();
          const job = jj?.data;
          if (job?.status === 'COMPLETED') {
            const list = (job?.result?.blocked ?? []) as string[];
            setBlockedList(list);
            setBlockedNotice(list.length ? null : 'Engellenen kişi bulunamadı.');
            void loadConversations();
            return;
          }
          if (job?.status === 'FAILED') { setBlockedNotice('Liste çekilemedi (cihaz hatası).'); return; }
        } catch {}
        if (tries < 20) setTimeout(() => void poll(), 2000);
        else setBlockedNotice('Zaman aşımı — tekrar deneyin.');
      };
      setTimeout(() => void poll(), 3000);
    } catch { setBlockedNotice('Ağ hatası.'); } finally { setBlockedBusy(false); }
  }

  // Delete the last message in the open thread. scope: 'me' (benden) or
  // 'everyone' (herkesten). The agent long-presses the last bubble and confirms.
  async function deleteMessage(scope: 'me' | 'everyone') {
    if (!deviceId || !activePeer || deleteBusy) return;
    setDeleteChooserOpen(false);
    setDeleteBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/delete-message', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, to: activePeer, scope })
      });
      if (!res.ok) { setNotice('Mesaj silme başlatılamadı.'); return; }
      setNotice(scope === 'everyone' ? 'Son mesaj herkesten siliniyor… (cihazda)' : 'Son mesaj benden siliniyor… (cihazda)');
      setTimeout(() => { void loadConversations(); void loadThread({ silent: true }); setNotice(null); }, 8000);
    } catch { setNotice('Ağ hatası.'); } finally { setDeleteBusy(false); }
  }

  // Clear the whole local chat history for the open thread.
  async function clearChat() {
    if (!deviceId || !activePeer || clearBusy) return;
    setClearConfirmOpen(false);
    setClearBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/clear-chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, to: activePeer })
      });
      if (!res.ok) { setNotice('Sohbet temizleme başlatılamadı.'); return; }
      setNotice('Sohbet temizleniyor… (cihazda)');
      setTimeout(() => { void loadConversations(); void loadThread({ silent: true }); setNotice(null); }, 8000);
    } catch { setNotice('Ağ hatası.'); } finally { setClearBusy(false); }
  }

  // Send a media message (image/document) by URL, with an optional caption.
  async function sendMedia() {
    if (!deviceId || !activePeer || mediaBusy) return;
    const url = mediaUrl.trim();
    if (!url) { setNotice('Medya bağlantısı gerekli.'); return; }
    setMediaBusy(true); setNotice(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/send-media', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, to: activePeer, mediaUrl: url, ...(mediaCaption.trim() ? { caption: mediaCaption.trim() } : {}) })
      });
      if (!res.ok) { setNotice('Medya gönderilemedi.'); return; }
      setMediaOpen(false); setMediaUrl(''); setMediaCaption('');
      setNotice('Medya gönderiliyor… (cihazda)');
      setTimeout(() => { void loadConversations(); void loadThread({ silent: true }); setNotice(null); }, 8000);
    } catch { setNotice('Ağ hatası.'); } finally { setMediaBusy(false); }
  }

  // Read this account's own WhatsApp number off the device (Settings › profile).
  // Dispatches WHATSAPP_MYNUMBER and polls the job for the scraped number.
  async function loadMyNumber() {
    if (!deviceId || myNumberBusy) return;
    setMyNumberOpen(true);
    setMyNumberBusy(true); setMyNumber(null); setMyNumberNotice('Kendi numaran okunuyor… (cihazda ~15sn)');
    try {
      const res = await fetch('/api/accounts/whatsapp/mynumber', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId })
      });
      if (!res.ok) { setMyNumberNotice('Numara okuma başlatılamadı.'); return; }
      const j = await res.json();
      const jobId = j?.data?.job?.id as string | undefined;
      if (!jobId) { setMyNumberNotice('İş oluşturulamadı.'); return; }
      let tries = 0;
      const poll = async () => {
        tries++;
        try {
          const jr = await fetch(`/api/jobs/${jobId}`);
          const jj = await jr.json();
          const job = jj?.data;
          if (job?.status === 'COMPLETED') {
            const num = (job?.result?.number ?? '') as string;
            if (num) { setMyNumber(num); setMyNumberNotice(null); }
            else setMyNumberNotice('Numara okunamadı.');
            return;
          }
          if (job?.status === 'FAILED') { setMyNumberNotice('Numara okunamadı (cihaz hatası).'); return; }
        } catch {}
        if (tries < 20) setTimeout(() => void poll(), 2000);
        else setMyNumberNotice('Zaman aşımı — tekrar deneyin.');
      };
      setTimeout(() => void poll(), 3000);
    } catch { setMyNumberNotice('Ağ hatası.'); } finally { setMyNumberBusy(false); }
  }

  // ── labels ──
  async function createLabel() {
    if (!newLabelName.trim()) return;
    const r = await fetch('/api/whatsapp/labels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor }) }).catch(() => null);
    if (r?.ok) { setNewLabelName(''); void loadLabels(); }
  }
  async function deleteLabel(id: string) {
    await fetch(`/api/whatsapp/labels/${id}`, { method: 'DELETE' }).catch(() => undefined);
    if (labelFilter === id) setLabelFilter(null);
    void loadLabels(); void loadConversations();
  }

  // ── selection / bulk ──
  function toggleSelect(peer: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(peer)) n.delete(peer); else n.add(peer); return n; });
  }
  async function bulk(action: string, labelId?: string) {
    const peers = [...selected];
    if (!peers.length) return;
    await fetch('/api/whatsapp/conversations/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, peers, action, ...(labelId ? { labelId } : {}) }) }).catch(() => undefined);
    setSelected(new Set()); setSelectMode(false); void loadConversations();
  }

  function insertCanned(c: Canned) {
    setBody((b) => (b ? `${b} ${c.body}` : c.body)); setCannedOpen(false); composeRef.current?.focus();
  }
  function insertEmoji(em: string) { setBody((b) => b + em); composeRef.current?.focus(); }
  async function copyMsg(m: ThreadMessage) { try { await navigator.clipboard.writeText(m.body); setNotice('Kopyalandı'); setTimeout(() => setNotice(null), 1500); } catch {} }

  async function doForward(toPeer: string) {
    if (!forwardMsg) return;
    const ok = await doSend(toPeer, forwardMsg.body);
    setForwardMsg(null);
    setNotice(ok ? 'İletildi' : 'İletilemedi'); setTimeout(() => setNotice(null), 2000);
    if (ok) { void loadConversations(); if (toPeer === activePeer) setTimeout(() => void loadThread({ silent: true }), 3000); }
  }

  // Keyboard shortcuts: Esc close, Ctrl+K search, Ctrl+E archive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setActivePeer(null); setNewChatOpen(false); setCannedOpen(false); setEmojiOpen(false); setContactOpen(false); setForwardMsg(null); setBroadcastOpen(false); setBlockedOpen(false); setDeleteChooserOpen(false); setClearConfirmOpen(false); setMediaOpen(false); setMyNumberOpen(false); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); (document.querySelector('.wa-search input') as HTMLInputElement | null)?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && activeConv) { e.preventDefault(); void toggleArchive(activeConv); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv]);

  const totalUnread = useMemo(() => conversations.reduce((n, c) => n + (c.archived ? 0 : c.unreadCount), 0), [conversations]);

  return (
    <>
      <HoloHeader
        eyebrow="Mesajlaşma"
        title="WhatsApp"
        subtitle="Sohbetleri WhatsApp Web gibi yönetin — sohbet açın, kategorilere ayırın, hazır cevap/emoji ile hızlı yanıtlayın, toplu mesaj gönderin."
        actions={
          <select className="inline-select" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.length === 0 ? <option value="">Cihaz yok</option> : null}
            {devices.map((d) => (<option key={d.id} value={d.id}>{d.name} {d.online ? '· çevrimiçi' : '· çevrimdışı'}</option>))}
          </select>
        }
      />

      {/* Stats strip */}
      {stats ? (
        <div className="wa-stats">
          <span><MessageSquare size={13} /> Gelen <b>{stats.inbound}</b></span>
          <span><Send size={13} /> Giden <b>{stats.outbound}</b></span>
          {stats.failed > 0 ? <span className="wa-stat-fail"><AlertTriangle size={13} /> Başarısız <b>{stats.failed}</b></span> : null}
          <span><MessageSquarePlus size={13} /> Açık <b>{stats.openThreads}</b></span>
          {stats.avgResponseMinutes != null ? <span><BarChart3 size={13} /> Ort. yanıt <b>{stats.avgResponseMinutes}dk</b></span> : null}
          <span className="wa-stats-right">Son 24 saat</span>
        </div>
      ) : null}

      <RegisterPanel deviceId={deviceId} deviceName={device?.name ?? '—'} onRegistered={() => void loadConversations()} />
      <CannedManager canned={canned} onChange={loadCanned} />

      <div className="wa-web">
        {/* LEFT */}
        <aside className="wa-sidebar">
          <div className="wa-sidebar-head">
            <div className="wa-sidebar-toprow">
              <div className="wa-search">
                <Search size={14} />
                <input placeholder="Ara (Ctrl+K)…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {search ? <button className="wa-search-clear" onClick={() => setSearch('')}><X size={13} /></button> : null}
              </div>
              <button className="wa-icon-btn" title="Yeni sohbet" onClick={() => setNewChatOpen(true)}><MessageSquarePlus size={16} /></button>
              <button className={`wa-icon-btn ${selectMode ? 'on' : ''}`} title="Toplu seçim" onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}><CheckSquare size={16} /></button>
              <button className="wa-icon-btn" title="Engellenenler listesi" disabled={!deviceId} onClick={() => { setBlockedOpen(true); void loadBlockedList(); }}><ShieldBan size={16} /></button>
              <button className="wa-icon-btn" title="Kendi numaram" disabled={!deviceId || myNumberBusy} onClick={() => void loadMyNumber()}>{myNumberBusy ? <Loader2 size={16} className="spin" /> : <Phone size={16} />}</button>
            </div>

            {newChatOpen ? (
              <div className="wa-newchat">
                <input className="field-input" placeholder="905551112233" value={newChatNumber} inputMode="tel" autoFocus
                  onChange={(e) => setNewChatNumber(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void startNewChat(); }} />
                <button className="btn-primary btn-xs" onClick={() => void startNewChat()} disabled={!newChatNumber.trim()}>Aç</button>
                <button className="btn-ghost btn-xs" onClick={() => setNewChatOpen(false)}>İptal</button>
              </div>
            ) : null}

            <div className="wa-filters">
              {SMART_FILTERS.map((f) => (
                <button key={f.key} className={`wa-filter ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                  {f.label}
                  {f.key === 'unread' && totalUnread > 0 ? <span className="wa-filter-count">{totalUnread}</span> : null}
                </button>
              ))}
            </div>

            <div className="wa-label-bar">
              {labels.map((l) => {
                const st = LABEL_STYLE[l.color] ?? LABEL_STYLE.slate!; const on = labelFilter === l.id;
                return (
                  <button key={l.id} className={`wa-label-chip ${on ? 'active' : ''}`} style={on ? { background: st.bg, color: st.fg, borderColor: st.dot } : undefined} onClick={() => setLabelFilter(on ? null : l.id)}>
                    <span className="wa-label-dot" style={{ background: st.dot }} />{l.name}
                  </button>
                );
              })}
              <button className="wa-label-chip wa-label-manage" onClick={() => setLabelEditorOpen((v) => !v)}><Tag size={11} /> Etiketler</button>
            </div>

            {labelEditorOpen ? (
              <div className="wa-label-editor">
                <div className="wa-label-editor-row">
                  <input placeholder="Yeni etiket adı" value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} maxLength={40} />
                  <div className="wa-color-pick">
                    {LABEL_COLORS.map((c) => (<button key={c} className={`wa-color-dot ${newLabelColor === c ? 'sel' : ''}`} style={{ background: LABEL_STYLE[c]!.dot }} onClick={() => setNewLabelColor(c)} />))}
                  </div>
                  <button className="btn-primary btn-xs" onClick={() => void createLabel()} disabled={!newLabelName.trim()}><Plus size={12} /> Ekle</button>
                </div>
                {labels.length ? (
                  <div className="wa-label-list">
                    {labels.map((l) => (<span key={l.id} className="wa-label-manage-item" style={{ background: (LABEL_STYLE[l.color] ?? LABEL_STYLE.slate!).bg, color: (LABEL_STYLE[l.color] ?? LABEL_STYLE.slate!).fg }}>{l.name}<button onClick={() => void deleteLabel(l.id)}><X size={11} /></button></span>))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectMode && selected.size > 0 ? (
              <div className="wa-bulkbar">
                <span className="wa-bulk-count">{selected.size} seçili</span>
                <button className="btn-ghost btn-xs" onClick={() => void bulk('read')}><Check size={12} /> Okundu</button>
                <button className="btn-ghost btn-xs" onClick={() => void bulk('archive')}><Archive size={12} /> Arşivle</button>
                <button className="btn-ghost btn-xs" onClick={() => void bulk('pin')}><Pin size={12} /> Sabitle</button>
                <button className="btn-ghost btn-xs" onClick={() => setBroadcastOpen(true)}><Megaphone size={12} /> Toplu Mesaj</button>
              </div>
            ) : null}
          </div>

          <div className="wa-conv-list">
            {!deviceId ? <p className="helper wa-empty">Önce bir cihaz seçin.</p>
              : listLoading && conversations.length === 0 ? <p className="helper wa-empty"><Loader2 size={14} className="spin" /> Yükleniyor…</p>
              : conversations.length === 0 ? <p className="helper wa-empty">{debouncedSearch || labelFilter || filter !== 'all' ? 'Bu filtreye uyan sohbet yok.' : 'Henüz sohbet yok.'}</p>
              : (
                <>
                  {conversations.map((c) => {
                    const active = c.peer === activePeer; const sel = selected.has(c.peer);
                    return (
                      <button key={c.id} className={`wa-conv ${active ? 'active' : ''} ${c.unreadCount > 0 ? 'unread' : ''}`}
                        onClick={() => selectMode ? toggleSelect(c.peer) : void openConversation(c.peer)}>
                        {selectMode
                          ? <span className="wa-conv-check">{sel ? <CheckSquare size={18} /> : <Square size={18} />}</span>
                          : <span className="wa-avatar-wrap">
                              <Avatar peer={c.peer} name={c.displayName} src={avatars[c.peer] || null} />
                              {c.blocked ? <span className="wa-avatar-blocked" title="Engellendi"><Ban size={11} /></span> : null}
                            </span>}
                        <div className="wa-conv-main">
                          <div className="wa-conv-top">
                            <span className="wa-conv-peer">
                              {c.pinned ? <Pin size={11} className="wa-pin-inline" /> : null}
                              {c.favorite ? <Star size={11} className="wa-fav-inline" /> : null}
                              {convTitle(c)}
                            </span>
                            <span className="wa-conv-time">{shortTime(c.lastMessageAt)}</span>
                          </div>
                          <div className="wa-conv-bottom">
                            <span className="wa-conv-preview">
                              {c.lastDirection === 'OUT' ? <StatusTick status={c.lastStatus} /> : null}
                              {c.lastMessageBody || <em style={{ opacity: 0.5 }}>medya/mesaj</em>}
                            </span>
                            {c.unreadCount > 0 ? <span className="wa-unread-badge">{c.unreadCount}</span> : null}
                          </div>
                          {c.labelIds.length ? (
                            <div className="wa-conv-labels">
                              {c.labelIds.map((id) => { const l = labelById.get(id); if (!l) return null; const st = LABEL_STYLE[l.color] ?? LABEL_STYLE.slate!; return <span key={id} className="wa-conv-label" style={{ background: st.bg, color: st.fg }}>{l.name}</span>; })}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                  {nextCursor ? <button className="wa-load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}{loadingMore ? 'Yükleniyor…' : 'Daha fazla sohbet'}</button> : null}
                </>
              )}
          </div>
        </aside>

        {/* RIGHT */}
        <section className="wa-chat">
          {!activePeer || !activeConv ? (
            <div className="wa-chat-empty">
              <MessageSquare size={40} strokeWidth={1.2} />
              <p>Bir sohbet seçin</p>
              <span>Soldan bir kişiye tıklayın veya <b>yeni sohbet</b> ile bir numaraya ilk mesajı gönderin.</span>
            </div>
          ) : (
            <>
              <header className="wa-chat-head">
                <button className="wa-avatar-btn" onClick={() => setContactOpen((v) => !v)} title="Kişi bilgisi">
                  <Avatar peer={activeConv.peer} name={activeConv.displayName} src={avatars[activeConv.peer] || null} large />
                </button>
                <button className="wa-chat-head-info" onClick={() => setContactOpen((v) => !v)}>
                  <span className="wa-chat-peer">{convTitle(activeConv)}{contactBlocked ? <span className="wa-blocked-tag"><Ban size={11} /> Engelli</span> : null}</span>
                  <span className="wa-chat-sub">{activeConv.displayName ? activeConv.peer + ' · ' : ''}{device?.name} · {device?.online ? 'çevrimiçi' : 'çevrimdışı'}</span>
                </button>
                <div className="wa-chat-actions">
                  <button className="wa-icon-btn" title="Profil fotoğrafı + bilgisini çek" disabled={profileBusy} onClick={() => void fetchProfile()}>{profileBusy ? <Loader2 size={16} className="spin" /> : <ImageDown size={16} />}</button>
                  <button className={`wa-icon-btn ${contactBlocked ? 'danger-on' : ''}`} title={contactBlocked ? 'Engeli kaldır' : 'Engelle'} disabled={blockBusy} onClick={() => void toggleBlock()}>{blockBusy ? <Loader2 size={16} className="spin" /> : contactBlocked ? <ShieldCheck size={16} /> : <Ban size={16} />}</button>
                  <button className={`wa-icon-btn ${activeConv.pinned ? 'on' : ''}`} title="Sabitle" onClick={() => void togglePin(activeConv)}>{activeConv.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
                  <button className={`wa-icon-btn ${activeConv.favorite ? 'on' : ''}`} title="Favori" onClick={() => void toggleFavorite(activeConv)}><Star size={16} /></button>
                  <LabelMenu conv={activeConv} labels={labels} onToggle={(id) => void toggleLabelOnConv(activeConv, id)} />
                  <button className="wa-icon-btn" title={activeConv.archived ? 'Arşivden çıkar' : 'Arşivle'} onClick={() => void toggleArchive(activeConv)}>{activeConv.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>
                  <button className="wa-icon-btn" title="Son mesajı sil" disabled={deleteBusy} onClick={() => setDeleteChooserOpen(true)}>{deleteBusy ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}</button>
                  <button className="wa-icon-btn" title="Sohbeti temizle" disabled={clearBusy} onClick={() => setClearConfirmOpen(true)}>{clearBusy ? <Loader2 size={16} className="spin" /> : <Eraser size={16} />}</button>
                  <button className="wa-icon-btn" title="Kişi bilgisi" onClick={() => setContactOpen((v) => !v)}><User size={16} /></button>
                  <button className="wa-icon-btn" title="Yenile" onClick={() => void loadThread()}><RefreshCw size={15} className={threadLoading ? 'spin' : ''} /></button>
                </div>
              </header>

              <div className="wa-chat-body">
                <div className="wa-thread" ref={threadRef}>
                  {threadBefore ? <button className="wa-load-older" onClick={() => void loadOlder()}>Önceki mesajlar</button> : null}
                  {threadLoading && thread.length === 0 ? <p className="helper wa-empty"><Loader2 size={14} className="spin" /> Yükleniyor…</p>
                    : thread.length === 0 ? <p className="helper wa-empty">Bu sohbette henüz mesaj yok.</p>
                    : thread.map((m) => (
                      <div key={m.id} className={`wa-msg ${m.direction === 'OUT' ? 'out' : 'in'} ${m.status === 'FAILED' ? 'failed' : ''}`}>
                        <div className="wa-msg-body">{m.body}</div>
                        <div className="wa-msg-meta">
                          {m.status === 'FAILED' ? <span className="wa-msg-failtag">gönderilemedi{m.failReason ? ` · ${m.failReason}` : ''}</span> : null}
                          {shortTime(m.waTimestamp)}
                          {m.direction === 'OUT' ? <StatusTick status={m.status} /> : null}
                        </div>
                        <div className="wa-msg-hover">
                          <button title="Kopyala" onClick={() => void copyMsg(m)}><Copy size={12} /></button>
                          <button title="İlet" onClick={() => setForwardMsg(m)}><Forward size={12} /></button>
                        </div>
                      </div>
                    ))}
                </div>

                {contactOpen ? (
                  <aside className="wa-contact-panel">
                    <div className="wa-contact-head"><User size={16} /> Kişi Bilgisi <button className="wa-icon-btn" onClick={() => setContactOpen(false)}><X size={15} /></button></div>

                    {/* Profile card: captured avatar + scraped name/about, with a
                        "çek" button that dispatches the on-device profile fetch. */}
                    <div className="wa-profile-card">
                      <Avatar peer={activeConv.peer} name={activeConv.displayName} src={avatars[activeConv.peer] || null} large className="wa-profile-avatar" />
                      <div className="wa-profile-meta">
                        <b>{contactProfile?.profileName || convTitle(activeConv)}</b>
                        {contactProfile?.about ? <span className="wa-profile-about">{contactProfile.about}</span> : <span className="wa-profile-about muted">Durum bilgisi yok</span>}
                      </div>
                      <button className="btn-ghost btn-sm" disabled={profileBusy} onClick={() => void fetchProfile()} title="Profil fotoğrafı + durum bilgisini cihazdan çek">
                        {profileBusy ? <Loader2 size={13} className="spin" /> : <ImageDown size={13} />} {profileBusy ? 'Çekiliyor…' : 'Profili çek'}
                      </button>
                    </div>

                    <label className="field"><span>Görünen ad</span><input className="field-input" placeholder={activeConv.peer} value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
                    <label className="field"><span>Numara</span><input className="field-input mono" value={contactProfile?.phone || activeConv.peer} disabled /></label>
                    <label className="field"><span>Notlar</span><textarea className="field-input" rows={4} placeholder="Bu kişi hakkında notlar…" value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} /></label>
                    <button className="btn-primary btn-sm" onClick={() => void saveContact()}>Kaydet</button>

                    {/* Block / unblock action. */}
                    <button className={`wa-block-btn ${contactBlocked ? 'unblock' : ''}`} disabled={blockBusy} onClick={() => void toggleBlock()}>
                      {blockBusy ? <Loader2 size={14} className="spin" /> : contactBlocked ? <ShieldCheck size={14} /> : <Ban size={14} />}
                      {contactBlocked ? 'Engeli kaldır' : 'Kişiyi engelle'}
                    </button>
                  </aside>
                ) : null}
              </div>

              <footer className="wa-compose-bar">
                <div className="wa-compose-tools">
                  <button className="wa-icon-btn" title="Emoji" onClick={() => { setEmojiOpen((v) => !v); setCannedOpen(false); }}><Smile size={18} /></button>
                  <button className="wa-icon-btn" title="Hazır cevap" onClick={() => { setCannedOpen((v) => !v); setEmojiOpen(false); }}><Zap size={18} /></button>
                  <button className="wa-icon-btn" title="Medya gönder" disabled={mediaBusy} onClick={() => { setMediaOpen(true); setEmojiOpen(false); setCannedOpen(false); }}>{mediaBusy ? <Loader2 size={18} className="spin" /> : <Paperclip size={18} />}</button>
                  {emojiOpen ? <div className="wa-emoji-pop">{EMOJIS.map((em) => <button key={em} onClick={() => insertEmoji(em)}>{em}</button>)}</div> : null}
                  {cannedOpen ? (
                    <div className="wa-canned-pop">
                      {canned.length === 0 ? <p className="helper" style={{ margin: 0, padding: '0.5rem' }}>Hazır cevap yok. Yukarıdaki panelden ekleyin.</p>
                        : canned.map((c) => <button key={c.id} className="wa-canned-opt" onClick={() => insertCanned(c)}><b>{c.title}</b><span>{c.body.slice(0, 60)}</span></button>)}
                    </div>
                  ) : null}
                </div>
                <textarea ref={composeRef} className="wa-compose-input" rows={1} placeholder="Bir mesaj yazın… (Enter gönder)" value={body}
                  onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                <button className="wa-send-btn" disabled={!body.trim() || sending} onClick={() => void send()}>{sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}</button>
              </footer>
              {notice ? <p className="helper wa-notice">{notice}</p> : null}
            </>
          )}
        </section>
      </div>

      {/* Forward modal */}
      {forwardMsg ? (
        <ForwardModal msg={forwardMsg} conversations={conversations} onClose={() => setForwardMsg(null)} onForward={doForward} />
      ) : null}

      {/* Broadcast modal */}
      {broadcastOpen ? (
        <BroadcastModal deviceId={deviceId} labels={labels} preselected={[...selected]} onClose={() => setBroadcastOpen(false)} onDone={() => { setBroadcastOpen(false); setSelected(new Set()); setSelectMode(false); }} />
      ) : null}

      {/* Blocked-contacts list (scraped from the device's WhatsApp settings) */}
      {blockedOpen ? (
        <div className="wa-modal-overlay" onClick={() => setBlockedOpen(false)}>
          <div className="wa-modal wa-blocked-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wa-modal-head">
              <span><ShieldBan size={16} /> Engellenen Kişiler</span>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button className="btn-ghost btn-xs" disabled={blockedBusy} onClick={() => void loadBlockedList()}>{blockedBusy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Yenile</button>
                <button className="wa-icon-btn" onClick={() => setBlockedOpen(false)}><X size={15} /></button>
              </div>
            </div>
            <p className="helper" style={{ margin: '0 0 0.5rem' }}>Cihaz: <b>{device?.name ?? '—'}</b> · WhatsApp Ayarlar › Gizlilik › Engellenenler'den okunur.</p>
            {blockedNotice ? <p className="helper wa-notice" style={{ margin: '0.25rem 0' }}>{blockedBusy ? <Loader2 size={13} className="spin" /> : null} {blockedNotice}</p> : null}
            <div className="wa-blocked-list">
              {blockedList === null && !blockedNotice ? <p className="helper"><Loader2 size={14} className="spin" /> Yükleniyor…</p>
                : blockedList && blockedList.length === 0 ? <p className="helper">Engellenen kişi yok.</p>
                : (blockedList ?? []).map((name, i) => {
                    const digits = name.replace(/[^\d]/g, '');
                    return (
                      <div key={`${name}-${i}`} className="wa-blocked-row">
                        <Avatar peer={digits || name} name={/[a-zA-Z]/.test(name) ? name : null} />
                        <span className="wa-blocked-name">{name}</span>
                        {digits.length >= 7 ? (
                          <button className="btn-ghost btn-xs" onClick={() => { setBlockedOpen(false); void openConversation(digits); }}>Sohbeti aç</button>
                        ) : null}
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete-message scope chooser (benden / herkesten sil). */}
      {deleteChooserOpen ? (
        <div className="wa-modal-overlay" onClick={() => setDeleteChooserOpen(false)}>
          <div className="wa-modal wa-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="wa-modal-head">
              <h3><Trash2 size={16} /> Son mesajı sil</h3>
              <button className="wa-icon-btn" onClick={() => setDeleteChooserOpen(false)}><X size={15} /></button>
            </div>
            <p className="helper" style={{ margin: '0 0 0.75rem' }}>Bu sohbetteki <b>son mesaj</b> silinir. Kapsamı seçin:</p>
            <div className="wa-modal-actions">
              <button className="btn-primary" disabled={deleteBusy} onClick={() => void deleteMessage('everyone')}>Herkesten sil</button>
              <button className="btn-ghost" disabled={deleteBusy} onClick={() => void deleteMessage('me')}>Benden sil</button>
              <button className="btn-ghost" onClick={() => setDeleteChooserOpen(false)}>İptal</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Clear-chat confirmation. */}
      {clearConfirmOpen ? (
        <div className="wa-modal-overlay" onClick={() => setClearConfirmOpen(false)}>
          <div className="wa-modal wa-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="wa-modal-head">
              <h3><Eraser size={16} /> Sohbeti temizle</h3>
              <button className="wa-icon-btn" onClick={() => setClearConfirmOpen(false)}><X size={15} /></button>
            </div>
            <p className="helper" style={{ margin: '0 0 0.75rem' }}>Bu sohbetin <b>tüm yerel geçmişi</b> cihazda silinecek. Bu işlem geri alınamaz. Emin misiniz?</p>
            <div className="wa-modal-actions">
              <button className="btn-primary" disabled={clearBusy} onClick={() => void clearChat()}>Temizle</button>
              <button className="btn-ghost" onClick={() => setClearConfirmOpen(false)}>İptal</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Send-media modal (URL + caption). */}
      {mediaOpen ? (
        <div className="wa-modal-overlay" onClick={() => setMediaOpen(false)}>
          <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wa-modal-head">
              <h3><Paperclip size={16} /> Medya gönder</h3>
              <button className="wa-icon-btn" onClick={() => setMediaOpen(false)}><X size={15} /></button>
            </div>
            <p className="helper" style={{ margin: '0 0 0.5rem' }}>Bir görsel/dosya bağlantısı girin. Cihaz medyayı indirip WhatsApp'tan gönderir.</p>
            <input className="field-input" placeholder="https://…/foto.jpg" value={mediaUrl} autoFocus
              onChange={(e) => setMediaUrl(e.target.value)} />
            <input className="field-input" style={{ marginTop: '0.5rem' }} placeholder="Açıklama (opsiyonel)" value={mediaCaption}
              onChange={(e) => setMediaCaption(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendMedia(); }} />
            <div className="wa-modal-actions" style={{ marginTop: '0.75rem' }}>
              <button className="btn-primary" disabled={mediaBusy || !mediaUrl.trim()} onClick={() => void sendMedia()}>{mediaBusy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Gönder</button>
              <button className="btn-ghost" onClick={() => setMediaOpen(false)}>İptal</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Kendi numaram — job-poll result. */}
      {myNumberOpen ? (
        <div className="wa-modal-overlay" onClick={() => setMyNumberOpen(false)}>
          <div className="wa-modal wa-modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="wa-modal-head">
              <h3><Phone size={16} /> Kendi numaram</h3>
              <button className="wa-icon-btn" onClick={() => setMyNumberOpen(false)}><X size={15} /></button>
            </div>
            <p className="helper" style={{ margin: '0 0 0.5rem' }}>Cihaz: <b>{device?.name ?? '—'}</b></p>
            {myNumber ? (
              <p className="mono" style={{ fontSize: '1.15rem', margin: '0.5rem 0' }}>{myNumber}</p>
            ) : (
              <p className="helper wa-notice" style={{ margin: '0.25rem 0' }}>{myNumberBusy || myNumberNotice ? <Loader2 size={13} className="spin" /> : null} {myNumberNotice ?? 'Okunuyor…'}</p>
            )}
            <div className="wa-modal-actions" style={{ marginTop: '0.5rem' }}>
              <button className="btn-ghost btn-xs" disabled={myNumberBusy} onClick={() => void loadMyNumber()}>{myNumberBusy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Yenile</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── label assignment dropdown ──
function LabelMenu({ conv, labels, onToggle }: { conv: Conversation; labels: Label[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (!open) return; const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc); }, [open]);
  return (
    <div className="wa-label-menu" ref={ref}>
      <button className={`wa-icon-btn ${conv.labelIds.length ? 'on' : ''}`} title="Etiketle" onClick={() => setOpen((v) => !v)}><Tag size={16} /></button>
      {open ? (
        <div className="wa-label-dropdown">
          {labels.length === 0 ? <p className="helper" style={{ padding: '0.4rem 0.6rem', margin: 0 }}>Önce etiket oluşturun.</p>
            : labels.map((l) => { const st = LABEL_STYLE[l.color] ?? LABEL_STYLE.slate!; const on = conv.labelIds.includes(l.id); return (<button key={l.id} className="wa-label-opt" onClick={() => onToggle(l.id)}><span className="wa-label-dot" style={{ background: st.dot }} /><span style={{ flex: 1, textAlign: 'left' }}>{l.name}</span>{on ? <Check size={13} /> : null}</button>); })}
        </div>
      ) : null}
    </div>
  );
}

// ── forward modal ──
function ForwardModal({ msg, conversations, onClose, onForward }: { msg: ThreadMessage; conversations: Conversation[]; onClose: () => void; onForward: (peer: string) => void }) {
  const [q, setQ] = useState('');
  const list = conversations.filter((c) => convTitle(c).toLowerCase().includes(q.toLowerCase()) || c.peer.includes(q)).slice(0, 30);
  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-head"><Forward size={16} /> İlet <button className="wa-icon-btn" onClick={onClose}><X size={15} /></button></div>
        <div className="wa-modal-quote">{msg.body.slice(0, 120)}</div>
        <input className="field-input" placeholder="Kişi ara…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="wa-modal-list">
          {list.map((c) => <button key={c.id} className="wa-modal-item" onClick={() => onForward(c.peer)}><div className="wa-avatar">{initials(c.peer, c.displayName)}</div><span>{convTitle(c)}</span></button>)}
        </div>
      </div>
    </div>
  );
}

// ── broadcast modal ──
function BroadcastModal({ deviceId, labels, preselected, onClose, onDone }: { deviceId: string; labels: Label[]; preselected: string[]; onClose: () => void; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const [labelId, setLabelId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function launch() {
    if (!message.trim() || (!preselected.length && !labelId)) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch('/api/whatsapp/broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, message: message.trim(), ...(preselected.length ? { peers: preselected } : {}), ...(labelId ? { labelId } : {}) }) });
      const j = await r.json();
      if (r.ok) { setResult(`${j?.data?.total ?? 0} kişiye sıraya alındı (aralıklı gönderiliyor).`); setTimeout(onDone, 1800); }
      else setResult(`Hata: ${j?.error?.message ?? r.status}`);
    } catch { setResult('Ağ hatası'); } finally { setBusy(false); }
  }
  return (
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wa-modal-head"><Megaphone size={16} /> Toplu Mesaj <button className="wa-icon-btn" onClick={onClose}><X size={15} /></button></div>
        <p className="helper" style={{ margin: '0 0 0.5rem' }}>{preselected.length ? `${preselected.length} seçili kişiye` : 'Bir etikete'} gönderilir. Ban riskini azaltmak için aralıklı (6–20sn) gönderilir.</p>
        {!preselected.length ? (
          <label className="field"><span>Etiket (hedef grup)</span>
            <select className="field-input" value={labelId} onChange={(e) => setLabelId(e.target.value)}>
              <option value="">Seçin…</option>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field"><span>Mesaj</span><textarea className="field-input" rows={4} placeholder="Herkese gidecek mesaj…" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <button className="btn-primary btn-sm" disabled={busy || !message.trim() || (!preselected.length && !labelId)} onClick={() => void launch()}>{busy ? <Loader2 size={14} className="spin" /> : <Megaphone size={14} />} Gönder</button>
        {result ? <p className="helper" style={{ marginTop: '0.5rem' }}>{result}</p> : null}
      </div>
    </div>
  );
}

// ── canned reply manager (collapsible) ──
function CannedManager({ canned, onChange }: { canned: Canned[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  async function add() {
    if (!title.trim() || !text.trim()) return;
    const r = await fetch('/api/whatsapp/canned', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim(), body: text.trim() }) }).catch(() => null);
    if (r?.ok) { setTitle(''); setText(''); onChange(); }
  }
  async function del(id: string) { await fetch(`/api/whatsapp/canned/${id}`, { method: 'DELETE' }).catch(() => undefined); onChange(); }
  return (
    <div className="wa-reg-panel">
      <button className="wa-reg-toggle" onClick={() => setOpen((v) => !v)}><Zap size={14} /> Hazır Cevaplar ({canned.length})<ChevronDown size={14} className={`wa-reg-chevron ${open ? 'up' : ''}`} /></button>
      {open ? (
        <div className="wa-reg-body">
          <div className="wa-canned-add">
            <input className="field-input" placeholder="Başlık (ör. Selamlama)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            <input className="field-input" placeholder="Mesaj metni" value={text} onChange={(e) => setText(e.target.value)} maxLength={4096} />
            <button className="btn-primary btn-xs" onClick={() => void add()} disabled={!title.trim() || !text.trim()}><Plus size={12} /> Ekle</button>
          </div>
          {canned.length ? (
            <div className="wa-canned-list">
              {canned.map((c) => <div key={c.id} className="wa-canned-mitem"><div><b>{c.title}</b><span>{c.body.slice(0, 80)}</span></div><button className="wa-icon-btn" onClick={() => void del(c.id)}><X size={14} /></button></div>)}
            </div>
          ) : <p className="helper" style={{ margin: '0.5rem 0 0' }}>Sık kullandığınız yanıtları ekleyin; sohbet yazarken tek tıkla ekleyin.</p>}
        </div>
      ) : null}
    </div>
  );
}

// ── operator-OTP registration (compact) ──
function RegisterPanel({ deviceId, deviceName, onRegistered }: { deviceId: string; deviceName: string; onRegistered: () => void }) {
  const [open, setOpen] = useState(false);
  const [regPhone, setRegPhone] = useState('');
  const [regAccount, setRegAccount] = useState<RegAccount | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regErr, setRegErr] = useState<string | null>(null);
  const [otp, setOtp] = useState('');

  useEffect(() => {
    const acc = regAccount;
    if (!acc || acc.status === 'ACTIVE' || acc.status === 'FAILED') return;
    const t = setInterval(async () => {
      try { const res = await fetch(`/api/accounts/batch/accounts/${acc.id}`); const json = await res.json(); if (json?.data) setRegAccount(json.data as RegAccount); } catch {}
    }, REG_POLL_MS);
    return () => clearInterval(t);
  }, [regAccount]);
  useEffect(() => { if (regAccount?.status === 'ACTIVE') onRegistered(); }, [regAccount?.status, onRegistered]);

  async function startRegister() {
    if (!deviceId || !regPhone.trim()) { setRegErr('Cihaz ve numara gerekli'); return; }
    setRegBusy(true); setRegErr(null); setOtp('');
    try {
      const res = await fetch('/api/accounts/whatsapp/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, phoneNumber: regPhone.trim() }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.data?.message ?? json?.error?.message ?? 'Kayıt başlatılamadı');
      setRegAccount(json.data as RegAccount);
    } catch (e) { setRegErr(e instanceof Error ? e.message : 'Hata'); } finally { setRegBusy(false); }
  }
  async function submitOtp() {
    const acc = regAccount; if (!acc || !otp.trim()) { setRegErr('OTP kodu gerekli'); return; }
    setRegBusy(true); setRegErr(null);
    try {
      const res = await fetch(`/api/accounts/whatsapp/register/${acc.id}/otp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ otpCode: otp.trim() }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.data?.message ?? json?.error?.message ?? 'OTP gönderilemedi');
      setRegAccount(json.data as RegAccount); setOtp('');
    } catch (e) { setRegErr(e instanceof Error ? e.message : 'Hata'); } finally { setRegBusy(false); }
  }
  function reset() { setRegAccount(null); setRegPhone(''); setOtp(''); setRegErr(null); }
  const regState = regAccount ? REG_STATUS[regAccount.status] : null;

  return (
    <div className="wa-reg-panel">
      <button className="wa-reg-toggle" onClick={() => setOpen((v) => !v)}><UserPlus size={14} /> WhatsApp Hesap Aç<ChevronDown size={14} className={`wa-reg-chevron ${open ? 'up' : ''}`} /></button>
      {open ? (
        <div className="wa-reg-body">
          {!regAccount ? (
            <div className="wa-register-row">
              <label className="field" style={{ flex: 1 }}><span>Telefon numarası (ülke kodu ile) — cihaz: <span className="mono">{deviceName}</span></span>
                <input className="field-input" placeholder="905551112233" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} inputMode="tel" /></label>
              <button className="btn-primary" style={{ alignSelf: 'flex-end' }} disabled={!deviceId || !regPhone.trim() || regBusy} onClick={() => void startRegister()}>{regBusy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} {regBusy ? 'Başlatılıyor…' : 'Kayıt Başlat'}</button>
            </div>
          ) : (
            <div className="wa-register">
              <div className="wa-register-status">
                <span className={`wa-reg-badge wa-reg-${regState?.tone ?? 'busy'}`}>
                  {regState?.tone === 'ok' ? <CheckCircle2 size={14} /> : regState?.tone === 'fail' ? <XCircle size={14} /> : regState?.tone === 'otp' ? <KeyRound size={14} /> : <Loader2 size={14} className="spin" />}
                  {regState?.label ?? regAccount.status}
                </span>
                <span className="mono" style={{ opacity: 0.7 }}>{regAccount.phoneNumber}</span>
                {regAccount.fullName ? <span style={{ opacity: 0.7 }}>· {regAccount.fullName}</span> : null}
                <button className="btn-ghost btn-xs" style={{ marginLeft: 'auto' }} onClick={reset}>Yeni kayıt</button>
              </div>
              {regAccount.status === 'AWAITING_OTP' ? (
                <div className="wa-register-row" style={{ marginTop: '0.7rem' }}>
                  <label className="field" style={{ flex: 1 }}><span>Gelen OTP kodu</span><input className="field-input mono" placeholder="123456" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={8} /></label>
                  <button className="btn-primary" style={{ alignSelf: 'flex-end' }} disabled={!otp.trim() || regBusy} onClick={() => void submitOtp()}>{regBusy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {regBusy ? 'Gönderiliyor…' : 'OTP Gönder'}</button>
                </div>
              ) : null}
              {regAccount.status === 'FAILED' ? <p className="helper" style={{ color: 'var(--danger, #f87171)', marginTop: '0.5rem' }}>Kayıt başarısız: {regAccount.error ?? 'bilinmeyen hata'}</p> : null}
            </div>
          )}
          {regErr ? <p className="helper" style={{ color: 'var(--danger, #f87171)', marginTop: '0.5rem' }}>{regErr}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
