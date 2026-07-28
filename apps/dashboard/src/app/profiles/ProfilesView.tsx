'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useFleetEvents } from '../../lib/live';
import Link from 'next/link';
import {
  Smartphone,
  Search,
  Plus,
  LayoutGrid,
  List,
  CheckSquare,
  Activity,
  Wifi,
  Cpu,
  MemoryStick,
  MapPin,
  Fingerprint,
  Server,
  Layers,
  Hash,
  Globe,
  Power,
  RefreshCw,
  Trash2,
  FolderInput,
  Network,
  Package,
  Send,
  Zap,
  MessageCircle,
  Camera,
  Shuffle,
  Loader2,
  Check,
  AlertTriangle,
  ShieldCheck,
  Pencil,
  X
} from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, HoloTabs, Holo3D, Reveal } from '../../components/hud';
import ProvisionModal, { type ProvisionStep } from './ProvisionModal';
import WhatsappRegisterModal, { type WaStep } from './WhatsappRegisterModal';
import InstagramRegisterModal, { type IgStep } from './InstagramRegisterModal';
import DeviceProxyModal from './DeviceProxyModal';

// Step plan for reopening the WA panel from the card badge (mirrors the API's
// WA_REGISTER_STEPS). The modal also refetches these via getStatus on mount.
const WA_REGISTER_STEPS_CLIENT: WaStep[] = [
  { key: 'queued', label: 'Kuyruğa alındı', percent: 3 },
  { key: 'proxy', label: 'Ülke proxy\'si atanıyor (numaraya göre)', percent: 6 },
  { key: 'perms', label: 'İzinler veriliyor', percent: 8 },
  { key: 'a11y', label: 'Erişilebilirlik + klavye', percent: 15 },
  { key: 'launch', label: 'WhatsApp açılıyor', percent: 25 },
  { key: 'eula', label: 'EULA / uyarılar', percent: 35 },
  { key: 'register', label: 'Yeni hesap kaydı (⋮ menü)', percent: 50 },
  { key: 'number', label: 'Numara giriliyor', percent: 62 },
  { key: 'submit', label: 'Numara onayı (Next → Yes)', percent: 72 },
  { key: 'verify', label: 'Doğrulama yöntemi (SMS)', percent: 80 },
  { key: 'otp_wait', label: 'SMS kodu bekleniyor', percent: 85 },
  { key: 'otp', label: 'SMS kodu giriliyor', percent: 90 },
  { key: 'profile', label: 'Profil ismi', percent: 96 },
  { key: 'done', label: 'Kayıt tamamlandı (sohbet ekranı)', percent: 100 }
];

// Step plan for reopening the Instagram panel from the card badge (mirrors the
// API's IG_REGISTER_STEPS). The modal refetches these via getStatus on mount.
const IG_REGISTER_STEPS_CLIENT: IgStep[] = [
  { key: 'queued', label: 'Kuyruğa alındı', percent: 3 },
  { key: 'perms', label: 'İzinler veriliyor', percent: 8 },
  { key: 'launch', label: 'Instagram açılıyor', percent: 18 },
  { key: 'signup', label: 'E-posta ile kayıt', percent: 28 },
  { key: 'email', label: 'E-posta giriliyor', percent: 38 },
  { key: 'code_wait', label: 'Doğrulama kodu bekleniyor (e-posta)', percent: 48 },
  { key: 'code', label: 'Kod giriliyor', percent: 56 },
  { key: 'password', label: 'Şifre oluşturuluyor', percent: 64 },
  { key: 'birthday', label: 'Doğum tarihi', percent: 72 },
  { key: 'name', label: 'İsim giriliyor', percent: 80 },
  { key: 'username', label: 'Kullanıcı adı', percent: 88 },
  { key: 'terms', label: 'Şartlar kabul (hesap oluşturuluyor)', percent: 94 },
  { key: 'done', label: 'Hesap oluşturuldu', percent: 100 },
  { key: 'wall', label: 'Doğrulama duvarı (captcha/SMS)', percent: 100 }
];

export type ProvisioningModel = { model: string; manufacturer: string; brand: string; resolution: string; dpi: number; osVersions: string[] };
export type ProvisioningCatalog = { models: ProvisioningModel[]; ramTiers: number[]; cpuTiers: number[] };

export type DeviceGroup = {
  id: string;
  name: string;
};

export type DeviceFingerprint = {
  imei: string;
  androidId: string;
  serialNo: string;
  macAddress: string;
  manufacturer: string;
  model: string;
  brand: string;
  osVersion: string;
  buildNumber: string;
  resolution: string;
  dpi: number;
  carrier: string;
  mcc: string;
  mnc: string;
  phoneNumber: string | null;
  language: string;
  country: string;
  countryCode: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  gpsEnabled: boolean;
};

export type DeviceProfile = {
  id: string;
  uuid: string;
  name: string;
  status: string;
  ipAddress: string | null;
  adbPort: number | null;
  androidVersion: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  lastSeen: string | null;
  group?: { id: string; name: string } | null;
  metadata?: Record<string, unknown> | null;
  fingerprint?: DeviceFingerprint | null;
  tags?: string[];
  proxyId?: string | null;
  protected?: boolean; // device is lock-protected (delete/reset/restore rejected)
  // ★DATA-LOSS GUARD: device already holds a live WhatsApp account (a new registration
  // would pm-clear/wipe it). Populated by the list API from an ACTIVE whatsapp account.
  hasActiveWhatsapp?: boolean;
  activeWhatsappPhone?: string | null;
  // WhatsApp account HEALTH badge: null when healthy/absent, else a trouble state
  // detected on-device (send result or inbound system notice).
  waAccountHealth?: 'RESTRICTED' | 'BANNED' | 'LOGGED_OUT' | null;
};

export type Country = { countryCode: string; country: string; timezone: string };
export type ProxyOption = { id: string; label: string; host: string; port: number; type: string };
export type AppOption = { id: string; name: string; packageName: string; version: string; apkUrl: string | null };

// Compact fingerprint of the fields a profile card actually renders, so the 5s
// poll can short-circuit when nothing visible changed and avoid re-rendering the
// whole grid. Covers status/name/network/group/tags + the WA/IG register badges
// (which live in metadata) — the only per-device values the card reads live.
function deviceFingerprint(d: DeviceProfile): string {
  const m = d.metadata ?? {};
  return [
    d.id, d.status, d.name, d.ipAddress ?? '', d.adbPort ?? '', d.group?.id ?? '',
    (d.tags ?? []).join(','),
    m.provisionStatus ?? '', m.waRegisterStatus ?? '', m.igRegisterStatus ?? '',
    // Card also renders the durable WA number + protected lock — poll must re-render
    // when either changes (e.g. a registration just completed, or the lock toggled).
    m.waRegisteredPhone ?? '', d.protected ? '1' : '0',
    // WA account-health badge — re-render when a ban/restriction/logout is detected.
    d.waAccountHealth ?? ''
  ].join('|');
}

// True when two device lists render identically (same order, same visible fields).
// A fresh array reference from the poll with identical data returns true → skip.
function sameDeviceList(a: DeviceProfile[], b: DeviceProfile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (deviceFingerprint(a[i]!) !== deviceFingerprint(b[i]!)) return false;
  }
  return true;
}

type ViewMode = 'card' | 'list';

// CPU pressure payload from GET /provision/cpu-pressure.
type CpuSleepable = { id: string; name: string; instance: string };
type CpuPressureHost = {
  id: string; name: string; status: string;
  loadAvg1m: number | null; cpuCores: number | null; saturationPct: number | null;
  runningPhones: number; sleepable: CpuSleepable[];
};
type CpuPressure = { hot: boolean; hosts: CpuPressureHost[] };

const STATUS_LABEL: Record<string, string> = {
  ONLINE: 'Çalışıyor',
  OFFLINE: 'Durduruldu',
  STARTING: 'Başlatılıyor',
  STOPPING: 'Durduruluyor',
  ERROR: 'Hata',
  UPDATING: 'Güncelleniyor',
  REBOOTING: 'Yeniden başlatılıyor'
};

function statusClass(status: string): string {
  switch (status) {
    case 'ONLINE':
      return 'dot dot-online';
    case 'ERROR':
      return 'dot dot-error';
    case 'STARTING':
    case 'STOPPING':
    case 'UPDATING':
    case 'REBOOTING':
      return 'dot dot-busy';
    default:
      return 'dot dot-offline';
  }
}

function flag(metadata?: Record<string, unknown> | null): string {
  const country = (metadata?.country as string) || (metadata?.region as string) || '';
  return country || 'Küresel';
}

// The country that actually matters for WhatsApp/Instagram: the proxy EXIT country
// (real traffic origin), not the fingerprint's cosmetic country. `metadata.proxyCountry`
// is set by auto-proxy when a country-matched exit is attached. Returns the exit
// country code (e.g. "TR") when present, else null so callers fall back to fingerprint.
function proxyExitCountry(metadata?: Record<string, unknown> | null): string | null {
  const pc = (metadata?.proxyCountry as string) || '';
  return pc.trim() ? pc.trim().toUpperCase() : null;
}

const BULK_ACTIONS = ['Başlat', 'Kapat', 'Yeniden başlat', 'Taşı', 'Proxy ata', 'Uygulama yükle', 'Dosya gönder', 'Sil'] as const;

const BULK_ICONS: Record<string, ReactNode> = {
  'Başlat': <Power size={13} />,
  'Kapat': <Power size={13} />,
  'Yeniden başlat': <RefreshCw size={13} />,
  'Taşı': <FolderInput size={13} />,
  'Proxy ata': <Network size={13} />,
  'Uygulama yükle': <Package size={13} />,
  'Dosya gönder': <Send size={13} />,
  'Sil': <Trash2 size={13} />
};

export function ProfilesView({
  devices: initialDevices,
  groups,
  countries = [],
  proxies = [],
  apps = []
}: {
  devices: DeviceProfile[];
  groups: DeviceGroup[];
  countries?: Country[];
  proxies?: ProxyOption[];
  apps?: AppOption[];
}) {
  const router = useRouter();
  // Live device list: seeded from the server render. Real-time changes arrive over the
  // WebSocket (useFleetEvents → device/job/alert events), so this poll is only a
  // safety-net reconcile at 20s (was 5s — 4× less server load + traffic on big fleets).
  const [devices, setDevices] = useState<DeviceProfile[]>(initialDevices);
  useEffect(() => { setDevices(initialDevices); }, [initialDevices]);

  // ★2026-07-28 CANLI LISTE: cihaz listesi SADECE 20s'lik yoklamayla guncelleniyordu —
  // yeni kurulan cihaz listeye ANINDA dusmuyordu (operator: "sayfayi yenileyince
  // goruyorum"). WS altyapisi ve olaylar (device.created/updated/deleted,
  // provision.progress) ZATEN vardi; bu bilesen yalnizca ABONE DEGILDI (useFleetEvents
  // dosyada sadece YORUMDA geciyordu). Simdi olaya aninda tepki verir; 20s yoklama
  // guvenlik agi olarak kalir. Olay firtinasina karsi 400ms debounce.
  const refreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/devices', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const next = (json?.data ?? null) as DeviceProfile[] | null;
      if (!Array.isArray(next)) return;
      setDevices((prev) => (sameDeviceList(prev, next) ? prev : next));
    } catch { /* keep last good list */ }
  }, []);
  useFleetEvents(
    ['device.created', 'device.updated', 'device.deleted', 'provision.progress'],
    () => {
      if (refreshRef.current) clearTimeout(refreshRef.current);
      refreshRef.current = setTimeout(() => { void fetchDevices(); }, 400);
    }
  );
  useEffect(() => () => { if (refreshRef.current) clearTimeout(refreshRef.current); }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // Skip polling while the tab is hidden — no point refreshing an unseen list.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/devices', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const next = (json?.data ?? null) as DeviceProfile[] | null;
        if (!alive || !Array.isArray(next)) return;
        // Skip the state update (and the whole-grid re-render it triggers) when the
        // poll returns a list that is materially unchanged from what we already show.
        // Cheap identity+status+meta fingerprint — avoids re-rendering every card
        // every 5s just because a new array reference arrived with identical data.
        setDevices((prev) => (sameDeviceList(prev, next) ? prev : next));
      } catch { /* keep last good list */ }
    };
    const id = setInterval(tick, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Poll host CPU pressure so the "CPU yüksek — boşta cihazları uyut?" banner
  // appears/clears live as load rises and falls.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/provision/cpu-pressure', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (alive && json?.data) setCpuPressure(json.data as CpuPressure);
      } catch { /* keep last */ }
    };
    void tick();
    const id = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('card');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', androidVersion: '12', countryCode: 'US', deviceModel: '', ramGb: '6', cpuCores: '8', count: '1' });
  // Optional pre-provision dialog to capture a WhatsApp number (semi-autonomous
  // register on the fresh device). Blank number → device-only provision.
  const [provisionFormOpen, setProvisionFormOpen] = useState(false);
  // One-click provisioning: builds a brand-new isolated Waydroid instance from
  // scratch and shows a live step-by-step wizard.
  const [provisioning, setProvisioning] = useState<{ jobId: string; deviceId: string; instance: string; name?: string; steps: ProvisionStep[] } | null>(null);
  const [provisionBusy, setProvisionBusy] = useState(false);
  // Provisioning catalog (device models + hardware tiers), lazy-loaded.
  const [catalog, setCatalog] = useState<ProvisioningCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveGroup, setMoveGroup] = useState('');
  const [newGroup, setNewGroup] = useState('');
  // Fingerprint / GPS detail modal.
  const [fpDevice, setFpDevice] = useState<DeviceProfile | null>(null);
  const [gpsForm, setGpsForm] = useState({ gpsEnabled: false, latitude: '', longitude: '', countryCode: '' });
  const [fpBusy, setFpBusy] = useState(false);
  const [fpApplyMsg, setFpApplyMsg] = useState<string | null>(null);
  // Bulk file push modal.
  const [pushOpen, setPushOpen] = useState(false);
  const [pushForm, setPushForm] = useState({ url: '', fileName: '', destination: 'gallery' });
  // Bulk assign-proxy modal.
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxyChoice, setProxyChoice] = useState('');
  // Bulk install-app modal.
  const [appOpen, setAppOpen] = useState(false);
  const [appChoice, setAppChoice] = useState('');
  // "Tek Tık WhatsApp" — open WhatsApp registration on ONE device. Separate from
  // provisioning: pick a ready device, enter a number, the agent drives to the OTP
  // screen and stops (operator enters the SMS code on the /whatsapp page).
  const [waOpen, setWaOpen] = useState<DeviceProfile | null>(null);
  const [waPhone, setWaPhone] = useState('');
  // Optional operator-chosen profile name. Left blank → the backend auto-generates a
  // random identity name (previous behavior). Filled → the agent types exactly this.
  const [waName, setWaName] = useState('');
  // ★DATA-LOSS GUARD: when the device already has a live WhatsApp account, the operator
  // must tick this to confirm they understand a new registration WIPES it.
  const [waOverwriteOk, setWaOverwriteOk] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);
  // Live WhatsApp-registration panel (opens after "Başlat"), like `provisioning`.
  const [waRegistering, setWaRegistering] = useState<{ accountId: string; deviceId: string; phoneNumber: string; steps: WaStep[]; proxyCountry?: string | null } | null>(null);
  // "Tek Tık Instagram" — open Instagram registration on ONE device. Email-based
  // and fully autonomous (agent reads the email code). igOpen = confirm dialog;
  // igRegistering = the live progress panel.
  const [igOpen, setIgOpen] = useState<DeviceProfile | null>(null);
  const [igBusy, setIgBusy] = useState(false);
  const [igMsg, setIgMsg] = useState<string | null>(null);
  const [igRegistering, setIgRegistering] = useState<{ accountId: string; deviceId: string; email: string; steps: IgStep[] } | null>(null);
  // One-click identity reroll: per-device in-flight flag + toast.
  const [rerollBusy, setRerollBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  // Inline device rename: which device is being renamed + its draft name.
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  // Persist a device rename. Name is a cosmetic label only — the Waydroid instance,
  // WhatsApp account, proxy and all bindings are keyed by id/instance, NOT the name,
  // so renaming is always safe. Optimistically updates the card, then PUTs to the API.
  async function saveRename(id: string, rawName: string) {
    const name = rawName.trim();
    const dev = devices.find((d) => d.id === id);
    if (!name || name.length < 2 || renameBusy || name === dev?.name) { setRenaming(null); return; }
    setRenameBusy(true);
    // Optimistic: show the new name immediately.
    setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) {
        // Roll back the optimistic change on failure.
        setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, name: dev?.name ?? d.name } : d)));
        setToast({ kind: 'err', text: 'İsim değiştirilemedi' });
      } else {
        setToast({ kind: 'ok', text: `İsim değiştirildi → ${name}` });
      }
    } catch {
      setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, name: dev?.name ?? d.name } : d)));
      setToast({ kind: 'err', text: 'İsim değiştirilemedi (ağ hatası)' });
    } finally {
      setRenameBusy(false);
      setRenaming(null);
    }
  }
  // Per-device proxy modal (country-grouped picker + verify).
  const [proxyDevice, setProxyDevice] = useState<DeviceProfile | null>(null);
  // CPU pressure warning: software-rendered Waydroid pins the host CPU, which
  // makes the live screen crawl. When a host is "hot" we surface a banner with a
  // one-click "sleep the idle devices" action (operator-driven, never automatic).
  const [cpuPressure, setCpuPressure] = useState<CpuPressure | null>(null);
  const [sleepBusy, setSleepBusy] = useState(false);
  const [sleepMsg, setSleepMsg] = useState<string | null>(null);

  // All distinct tags across the fleet, for the quick-filter chip row.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) for (const t of d.tags ?? []) set.add(t);
    return [...set].sort();
  }, [devices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((device) => {
      const matchesGroup =
        groupId === 'all' ||
        (groupId === 'ungrouped' ? !device.group : device.group?.id === groupId);
      // Search matches name OR any tag.
      const matchesQuery = !q || device.name.toLowerCase().includes(q) || (device.tags ?? []).some((t) => t.includes(q));
      const matchesTag = !tagFilter || (device.tags ?? []).includes(tagFilter);
      return matchesGroup && matchesQuery && matchesTag;
    });
  }, [devices, groupId, query, tagFilter]);

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(() => (allSelected ? new Set() : new Set(filtered.map((d) => d.id))));
  }

  const selectionCount = selected.size;

  // Fleet telemetry derived for the HoloStat deck.
  const onlineCount = useMemo(() => devices.filter((d) => d.status === 'ONLINE').length, [devices]);
  const busyCount = useMemo(
    () => devices.filter((d) => d.status === 'STARTING' || d.status === 'UPDATING' || d.status === 'REBOOTING' || d.status === 'STOPPING').length,
    [devices]
  );
  const errorCount = useMemo(() => devices.filter((d) => d.status === 'ERROR').length, [devices]);

  // Lazy-load the provisioning catalog the first time the create modal opens.
  useEffect(() => {
    if (!createOpen || catalog) return;
    void (async () => {
      try {
        const res = await fetch('/api/devices/provisioning-catalog');
        const json = await res.json();
        if (json?.data?.models) setCatalog(json.data as ProvisioningCatalog);
      } catch { /* ignore — model picker just stays empty */ }
    })();
  }, [createOpen, catalog]);

  // Android versions available for the chosen model (or a sensible default set).
  const modelOsVersions = useMemo(() => {
    const m = catalog?.models.find((x) => x.model === form.deviceModel);
    return m?.osVersions ?? ['11', '12', '13', '14', '15'];
  }, [catalog, form.deviceModel]);

  async function createProfile() {
    if (!form.name.trim()) {
      setError('Profil adı gereklidir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          androidVersion: form.androidVersion,
          countryCode: form.countryCode,
          ...(form.deviceModel ? { deviceModel: form.deviceModel } : {}),
          ramGb: Number(form.ramGb),
          cpuCores: Number(form.cpuCores)
        })
      });
      if (!res.ok) throw new Error(`Oluşturma başarısız (${res.status})`);
      setCreateOpen(false);
      setForm({ name: '', androidVersion: '12', countryCode: 'US', deviceModel: '', ramGb: '6', cpuCores: '8', count: '1' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oluşturma başarısız');
    } finally {
      setBusy(false);
    }
  }

  function openFingerprint(device: DeviceProfile) {
    setFpDevice(device);
    setFpApplyMsg(null);
    const fp = device.fingerprint;
    setGpsForm({
      gpsEnabled: fp?.gpsEnabled ?? false,
      latitude: fp?.latitude != null ? String(fp.latitude) : '',
      longitude: fp?.longitude != null ? String(fp.longitude) : '',
      countryCode: fp?.countryCode ?? ''
    });
  }

  async function regenerateFingerprint() {
    if (!fpDevice) return;
    setFpBusy(true);
    try {
      const res = await fetch(`/api/fingerprints/${fpDevice.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gpsForm.countryCode ? { countryCode: gpsForm.countryCode } : {})
      });
      if (!res.ok) throw new Error(`Yeniden oluşturma başarısız (${res.status})`);
      setFpDevice(null);
      router.refresh();
    } finally {
      setFpBusy(false);
    }
  }

  async function saveGps() {
    if (!fpDevice) return;
    setFpBusy(true);
    try {
      const body: Record<string, unknown> = { gpsEnabled: gpsForm.gpsEnabled };
      if (gpsForm.latitude) body.latitude = Number(gpsForm.latitude);
      if (gpsForm.longitude) body.longitude = Number(gpsForm.longitude);
      if (gpsForm.countryCode) body.countryCode = gpsForm.countryCode;
      const res = await fetch(`/api/fingerprints/${fpDevice.id}/gps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`GPS güncellemesi başarısız (${res.status})`);
      setFpDevice(null);
      router.refresh();
    } finally {
      setFpBusy(false);
    }
  }

  // Quick tag editor: comma-separated. Persists to the device and updates the
  // local list immediately (optimistic) so the chips reflect the change at once.
  async function editTags(device: DeviceProfile) {
    const current = (device.tags ?? []).join(', ');
    const next = typeof window !== 'undefined' ? window.prompt('Etiketler (virgülle ayırın):', current) : null;
    if (next === null) return;
    const tags = [...new Set(next.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    try {
      const res = await fetch(`/api/devices/${device.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
      });
      if (!res.ok) throw new Error('Etiketler kaydedilemedi');
      setDevices((list) => list.map((d) => (d.id === device.id ? { ...d, tags } : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiketler kaydedilemedi');
    }
  }

  // Push the stored fingerprint onto the physical device (setprop over ADB).
  // The agent reports which props applied vs were rejected (read-only without
  // root) — we surface that honestly instead of claiming blanket success.
  async function applyFingerprintToDevice() {
    if (!fpDevice) return;
    setFpBusy(true);
    setFpApplyMsg(null);
    try {
      const res = await fetch(`/api/fingerprints/${fpDevice.id}/apply`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json?.data?.error ?? json?.data?.message) || `Uygulama başarısız (${res.status})`);
      setFpApplyMsg(`İş kuyruğa alındı (job ${String(json?.data?.jobId ?? '').slice(0, 8)}). Cihaz birkaç saniye içinde güncellenir.`);
    } catch (e) {
      setFpApplyMsg(e instanceof Error ? e.message : 'Uygulama başarısız');
    } finally {
      setFpBusy(false);
    }
  }

  async function deleteSelected() {
    if (selectionCount === 0) return;
    if (!confirm(`${selectionCount} profil silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusy(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) => fetch(`/api/devices/${id}`, { method: 'DELETE' }))
      );
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function moveSelected() {
    if (selectionCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      let groupId = moveGroup;
      if (newGroup.trim()) {
        const gRes = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newGroup.trim() })
        });
        const gJson = await gRes.json().catch(() => ({}));
        if (!gRes.ok) throw new Error(gJson?.error ?? 'Grup oluşturulamadı');
        groupId = gJson.data?.id ?? '';
      }
      if (!groupId) {
        setError('Bir grup seçin veya yeni bir grup girin.');
        setBusy(false);
        return;
      }
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/devices/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId })
          })
        )
      );
      setMoveOpen(false);
      setMoveGroup('');
      setNewGroup('');
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Taşıma başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function pushFile() {
    if (selectionCount === 0 || !pushForm.url.trim()) {
      setError('Dosya URL adresi gereklidir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/files/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceIds: Array.from(selected),
          url: pushForm.url.trim(),
          destination: pushForm.destination,
          ...(pushForm.fileName.trim() ? { fileName: pushForm.fileName.trim() } : {})
        })
      });
      if (!res.ok) throw new Error(`Gönderme başarısız (${res.status})`);
      setPushOpen(false);
      setPushForm({ url: '', fileName: '', destination: 'gallery' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gönderme başarısız');
    } finally {
      setBusy(false);
    }
  }

  // Real Waydroid lifecycle for the selection — wake/sleep/reboot per device
  // (each actually starts/stops the instance host-side, unlike EMULATOR_START).
  async function bulkLifecycle(endpoint: 'wake' | 'sleep' | 'reboot') {
    if (selectionCount === 0) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      await Promise.all(ids.map((id) => fetch(`/api/devices/${id}/${endpoint}`, { method: 'POST' }).catch(() => undefined)));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Assign one proxy to all selected devices (fires one SET_PROXY job each).
  async function assignProxy() {
    if (selectionCount === 0 || !proxyChoice) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bulk/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceIds: Array.from(selected), proxyId: proxyChoice })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Proxy atanamadı');
      }
      setProxyOpen(false);
      setProxyChoice('');
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Proxy atanamadı');
    } finally {
      setBusy(false);
    }
  }

  // Install one app on all selected devices (one INSTALL_APK job each).
  async function installApp() {
    if (selectionCount === 0 || !appChoice) return;
    const app = apps.find((a) => a.id === appChoice);
    if (!app) return;
    setBusy(true);
    try {
      const res = await fetch('/api/bulk/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceIds: Array.from(selected),
          jobType: 'EMULATOR_INSTALL_APK',
          payload: { packageName: app.packageName, apkUrl: app.apkUrl, appName: app.name }
        })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Yükleme başlatılamadı');
      }
      setAppOpen(false);
      setAppChoice('');
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yükleme başlatılamadı');
    } finally {
      setBusy(false);
    }
  }

  // Modal open/close helpers — each clears the shared `error` state so a message
  // from one modal never leaks into another (P8).
  function openCreate() {
    setError(null);
    setCreateOpen(true);
  }

  // "Tek Tık WhatsApp": start operator-OTP registration on the chosen device with
  // the given number. The agent drives to the OTP screen and stops; the operator
  // enters the SMS code from the WhatsApp page (account → AWAITING_OTP → ACTIVE).
  async function startWhatsapp() {
    if (waBusy || !waOpen) return;
    const num = waPhone.replace(/[^\d+]/g, '');
    if (num.replace(/\D/g, '').length < 6) { setWaMsg('Geçerli bir numara girin (ülke kodu dahil)'); return; }
    setWaBusy(true);
    setWaMsg(null);
    try {
      const nm = waName.trim();
      const res = await fetch('/api/accounts/whatsapp/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Only send fullName when the operator typed one — omitting it keeps the
        // backend's auto-generate behavior. force:true only when the device already has a
        // live WA account AND the operator ticked the overwrite warning (the API blocks
        // otherwise with 409 DEVICE_HAS_ACTIVE_WHATSAPP).
        body: JSON.stringify({ deviceId: waOpen.id, phoneNumber: num, ...(nm ? { fullName: nm } : {}), ...(waOpen.hasActiveWhatsapp && waOverwriteOk ? { force: true } : {}) })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaMsg(body?.data?.message || body?.error || 'WhatsApp kaydı başlatılamadı');
        return;
      }
      const d = body?.data as { accountId?: string; deviceId?: string; steps?: WaStep[]; phoneNumber?: string } | undefined;
      // Open the live step-by-step panel (accountId correlates the whole flow).
      if (d?.accountId && Array.isArray(d.steps)) {
        setWaRegistering({
          accountId: d.accountId,
          deviceId: d.deviceId || waOpen.id,
          phoneNumber: d.phoneNumber || num,
          steps: d.steps,
          // Show the real proxy exit country the number was matched to, so the operator
          // sees "TR proxy atandı ✓" right when registration starts.
          proxyCountry: proxyExitCountry(waOpen.metadata)
        });
        setWaOpen(null);
        setWaPhone('');
        setWaName('');
        setWaOverwriteOk(false);
        setWaMsg(null);
      } else {
        setWaMsg('Kayıt başladı ama panel açılamadı — WhatsApp sayfasından takip edin.');
        setTimeout(() => { setWaOpen(null); setWaPhone(''); setWaName(''); setWaMsg(null); }, 3500);
      }
    } catch {
      setWaMsg('WhatsApp kaydı başlatılamadı (ağ hatası)');
    } finally {
      setWaBusy(false);
    }
  }

  // "Tek Tık Instagram": start email-based Instagram registration on the chosen
  // device. Fully autonomous — the agent generates an identity/email/password,
  // reads the confirmation code from the email itself, and either finishes
  // (ACTIVE), hits a captcha/SMS wall (AWAITING_MANUAL, finish on the live screen)
  // or fails. No operator input needed.
  async function startInstagram() {
    if (igBusy || !igOpen) return;
    setIgBusy(true);
    setIgMsg(null);
    try {
      const res = await fetch('/api/accounts/instagram/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: igOpen.id })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIgMsg(body?.data?.message || body?.error || 'Instagram kaydı başlatılamadı');
        return;
      }
      const d = body?.data as { accountId?: string; deviceId?: string; steps?: IgStep[]; email?: string } | undefined;
      if (d?.accountId && Array.isArray(d.steps)) {
        setIgRegistering({
          accountId: d.accountId,
          deviceId: d.deviceId || igOpen.id,
          email: d.email || '',
          steps: d.steps
        });
        setIgOpen(null);
        setIgMsg(null);
      } else {
        setIgMsg('Kayıt başladı ama panel açılamadı — Hesaplar sayfasından takip edin.');
        setTimeout(() => { setIgOpen(null); setIgMsg(null); }, 3500);
      }
    } catch {
      setIgMsg('Instagram kaydı başlatılamadı (ağ hatası)');
    } finally {
      setIgBusy(false);
    }
  }

  // Auto-dismiss the toast after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // One-click identity reroll: new IMEI/serial/android_id/MAC/build, KEEPING the
  // screen/model/OS the one-click provision set up (so WhatsApp stays ready). The
  // API applies it to the device (APPLY_FINGERPRINT job) in the same call.
  async function rerollIdentity(device: DeviceProfile) {
    if (rerollBusy.has(device.id)) return;
    setRerollBusy((prev) => new Set(prev).add(device.id));
    try {
      const res = await fetch(`/api/fingerprints/${device.id}/reroll`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 DEVICE_BUSY etc. — surface the reason.
        setToast({ kind: res.status === 409 ? 'warn' : 'err', text: body?.data?.message || body?.error || 'Kimlik değiştirilemedi' });
        return;
      }
      const fp = body?.data?.fingerprint as { model?: string; manufacturer?: string } | undefined;
      setToast({ kind: 'ok', text: `Yeni kimlik uygulandı${fp?.model ? ` · ${fp.manufacturer ?? ''} ${fp.model}` : ''} — ekran/ayarlar korundu.` });
      router.refresh();
    } catch {
      setToast({ kind: 'err', text: 'Kimlik değiştirilemedi (ağ hatası)' });
    } finally {
      setRerollBusy((prev) => { const next = new Set(prev); next.delete(device.id); return next; });
    }
  }

  // Sleep every idle-candidate device on the hot hosts (operator-triggered, from
  // the CPU pressure banner). Each device gets a DEVICE_SLEEP job (wd-stop.sh);
  // freeing CPU speeds up the phones still in use. Wake is on-demand later.
  async function sleepIdleDevices() {
    if (sleepBusy || !cpuPressure) return;
    const targets = cpuPressure.hosts.filter((h) => h.saturationPct !== null && h.status === 'ONLINE')
      .flatMap((h) => h.sleepable);
    if (targets.length === 0) return;
    setSleepBusy(true);
    setSleepMsg(null);
    try {
      const results = await Promise.allSettled(
        targets.map((t) => fetch(`/api/devices/${t.id}/sleep`, { method: 'POST' }))
      );
      const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length;
      setSleepMsg(`${ok}/${targets.length} cihaz uyutuldu`);
      // Optimistically clear the banner; the next poll re-derives real state.
      setCpuPressure(null);
    } catch {
      setSleepMsg('Uyutma başarısız');
    } finally {
      setSleepBusy(false);
    }
  }
  // Tek tık: sıfırdan yeni izole Waydroid instance kur (root+vtouch+spoof+proxy+
  // APK'lar+a11y — WhatsApp-hazır). Canlı ilerleme modalını açar.
  async function startProvision() {
    if (provisionBusy) return;
    setProvisionBusy(true);
    setError(null);
    const count = Math.max(1, Math.min(20, parseInt(form.count, 10) || 1));
    const commonBody = {
      ...(form.countryCode ? { countryCode: form.countryCode, proxyCountry: form.countryCode } : {}),
      ...(form.deviceModel ? { deviceModel: form.deviceModel } : {}),
      ...(form.androidVersion ? { androidVersion: form.androidVersion } : {})
    };
    try {
      if (count > 1) {
        // Batch: create N devices, each with a unique random name + its own proxy.
        const res = await fetch('/api/provision/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            count,
            ...(form.name.trim() ? { namePrefix: form.name.trim() } : {}),
            ...commonBody
          })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.data?.message || body?.error || 'Toplu cihaz oluşturulamadı');
          return;
        }
        const d = body.data as {
          started: Array<{ jobId: string; deviceId: string; instance: string; name: string }>;
          failed: Array<{ index: number; error: string }>;
          steps: ProvisionStep[];
        };
        setCreateOpen(false);
        setProvisionFormOpen(false);
        // Summary toast: how many started, how many failed to even start.
        setToast(
          d.failed.length
            ? { kind: 'warn', text: `${d.started.length} cihaz kuruluyor · ${d.failed.length} başlatılamadı (${d.failed[0]?.error ?? ''})` }
            : { kind: 'ok', text: `${d.started.length} cihaz aynı anda kuruluyor — her biri benzersiz isim + proxy ile` }
        );
        router.refresh(); // list picks up all the new "⚡ Kuruluyor" cards
        // Open the live modal on the FIRST device so the operator can watch progress;
        // the rest provision in parallel and show as cards in the list.
        const first = d.started[0];
        if (first) {
          setProvisioning({ jobId: first.jobId, deviceId: first.deviceId, instance: first.instance, name: first.name, steps: d.steps });
        }
        return;
      }
      // Single device (count === 1).
      const res = await fetch('/api/provision/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(form.name.trim() ? { name: form.name.trim() } : {}),
          ...commonBody
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.data?.message || body?.error || 'Cihaz oluşturulamadı');
        return;
      }
      const d = body.data as { jobId: string; deviceId: string; instance: string; name?: string; steps: ProvisionStep[] };
      setCreateOpen(false);
      setProvisionFormOpen(false);
      setProvisioning({ jobId: d.jobId, deviceId: d.deviceId, instance: d.instance, ...(d.name ? { name: d.name } : {}), steps: d.steps });
    } catch {
      setError('Cihaz oluşturulamadı (ağ hatası)');
    } finally {
      setProvisionBusy(false);
    }
  }
  // "⚡ Kuruluyor" rozetine tıklandığında: devam eden kurulumun modalını geçmiş
  // logla birlikte yeniden aç (metadata.provisionJobId → status endpoint).
  async function reopenProvision(device: DeviceProfile) {
    const jobId = device.metadata?.provisionJobId as string | undefined;
    if (!jobId) return;
    const instance = (device.metadata?.instance as string) || device.name;
    let steps: ProvisionStep[] = [];
    try {
      const res = await fetch(`/api/provision/status/${jobId}`);
      const body = await res.json().catch(() => ({}));
      steps = (body?.data?.steps as ProvisionStep[]) ?? [];
    } catch {
      /* modal will still open; it fetches history itself on mount */
    }
    setProvisioning({ jobId, deviceId: device.id, instance, name: device.name, steps });
  }
  function closeCreate() {
    if (busy) return;
    setError(null);
    setCreateOpen(false);
  }
  function closeMove() {
    if (busy) return;
    setError(null);
    setMoveOpen(false);
  }
  function closePush() {
    if (busy) return;
    setError(null);
    setPushOpen(false);
  }
  function closeProxy() {
    if (busy) return;
    setError(null);
    setProxyOpen(false);
  }
  function closeApp() {
    if (busy) return;
    setError(null);
    setAppOpen(false);
  }

  function runBulk(action: string) {
    if (selectionCount === 0) return undefined;
    if (action === 'Sil') return deleteSelected();
    if (action === 'Başlat') return bulkLifecycle('wake');
    if (action === 'Kapat') return bulkLifecycle('sleep');
    if (action === 'Yeniden başlat') return bulkLifecycle('reboot');
    if (action === 'Dosya gönder') {
      setError(null);
      setPushOpen(true);
      return undefined;
    }
    if (action === 'Proxy ata') {
      setError(null);
      setProxyOpen(true);
      return undefined;
    }
    if (action === 'Uygulama yükle') {
      setError(null);
      setAppOpen(true);
      return undefined;
    }
    if (action === 'Taşı') {
      setError(null);
      setMoveOpen(true);
      return undefined;
    }
    return undefined;
  }

  return (
    <div className="profiles">
      <HoloHeader
        eyebrow="CİHAZ FİLOSU"
        title="Profiller"
        subtitle="Bulut telefon filonuzu yönetin — başlatın, taşıyın, parmak izi ve proxy atayın."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-primary" onClick={() => { setError(null); setProvisionFormOpen(true); }} disabled={provisionBusy}>
              <Zap size={15} /> {provisionBusy ? 'Başlatılıyor…' : 'Tek Tıkla Cihaz Oluştur'}
            </button>
            <button type="button" className="btn-ghost" onClick={openCreate}>
              <Plus size={15} /> Yeni profil
            </button>
          </div>
        }
      />

      {(() => {
        if (!cpuPressure?.hot) return null;
        const hotHosts = cpuPressure.hosts.filter((h) => h.status === 'ONLINE' && h.saturationPct !== null && h.saturationPct >= 1.5);
        const idleCount = hotHosts.reduce((n, h) => n + h.sleepable.length, 0);
        const peak = Math.max(...hotHosts.map((h) => h.saturationPct ?? 0));
        return (
          <div className="cpu-pressure-banner" role="alert">
            <Cpu size={18} />
            <div className="cpu-pressure-text">
              <strong>Sunucu CPU yükü yüksek</strong> (~%{Math.round(peak * 100)} doygunluk).
              {' '}Yazılım-render cihazlar CPU&apos;yu dolduruyor, canlı ekran yavaşlıyor.
              {idleCount > 0
                ? ` ${idleCount} boşta cihaz uyutularak kullanımdaki cihazlar hızlanır.`
                : ' Boşta uyutulabilir cihaz yok.'}
              {sleepMsg ? <span className="cpu-pressure-msg"> — {sleepMsg}</span> : null}
            </div>
            {idleCount > 0 ? (
              <button type="button" className="btn-primary" onClick={sleepIdleDevices} disabled={sleepBusy}>
                <Power size={14} /> {sleepBusy ? 'Uyutuluyor…' : `${idleCount} boşta cihazı uyut`}
              </button>
            ) : null}
          </div>
        );
      })()}

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="TOPLAM CİHAZ" value={<span className="mono">{devices.length}</span>} sub="Filodaki profiller" tone="cyan" icon={<Smartphone size={15} />} />
          <HoloStat label="ÇEVRİMİÇİ" value={<span className="mono">{onlineCount}</span>} sub="Aktif çalışan" tone="success" icon={<Activity size={15} />} />
          <HoloStat label="İŞLEMDE" value={<span className="mono">{busyCount}</span>} sub="Geçiş durumunda" tone="warning" icon={<RefreshCw size={15} />} />
          <HoloStat label="HATA" value={<span className="mono">{errorCount}</span>} sub="Müdahale gerekli" tone="error" icon={<Power size={15} />} />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloPanel title="Filtre ve görünüm" icon={<Search size={16} />} scan={false}
          actions={
            <HoloTabs<ViewMode>
              active={mode}
              onChange={setMode}
              tabs={[
                { key: 'card', label: 'Kart', icon: <LayoutGrid size={13} /> },
                { key: 'list', label: 'Liste', icon: <List size={13} /> }
              ]}
            />
          }
        >
          <div className="field-row">
            <label className="field">
              <span>Grup</span>
              <select className="field-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="all">Tüm gruplar</option>
                <option value="ungrouped">Grupsuz</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Ara</span>
              <input
                type="text"
                className="field-input mono"
                placeholder="Profil adı"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {allTags.length > 0 ? (
            <div className="tag-filter-row">
              <button
                type="button"
                className={tagFilter === null ? 'tag-chip active' : 'tag-chip'}
                onClick={() => setTagFilter(null)}
              >Tümü</button>
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={tagFilter === t ? 'tag-chip active' : 'tag-chip'}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                >#{t}</button>
              ))}
            </div>
          ) : null}
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.08}>
        <HoloPanel title="Toplu işlemler" icon={<CheckSquare size={16} />} scan={false}
          actions={
            <label className="status-chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="select-check" checked={allSelected} onChange={toggleAll} aria-label="Tümünü seç" />
              <span className="mono">{selectionCount > 0 ? `${selectionCount} seçili` : 'Tümünü seç'}</span>
            </label>
          }
        >
          <div className="action-buttons">
            {BULK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={action === 'Sil' ? 'btn-ghost btn-xs action-danger' : 'btn-ghost btn-xs'}
                disabled={selectionCount === 0 || busy}
                title={selectionCount === 0 ? 'Önce profilleri seçin' : action}
                onClick={() => runBulk(action)}
              >
                {BULK_ICONS[action]} {action}
              </button>
            ))}
          </div>
        </HoloPanel>
      </Reveal>

      {filtered.length === 0 ? (
        <Reveal delay={0.1}>
          <HoloPanel>
            <div className="empty-state">
              <div className="empty-art"><Smartphone size={40} /></div>
              <h3>Henüz profil yok</h3>
              <p>Başlamak için ilk bulut telefon profilinizi oluşturun.</p>
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Plus size={15} /> Yeni profil
              </button>
            </div>
          </HoloPanel>
        </Reveal>
      ) : mode === 'card' ? (
        <Reveal delay={0.1}>
          <div className="holo-grid-auto">
            <Holo3D className="holo-card create-card" max={5}>
              <button type="button" className="create-card-btn" onClick={openCreate}>
                <div className="create-art"><Plus size={28} /></div>
                <strong>Yeni bir profil oluştur</strong>
                <span className="create-cta">Oluştur</span>
              </button>
            </Holo3D>

            {filtered.map((device) => {
              const isSelected = selected.has(device.id);
              return (
                <Holo3D key={device.id} className={`holo-card profile-card${isSelected ? ' profile-card-selected' : ''}`} max={6}>
                  <div className="card-head">
                    <label className="card-check">
                      <input type="checkbox" className="select-check" checked={isSelected} onChange={() => toggle(device.id)} aria-label={`${device.name} seç`} />
                    </label>
                    <span className="card-avatar" aria-hidden title={device.fingerprint?.manufacturer ?? device.name}>
                      {(device.fingerprint?.manufacturer ?? device.name ?? '?').trim().charAt(0).toUpperCase()}
                    </span>
                    {renaming?.id === device.id ? (
                      <input
                        className="field-input card-rename-input"
                        type="text"
                        autoFocus
                        maxLength={80}
                        value={renaming.value}
                        disabled={renameBusy}
                        onChange={(e) => setRenaming({ id: device.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(device.id, renaming.value);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => saveRename(device.id, renaming.value)}
                      />
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <Link href={`/profiles/${device.id}`} className="card-title card-title-link" title={device.name}>
                          {device.name}
                        </Link>
                        <button
                          type="button"
                          className="card-rename-btn"
                          title="İsmi değiştir"
                          onClick={() => setRenaming({ id: device.id, value: device.name })}
                        >
                          <Pencil size={12} />
                        </button>
                      </span>
                    )}
                    {(device.metadata?.provisionStatus as string) === 'PROVISIONING' ? (
                      <button
                        type="button"
                        className="tag-chip tag-chip-sm"
                        style={{ marginLeft: 'auto', color: '#fbbf24', borderColor: '#fbbf2455', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={() => reopenProvision(device)}
                        title="Kurulum ilerlemesini göster"
                      >
                        <Zap size={12} /> Kuruluyor
                      </button>
                    ) : (
                      <Link href={`/profiles/${device.id}`} className="card-menu" aria-label="Cihazı aç" title="Cihazı aç">
                        ⋮
                      </Link>
                    )}
                  </div>
                  <ul className="card-meta">
                    <li>
                      <span className="meta-icon"><Hash size={13} /></span>
                      <span className="mono">{device.uuid.slice(0, 18)}</span>
                    </li>
                    <li>
                      <span className="meta-icon"><MapPin size={13} /></span>
                      {device.fingerprint?.country ?? flag(device.metadata)}
                      {device.fingerprint?.gpsEnabled ? <span className="gps-pill">GPS</span> : null}
                      {/* Real proxy exit country — what WhatsApp actually sees. Shown as a
                          distinct pill so a fingerprint/proxy mismatch is obvious at a glance. */}
                      {proxyExitCountry(device.metadata) ? (
                        <span className="proxy-country-pill" title="Gerçek proxy çıkış ülkesi (WhatsApp bunu görür)">
                          <Wifi size={10} /> {proxyExitCountry(device.metadata)} çıkış
                        </span>
                      ) : null}
                    </li>
                    <li>
                      <span className="meta-icon"><Smartphone size={13} /></span>
                      {device.fingerprint ? `${device.fingerprint.manufacturer} ${device.fingerprint.model}` : 'Parmak izi yok'}
                    </li>
                    <li>
                      <span className="meta-icon"><Cpu size={13} /></span>
                      Android {device.fingerprint?.osVersion ?? device.androidVersion ?? '—'}
                    </li>
                    <li>
                      <span className="meta-icon"><Wifi size={13} /></span>
                      {device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : 'Proxy yok'}
                    </li>
                    <li>
                      <span className="meta-icon"><Layers size={13} /></span>
                      {device.group?.name ?? 'Grupsuz'}
                    </li>
                    {/* Durable WhatsApp number bound to this device (persists after a
                        successful register). Shown only when a number is actually
                        registered, so idle cards stay clean. */}
                    {(device.metadata?.waRegisteredPhone as string) ? (
                      <li>
                        <span className="meta-icon" style={{ color: '#25d366' }}><MessageCircle size={13} /></span>
                        <span className="wa-phone-badge" title="Bu cihaza kayıtlı WhatsApp numarası">
                          +{String(device.metadata?.waRegisteredPhone).replace(/^\+/, '')}
                        </span>
                      </li>
                    ) : null}
                    {/* Protected-lock badge — shown INDEPENDENTLY of the WA number, so a
                        device the operator locked ("Koru") reads as Korumalı even when no
                        number was captured (e.g. registered via a direct/test path). */}
                    {device.protected ? (
                      <li>
                        <span className="meta-icon"><ShieldCheck size={13} /></span>
                        <span className="proxy-country-pill" title="Cihaz korumalı — silme/sıfırlama/geri-yükleme reddedilir">
                          <ShieldCheck size={10} /> Korumalı
                        </span>
                      </li>
                    ) : null}
                    {/* WhatsApp account-health badge — only for trouble states, detected
                        on-device (send result / inbound system notice). Healthy accounts
                        show nothing here. */}
                    {device.waAccountHealth ? (
                      <li>
                        <span className="meta-icon"><AlertTriangle size={13} /></span>
                        <span
                          className={`wa-health-pill wa-health-${device.waAccountHealth.toLowerCase()}`}
                          title={
                            device.waAccountHealth === 'BANNED'
                              ? 'WhatsApp hesabı yasaklı/askıda — mesaj gönderilemez'
                              : device.waAccountHealth === 'LOGGED_OUT'
                              ? 'WhatsApp oturumu kapandı — yeniden kayıt gerekli'
                              : 'WhatsApp hesabı kısıtlı/incelemede — genelde ~24s içinde düzelir'
                          }
                        >
                          <AlertTriangle size={10} />{' '}
                          {device.waAccountHealth === 'BANNED'
                            ? 'WA Yasaklı'
                            : device.waAccountHealth === 'LOGGED_OUT'
                            ? 'WA Çıkış Yapıldı'
                            : 'WA Kısıtlı'}
                        </span>
                      </li>
                    ) : null}
                  </ul>
                  <div className="card-tags">
                    {(device.tags ?? []).map((t) => (
                      <button key={t} type="button" className="tag-chip tag-chip-sm" onClick={() => setTagFilter(t)} title={`#${t} ile filtrele`}>#{t}</button>
                    ))}
                    <button type="button" className="tag-chip tag-chip-add" onClick={() => editTags(device)} title="Etiketleri düzenle">+ etiket</button>
                  </div>
                  <div className="card-foot">
                    {/* Status row — full width, its own line so it never crowds the actions. */}
                    <div className="card-status-row">
                      <span className="status-chip">
                        <span className={statusClass(device.status)} />
                        {STATUS_LABEL[device.status] ?? device.status}
                      </span>
                      {(() => {
                        const waStatus = device.metadata?.waRegisterStatus as string | undefined;
                        if (!waStatus) return null;
                        const accId = device.metadata?.waRegisterAccountId as string | undefined;
                        const label = waStatus === 'AWAITING_OTP' ? 'Kod bekleniyor' : 'WA kaydı sürüyor';
                        return (
                          <button
                            type="button"
                            className="wa-badge"
                            title="WhatsApp kayıt panelini yeniden aç"
                            onClick={() => {
                              if (!accId) return;
                              setWaRegistering({
                                accountId: accId,
                                deviceId: device.id,
                                phoneNumber: (device.metadata?.waRegisterPhone as string) || '',
                                steps: WA_REGISTER_STEPS_CLIENT,
                                proxyCountry: proxyExitCountry(device.metadata)
                              });
                            }}
                          >
                            <MessageCircle size={11} /> {label}
                          </button>
                        );
                      })()}
                      {(() => {
                        const igStatus = device.metadata?.igRegisterStatus as string | undefined;
                        if (!igStatus) return null;
                        const accId = device.metadata?.igRegisterAccountId as string | undefined;
                        return (
                          <button
                            type="button"
                            className="wa-badge"
                            title="Instagram kayıt panelini yeniden aç"
                            onClick={() => {
                              if (!accId) return;
                              setIgRegistering({
                                accountId: accId,
                                deviceId: device.id,
                                email: (device.metadata?.igRegisterEmail as string) || '',
                                steps: IG_REGISTER_STEPS_CLIENT
                              });
                            }}
                          >
                            <Camera size={11} /> IG kaydı sürüyor
                          </button>
                        );
                      })()}
                    </div>
                    {/* Action bar — three evenly sized buttons on their own aligned row. */}
                    <div className="card-actions">
                      <button type="button" className="card-action-btn" onClick={() => openFingerprint(device)} title="Parmak izi / GPS ayrıntıları">
                        <Fingerprint size={14} /> <span>Parmak izi</span>
                      </button>
                      <button
                        type="button"
                        className="card-action-btn"
                        disabled={rerollBusy.has(device.id)}
                        onClick={() => rerollIdentity(device)}
                        title="Tek tıkla yeni kimlik (IMEI/seri/MAC) — ekran ve ayarlar korunur"
                      >
                        {rerollBusy.has(device.id) ? <Loader2 size={14} className="spin" /> : <Shuffle size={14} />} <span>Kimlik</span>
                      </button>
                      <button
                        type="button"
                        className="card-action-btn"
                        title="Bu cihaza ülke-eşleşmeli proxy göm (redsocks) + doğrula"
                        onClick={() => setProxyDevice(device)}
                      >
                        <Network size={14} /> <span>Proxy</span>
                      </button>
                      <button
                        type="button"
                        className="card-action-btn card-action-wa"
                        disabled={Boolean(device.metadata?.waRegisterStatus)}
                        title="Bu cihazda WhatsApp hesabı aç (numara gir → otonom kayıt → OTP)"
                        onClick={() => { setWaOpen(device); setWaPhone(''); setWaMsg(null); }}
                      >
                        <MessageCircle size={14} /> <span>WhatsApp</span>
                      </button>
                      <button
                        type="button"
                        className="card-action-btn card-action-ig"
                        disabled={Boolean(device.metadata?.igRegisterStatus)}
                        title="Bu cihazda Instagram hesabı aç (otonom: kimlik+e-posta üret → kayıt → e-posta kodu)"
                        onClick={() => { setIgOpen(device); setIgMsg(null); }}
                      >
                        <Camera size={14} /> <span>Instagram</span>
                      </button>
                    </div>
                  </div>
                </Holo3D>
              );
            })}
          </div>
        </Reveal>
      ) : (
        <Reveal delay={0.1}>
          <HoloPanel title="Cihaz listesi" icon={<List size={16} />}>
            <div className="profile-table-wrap">
              <table className="profile-table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input type="checkbox" className="select-check" checked={allSelected} onChange={toggleAll} aria-label="Tümünü seç" />
                    </th>
                    <th>Ad</th>
                    <th>Durum</th>
                    <th>Konum</th>
                    <th>Android</th>
                    <th>IP / Port</th>
                    <th>Grup</th>
                    <th>CPU / RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((device) => {
                    const isSelected = selected.has(device.id);
                    return (
                      <tr key={device.id} className={isSelected ? 'row-selected' : ''}>
                        <td className="col-check">
                          <input type="checkbox" className="select-check" checked={isSelected} onChange={() => toggle(device.id)} aria-label={`${device.name} seç`} />
                        </td>
                        <td>
                          <strong>{device.name}</strong>
                          <div className="helper mono">{device.uuid.slice(0, 14)}</div>
                        </td>
                        <td>
                          <span className="status-chip">
                            <span className={statusClass(device.status)} />
                            {STATUS_LABEL[device.status] ?? device.status}
                          </span>
                        </td>
                        <td>{device.fingerprint?.country ?? flag(device.metadata)}</td>
                        <td>Android {device.fingerprint?.osVersion ?? device.androidVersion ?? '—'}</td>
                        <td className="mono">{device.ipAddress ? `${device.ipAddress}:${device.adbPort ?? '—'}` : '—'}</td>
                        <td>{device.group?.name ?? 'Grupsuz'}</td>
                        <td className="mono">
                          {Math.round(device.cpuUsage)}% / {Math.round(device.memoryUsage)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HoloPanel>
        </Reveal>
      )}

      <footer className="profiles-foot">
        <span className="helper mono">Toplam: {filtered.length} kayıt</span>
      </footer>

      {moveOpen ? (
        <div className="modal-overlay" onClick={closeMove}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><FolderInput size={16} /> {selectionCount} profili taşı</h2>
              <button type="button" className="modal-close" onClick={closeMove}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>Mevcut grup</span>
              <select className="field-input" value={moveGroup} onChange={(e) => setMoveGroup(e.target.value)} disabled={!!newGroup}>
                <option value="">— seçin —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Veya yeni grup oluştur</span>
              <input className="field-input" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="örn. Kampanya A" />
            </label>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeMove}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={moveSelected}>
                {busy ? 'Taşınıyor…' : 'Taşı'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="modal-overlay" onClick={closeCreate}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Plus size={16} /> Yeni profil</h2>
              <button type="button" className="modal-close" onClick={closeCreate}>
                <X size={16} />
              </button>
            </header>

            <label className="field">
              <span>Profil adı</span>
              <input
                type="text"
                className="field-input"
                placeholder="örn. Bulut telefon profili_US_04"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="field">
              <span>Cihaz modeli</span>
              <select
                className="field-input"
                value={form.deviceModel}
                onChange={(e) => setForm((f) => ({ ...f, deviceModel: e.target.value }))}
              >
                <option value="">Rastgele (otomatik)</option>
                {(catalog?.models ?? []).map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.manufacturer} {m.model} · {m.resolution}
                  </option>
                ))}
              </select>
            </label>

            <div className="field-row">
              <label className="field">
                <span>Android sürümü</span>
                <select
                  className="field-input"
                  value={form.androidVersion}
                  onChange={(e) => setForm((f) => ({ ...f, androidVersion: e.target.value }))}
                >
                  {modelOsVersions.map((v) => (
                    <option key={v} value={v}>Android {v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Konum (SIM / GPS)</span>
                <select
                  className="field-input"
                  value={form.countryCode}
                  onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value }))}
                >
                  {countries.length === 0 ? (
                    <option value="US">Amerika Birleşik Devletleri</option>
                  ) : (
                    countries.map((c) => (
                      <option key={c.countryCode} value={c.countryCode}>
                        {c.country}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>RAM</span>
                <select className="field-input" value={form.ramGb} onChange={(e) => setForm((f) => ({ ...f, ramGb: e.target.value }))}>
                  {(catalog?.ramTiers ?? [4, 6, 8, 12]).map((r) => <option key={r} value={String(r)}>{r} GB</option>)}
                </select>
              </label>
              <label className="field">
                <span>CPU çekirdek</span>
                <select className="field-input" value={form.cpuCores} onChange={(e) => setForm((f) => ({ ...f, cpuCores: e.target.value }))}>
                  {(catalog?.cpuTiers ?? [4, 6, 8]).map((c) => <option key={c} value={String(c)}>{c} çekirdek</option>)}
                </select>
              </label>
            </div>

            <p className="helper">
              Seçilen modele uygun benzersiz bir cihaz parmak izi (IMEI, operatör, MAC, çözünürlük) otomatik oluşturulur. Model boş bırakılırsa rastgele seçilir.
            </p>

            {error ? <p className="field-error">{error}</p> : null}

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeCreate}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={createProfile}>
                {busy ? 'Oluşturuluyor…' : 'Profil oluştur'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {fpDevice ? (
        <div className="modal-overlay" onClick={() => !fpBusy && setFpDevice(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Fingerprint size={16} /> Cihaz parmak izi — {fpDevice.name}</h2>
              <button type="button" className="modal-close" onClick={() => !fpBusy && setFpDevice(null)}>
                <X size={16} />
              </button>
            </header>

            {fpDevice.fingerprint ? (
              <div className="fp-grid">
                <FpRow label="Cihaz" value={`${fpDevice.fingerprint.manufacturer} ${fpDevice.fingerprint.model}`} />
                <FpRow label="OS / Yapı" value={`Android ${fpDevice.fingerprint.osVersion} · ${fpDevice.fingerprint.buildNumber}`} />
                <FpRow label="IMEI" value={fpDevice.fingerprint.imei} mono />
                <FpRow label="Android ID" value={fpDevice.fingerprint.androidId} mono />
                <FpRow label="Seri No" value={fpDevice.fingerprint.serialNo} mono />
                <FpRow label="MAC" value={fpDevice.fingerprint.macAddress} mono />
                <FpRow label="Çözünürlük" value={`${fpDevice.fingerprint.resolution} @ ${fpDevice.fingerprint.dpi}dpi`} />
                <FpRow label="Operatör" value={`${fpDevice.fingerprint.carrier} (${fpDevice.fingerprint.mcc}/${fpDevice.fingerprint.mnc})`} />
                <FpRow label="Telefon" value={fpDevice.fingerprint.phoneNumber ?? '—'} mono />
                <FpRow label="Yerel ayar" value={`${fpDevice.fingerprint.country} · ${fpDevice.fingerprint.language} · ${fpDevice.fingerprint.timezone}`} />
              </div>
            ) : (
              <p className="helper">Henüz parmak izi yok — oluşturmak için yeniden üretin.</p>
            )}

            <div className="modal-section">
              <h3><MapPin size={14} /> GPS / SIM simülasyonu</h3>
              <label className="field-check">
                <input
                  type="checkbox"
                  className="admin-switch"
                  checked={gpsForm.gpsEnabled}
                  onChange={(e) => setGpsForm((g) => ({ ...g, gpsEnabled: e.target.checked }))}
                />
                <span>GPS sahteciliğini etkinleştir</span>
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Enlem</span>
                  <input
                    className="field-input"
                    value={gpsForm.latitude}
                    onChange={(e) => setGpsForm((g) => ({ ...g, latitude: e.target.value }))}
                    placeholder="e.g. 41.0082"
                  />
                </label>
                <label className="field">
                  <span>Boylam</span>
                  <input
                    className="field-input"
                    value={gpsForm.longitude}
                    onChange={(e) => setGpsForm((g) => ({ ...g, longitude: e.target.value }))}
                    placeholder="e.g. 28.9784"
                  />
                </label>
              </div>
              <label className="field">
                <span>Ülke (SIM + saat dilimini günceller)</span>
                <select
                  className="field-input"
                  value={gpsForm.countryCode}
                  onChange={(e) => setGpsForm((g) => ({ ...g, countryCode: e.target.value }))}
                >
                  <option value="">— mevcut kalsın —</option>
                  {countries.map((c) => (
                    <option key={c.countryCode} value={c.countryCode}>
                      {c.country}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {fpApplyMsg ? <p className="helper" style={{ padding: '0 1.25rem', color: 'var(--accent-info, #38bdf8)' }}>{fpApplyMsg}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" disabled={fpBusy} onClick={regenerateFingerprint}>
                {fpBusy ? '…' : <><RefreshCw size={13} /> Parmak izini yeniden üret</>}
              </button>
              {fpDevice.fingerprint ? (
                <button type="button" className="btn-ghost" disabled={fpBusy} onClick={applyFingerprintToDevice} title="Parmak izini cihaza setprop ile uygula (kök gerektiren alanlar atlanır)">
                  {fpBusy ? '…' : <><Fingerprint size={13} /> Cihaza uygula</>}
                </button>
              ) : null}
              <button type="button" className="btn-primary" disabled={fpBusy} onClick={saveGps}>
                {fpBusy ? 'Kaydediliyor…' : 'GPS kaydet'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {pushOpen ? (
        <div className="modal-overlay" onClick={closePush}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Send size={16} /> {selectionCount} telefona dosya gönder</h2>
              <button type="button" className="modal-close" onClick={closePush}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>Dosya URL</span>
              <input
                className="field-input mono"
                value={pushForm.url}
                onChange={(e) => setPushForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/video.mp4"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Dosya adı (isteğe bağlı)</span>
                <input
                  className="field-input"
                  value={pushForm.fileName}
                  onChange={(e) => setPushForm((f) => ({ ...f, fileName: e.target.value }))}
                  placeholder="video.mp4"
                />
              </label>
              <label className="field">
                <span>Hedef</span>
                <select
                  className="field-input"
                  value={pushForm.destination}
                  onChange={(e) => setPushForm((f) => ({ ...f, destination: e.target.value }))}
                >
                  <option value="gallery">Galeri (DCIM)</option>
                  <option value="downloads">İndirilenler</option>
                </select>
              </label>
            </div>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closePush}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={pushFile}>
                {busy ? 'Gönderiliyor…' : 'Dosya gönder'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {proxyOpen ? (
        <div className="modal-overlay" onClick={closeProxy}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Network size={16} /> {selectionCount} telefona proxy ata</h2>
              <button type="button" className="modal-close" onClick={closeProxy}>
                <X size={16} />
              </button>
            </header>
            {proxies.length === 0 ? (
              <p className="helper">Henüz proxy yapılandırılmadı. Önce Proxy'ler sayfasından bir tane ekleyin.</p>
            ) : (
              <label className="field">
                <span>Proxy</span>
                <select className="field-input" value={proxyChoice} onChange={(e) => setProxyChoice(e.target.value)}>
                  <option value="">Bir proxy seçin…</option>
                  {proxies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.type} {p.host}:{p.port}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeProxy}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy || !proxyChoice} onClick={assignProxy}>
                {busy ? 'Atanıyor…' : 'Proxy ata'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {provisionFormOpen ? (
        <div className="modal-overlay" onClick={() => setProvisionFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Zap size={16} /> Tek Tıkla Cihaz Oluştur</h2>
              <button type="button" className="modal-close" onClick={() => setProvisionFormOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <p className="helper">
              Sıfırdan izole bir Waydroid cihazı kurulur (root + parmak izi + proxy + APK&apos;lar — WhatsApp&apos;a hazır).
              WhatsApp hesabı açmak ayrı bir adımdır: cihaz hazır olduktan sonra profil menüsünden &quot;WhatsApp Aç&quot;.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(90px, 120px)', gap: 12 }}>
              <label className="field">
                <span>Cihaz adı {(parseInt(form.count, 10) || 1) > 1 ? '(önek — sıralı benzersiz)' : '(boş = rastgele)'}</span>
                <input
                  className="field-input"
                  type="text"
                  placeholder={(parseInt(form.count, 10) || 1) > 1 ? 'watest → watest-a3f, watest-x7k…' : 'Boş bırak → wa-x7k2 (rastgele)'}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Adet</span>
                <input
                  className="field-input"
                  type="number"
                  min={1}
                  max={20}
                  value={form.count}
                  onChange={(e) => setForm((f) => ({ ...f, count: e.target.value.replace(/[^\d]/g, '') || '1' }))}
                />
              </label>
            </div>
            <label className="field">
              <span>Ülke (her cihaza eşleşen proxy — farklı çıkış IP)</span>
              <input
                className="field-input"
                type="text"
                maxLength={2}
                placeholder="US / AL / TR"
                value={form.countryCode}
                onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase() }))}
              />
            </label>
            {(parseInt(form.count, 10) || 1) > 1 ? (
              <p className="helper" style={{ marginTop: -4 }}>
                <b>{Math.max(1, Math.min(20, parseInt(form.count, 10) || 1))} cihaz</b> aynı anda kurulur; her biri
                benzersiz isim + {form.countryCode || 'ülke'} proxy&apos;siyle (farklı IP) hazırlanır. İlk cihazın
                canlı günlüğü açılır, kalanlar listede &quot;⚡ Kuruluyor&quot; olarak görünür.
              </p>
            ) : null}
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setProvisionFormOpen(false)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={provisionBusy} onClick={startProvision}>
                <Zap size={14} /> {provisionBusy
                  ? 'Başlatılıyor…'
                  : (parseInt(form.count, 10) || 1) > 1
                    ? `${Math.max(1, Math.min(20, parseInt(form.count, 10) || 1))} cihaz kur`
                    : 'Cihazı kur'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {waOpen ? (
        <div className="modal-overlay" onClick={() => !waBusy && setWaOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><MessageCircle size={16} /> WhatsApp Aç — {waOpen.name}</h2>
              <button type="button" className="modal-close" onClick={() => !waBusy && setWaOpen(null)}>
                <X size={16} />
              </button>
            </header>
            <p className="helper">
              Bu cihazda otonom WhatsApp kaydı başlar. Ajan numara ekranına kadar kendisi ilerler ve
              SMS kodu ekranında durur — kodu WhatsApp sayfasından girersiniz.
            </p>
            {/* ★DATA-LOSS GUARD: this device already holds a live WhatsApp account. A new
                registration factory-resets WhatsApp (pm clear) and WIPES it. Warn loudly and
                require an explicit tick before the start button is enabled. */}
            {waOpen.hasActiveWhatsapp ? (
              <div style={{ border: '1px solid rgba(248,113,113,0.5)', background: 'rgba(248,113,113,0.08)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <p style={{ margin: 0, color: '#f87171', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={15} /> Bu cihazda zaten aktif bir WhatsApp hesabı var
                  {waOpen.activeWhatsappPhone ? ` (${waOpen.activeWhatsappPhone})` : ''}
                </p>
                <p style={{ margin: '6px 0 8px', fontSize: 12, opacity: 0.85 }}>
                  Yeni kayıt WhatsApp&apos;ı sıfırlar ve mevcut hesabı <b>KALICI olarak siler</b>. Başka bir boş cihaz
                  kullanmayı düşünün. Yine de bu cihaza kaydetmek istiyorsanız aşağıyı onaylayın.
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={waOverwriteOk} onChange={(e) => setWaOverwriteOk(e.target.checked)} />
                  Mevcut hesabın silineceğini anlıyorum, yine de devam et
                </label>
              </div>
            ) : null}
            <label className="field">
              <span>Telefon numarası (ülke kodu dahil)</span>
              <input
                className="field-input"
                type="tel"
                placeholder="+355 68 234 2382"
                value={waPhone}
                autoFocus
                onChange={(e) => setWaPhone(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Profil ismi (opsiyonel)</span>
              <input
                className="field-input"
                type="text"
                placeholder="Boş bırakılırsa rastgele isim üretilir"
                value={waName}
                onChange={(e) => setWaName(e.target.value)}
              />
            </label>
            <p className="helper" style={{ opacity: 0.7 }}>
              ⚠️ Numaranın ülkesi ile cihazın proxy çıkış ülkesi AYNI olmalı (yoksa WhatsApp
              &quot;Login not available&quot; verir). Cihaza doğru ülkenin proxy&apos;sini atadığınızdan emin olun.
            </p>
            {waMsg ? <p className={waMsg.startsWith('Kayıt başladı') ? 'helper' : 'field-error'}>{waMsg}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" disabled={waBusy} onClick={() => setWaOpen(null)}>
                İptal
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={waBusy || !waPhone.trim() || (waOpen.hasActiveWhatsapp && !waOverwriteOk)}
                onClick={startWhatsapp}
              >
                <MessageCircle size={14} /> {waBusy ? 'Başlatılıyor…' : waOpen.hasActiveWhatsapp ? 'Mevcut hesabı sil ve kaydet' : 'WhatsApp kaydını başlat'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {igOpen ? (
        <div className="modal-overlay" onClick={() => !igBusy && setIgOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Camera size={16} /> Instagram Aç — {igOpen.name}</h2>
              <button type="button" className="modal-close" onClick={() => !igBusy && setIgOpen(null)}>
                <X size={16} />
              </button>
            </header>
            <p className="helper">
              Bu cihazda <strong>tam otonom</strong> Instagram kaydı başlar. Ajan sahte bir kimlik +
              tek-kullanımlık e-posta + şifre üretir, e-posta ile kayıt olur ve doğrulama kodunu
              e-postadan kendisi okur. Sizin bir şey girmenize gerek yok — canlı adım adım izleyebilirsiniz.
            </p>
            <p className="helper" style={{ opacity: 0.7 }}>
              ⚠️ Instagram bazen captcha veya telefon doğrulaması isteyebilir. O durumda hesap
              oluşur ama &quot;doğrulama duvarı&quot; olarak işaretlenir — canlı ekrandan elle tamamlarsınız.
              Cihaza ülke-eşleşmeli residential proxy atadığınızdan emin olun (ban riskini azaltır).
            </p>
            {igMsg ? <p className={igMsg.startsWith('Kayıt başladı') ? 'helper' : 'field-error'}>{igMsg}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" disabled={igBusy} onClick={() => setIgOpen(null)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={igBusy} onClick={startInstagram}>
                <Camera size={14} /> {igBusy ? 'Başlatılıyor…' : 'Instagram kaydını başlat'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {appOpen ? (
        <div className="modal-overlay" onClick={closeApp}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Package size={16} /> {selectionCount} telefona uygulama yükle</h2>
              <button type="button" className="modal-close" onClick={closeApp}>
                <X size={16} />
              </button>
            </header>
            {apps.length === 0 ? (
              <p className="helper">Katalogda henüz uygulama yok.</p>
            ) : (
              <label className="field">
                <span>Uygulama</span>
                <select className="field-input" value={appChoice} onChange={(e) => setAppChoice(e.target.value)}>
                  <option value="">Bir uygulama seçin…</option>
                  {apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · v{a.version}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={closeApp}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy || !appChoice} onClick={installApp}>
                {busy ? 'Yükleniyor…' : 'Uygulama yükle'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {provisioning ? (
        <ProvisionModal
          jobId={provisioning.jobId}
          deviceId={provisioning.deviceId}
          instance={provisioning.instance}
          {...(provisioning.name ? { name: provisioning.name } : {})}
          steps={provisioning.steps}
          onClose={() => setProvisioning(null)}
        />
      ) : null}

      {waRegistering ? (
        <WhatsappRegisterModal
          accountId={waRegistering.accountId}
          deviceId={waRegistering.deviceId}
          phoneNumber={waRegistering.phoneNumber}
          steps={waRegistering.steps}
          proxyCountry={waRegistering.proxyCountry ?? null}
          onClose={() => setWaRegistering(null)}
        />
      ) : null}

      {igRegistering ? (
        <InstagramRegisterModal
          accountId={igRegistering.accountId}
          deviceId={igRegistering.deviceId}
          email={igRegistering.email}
          steps={igRegistering.steps}
          onClose={() => setIgRegistering(null)}
        />
      ) : null}

      {proxyDevice ? (
        <DeviceProxyModal
          deviceId={proxyDevice.id}
          deviceName={proxyDevice.name}
          currentProxyId={proxyDevice.proxyId ?? null}
          currentCountry={(proxyDevice.metadata?.proxyCountry as string) ?? null}
          onClose={() => setProxyDevice(null)}
          onAssigned={() => router.refresh()}
        />
      ) : null}

      {/* Fleet toast — DEVICE_BUSY warnings, identity-reroll result, etc. */}
      {toast ? (
        <div className={`fleet-toast fleet-toast-${toast.kind}`} role="status" onClick={() => setToast(null)}>
          {toast.kind === 'ok' ? <Check size={15} /> : toast.kind === 'warn' ? <AlertTriangle size={15} /> : <X size={15} />}
          <span>{toast.text}</span>
        </div>
      ) : null}
    </div>
  );
}

function FpRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  // Stacked layout: label on top (small), value below (wraps freely) — long mono
  // ids (IMEI/MAC/serial/phone) never overlap the label anymore.
  return (
    <div className="fp-row">
      <span className="fp-row-label">{label}</span>
      <span className={`fp-row-value${mono ? ' mono' : ''}`} title={value}>{value}</span>
    </div>
  );
}
