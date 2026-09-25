// Telegram uçtan uca WhatsApp kaydı — ÇEKİRDEK (durum makinesi + sıra algoritması).
//
// ★2026-09-26 Bu dosya BİLEREK hiçbir ağır modülü (prisma, servisler, logger, crypto)
// içe aktarmaz: dış dünyaya dair her şey `TgRegDeps` ile verilir. Canlıda
// tg-register.service.ts gerçek bağımlılıkları bağlar; testlerde (tg-register.test.ts)
// sahte veritabanı + sahte Telegram + sahte saat verilir ve BİREBİR AYNI algoritma
// uçtan uca çalıştırılır. Böylece test edilen kod ile canlıda çalışan kod aynıdır.
//
// Akış: numara(lar) → isim (tek / hepsine aynı / rastgele / satır başına) → sıra →
// boşta cihaz ya da yeni cihaz → kayıt → OTP'de ekran görüntüsü + yanıtla kod → sonuç.
// Aynı anda en fazla `limit` (varsayılan 4) numara SIRA DIŞINDADIR — kod bekleyenler dahil.
// Böylece ban riskine karşı eşzamanlı kayıt sayısı sınırlı kalır ve operatör aynı anda en
// fazla `limit` kod ile uğraşır.

import { normalizeOtpInput } from '../../lib/phone';

// ── Tipler ───────────────────────────────────────────────────────────────────

export type Phase =
  | 'queued' | 'finding_device' | 'waiting_capacity' | 'provisioning' | 'starting'
  | 'registering' | 'awaiting_method' | 'awaiting_otp' | 'verifying'
  | 'done' | 'failed' | 'cancelled';

export const FINAL: ReadonlySet<Phase> = new Set<Phase>(['done', 'failed', 'cancelled']);

export type InlineButton = { text: string; callback_data: string };
export type Ctx = { token: string; workspaceId: string; chatId: string };

export type Session = {
  id: string;
  token: string;
  chatId: string;
  workspaceId: string;
  phone: string;               // yalnız rakam, ülke kodu dahil
  name: string | null;         // null → rastgele isim
  country: string;
  batchId?: string | undefined;
  phase: Phase;
  createdAt: number;
  phaseSince: number;
  statusMsgId?: number | undefined;
  lastRendered?: string | undefined;
  lastEditAt?: number | undefined;
  deviceId?: string | undefined;
  deviceName?: string | undefined;
  newDevice?: boolean | undefined;
  provisionJobId?: string | undefined;
  accountId?: string | undefined;
  excludedDevices: string[];
  sentShotJobs: string[];
  otpPromptMsgIds: number[];
  capacityWarned?: boolean | undefined;
  lastCapacityTry?: number | undefined;
  note?: string | undefined;
  finishedAt?: number | undefined;
  liveMsgId?: number | undefined;
  liveShotTs?: number | undefined;
  liveEditAt?: number | undefined;
  liveClosed?: boolean | undefined;
  banned?: boolean | undefined;   // numara yanık → "Tekrar dene" ASLA sunulmaz
};

export type Batch = {
  id: string;
  token: string;
  chatId: string;
  workspaceId: string;
  sessionIds: string[];
  nameLabel: string;
  createdAt: number;
  msgId?: number | undefined;
  lastRendered?: string | undefined;
  lastEditAt?: number | undefined;
  closed?: boolean | undefined;
};

type Entry = { phone: string; name: string | null | undefined }; // undefined = henüz sorulmadı
type Draft = {
  token: string;
  workspaceId: string;
  stage: 'numbers' | 'confirm_shortcut' | 'naming_choice' | 'group_name' | 'names' | 'confirm_start';
  entries: Entry[];
  idx: number;
  raw?: string | undefined;        // kısayolla gelen ham numara listesi (onay bekliyor)
  nameLabel?: string | undefined;  // toplu başlatma onayında gösterilen isim özeti
};

export type RegStatus = {
  status: string;
  percent: number;
  log: unknown[];
  lastProgress?: { label?: string } | null | undefined;
  note?: string | null | undefined;
  action?: string | null | undefined;
  otpChannel?: string | null | undefined;
  awaitingOtp: boolean;
  awaitingMethod: boolean;
  otpRejected?: boolean | undefined;
  waitUntil?: string | null | undefined;
  // BAN | APK | COK_DENEME | RED — yanık numarada hesap BANNED değil FAILED olur; yasak bilgisi BURADA.
  wallKind?: string | null | undefined;
};

export type ProvStatus = {
  phase: 'provisioning' | 'ready' | 'failed';
  percent: number;
  log: unknown[];
  lastProgress?: { label?: string } | null | undefined;
  error?: string | null | undefined;
};

export type RegJob = { id: string; status: string; result: Record<string, unknown> };
export type LiveShot = { shot: string; ts: number; label: string; note: string };
export type DeviceRow = { id: string; name: string; metadata: unknown };

/** Hata nesnesinden kod (AppError.code) okur — çekirdek AppError'u içe aktarmaz. */
function errCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type TgRegDeps = {
  now(): number;
  log(level: 'info' | 'warn', msg: string, meta?: Record<string, unknown>): void;
  countryFromPhone(phone: string): string | null;
  // Telegram
  send(token: string, chatId: string, text: string, buttons?: InlineButton[][]): Promise<number | undefined>;
  edit(token: string, chatId: string, messageId: number, text: string, buttons?: InlineButton[][]): Promise<boolean>;
  sendPhoto(token: string, chatId: string, b64: string, caption: string, opts?: { forceReply?: boolean; buttons?: InlineButton[][] }): Promise<number | undefined>;
  editPhoto(token: string, chatId: string, messageId: number, b64: string, caption: string): Promise<'ok' | 'gone' | 'skip'>;
  editCaption(token: string, chatId: string, messageId: number, caption: string): Promise<void>;
  // Veri
  occupiedDeviceIds(workspaceId: string): Promise<string[]>;
  onlineDevices(workspaceId: string, excludeIds: string[]): Promise<DeviceRow[]>;
  busyJobCount(deviceId: string): Promise<number>;
  duplicateAccounts(workspaceId: string, phonesE164: string[]): Promise<Array<{ phoneNumber: string; status: string }>>;
  latestRegisterJob(accountId: string): Promise<RegJob | null>;
  findAwaitingAccountByPhone(workspaceId: string, phoneE164: string): Promise<{ id: string; deviceId: string | null } | null>;
  // Servisler (panelin kullandıklarının aynısı)
  createInstance(proxyCountry: string, workspaceId: string): Promise<{ jobId: string; deviceId: string; name: string }>;
  provisionStatus(jobId: string, workspaceId: string): Promise<ProvStatus | null>;
  startRegister(workspaceId: string, deviceId: string, phoneE164: string, name: string | undefined): Promise<{ accountId: string }>;
  registerStatus(accountId: string, workspaceId: string): Promise<RegStatus | null>;
  provideOtp(workspaceId: string, accountId: string, code: string): Promise<void>;
  provideMethod(workspaceId: string, accountId: string, method: string): Promise<void>;
  retryRegister(workspaceId: string, accountId: string): Promise<void>;
  cancelAccount(workspaceId: string, accountId: string): Promise<void>;
  liveShot(accountId: string): LiveShot | null;
  // Kalıcılık (şifreleme servis katmanında)
  save(data: string): Promise<void>;
  load(): Promise<string | null>;
};

// ── Ayarlar ──────────────────────────────────────────────────────────────────

export const LIMITS = {
  DEFAULT_CONCURRENCY: 4,
  MIN_CONCURRENCY: 1,
  MAX_CONCURRENCY: 8,
  MAX_NUMBERS_PER_REQUEST: 100,
  EDIT_MIN_INTERVAL_MS: 6_000,
  LIVE_MIN_INTERVAL_MS: 8_000,
  BATCH_MIN_INTERVAL_MS: 8_000,
  PROVISION_TIMEOUT_MS: 15 * 60_000,
  REGISTER_TIMEOUT_MS: 12 * 60_000,
  START_RETRY_WINDOW_MS: 3 * 60_000,
  CAPACITY_RETRY_MS: 2 * 60_000,
  CAPACITY_GIVE_UP_MS: 60 * 60_000,
  FINAL_KEEP_MS: 6 * 60 * 60_000,
  NAME_MAX: 25
} as const;

// Bu durumlardaki hesapları olan cihaz "boşta" sayılmaz (BANNED dahil: yanmış hesabın
// cihaz izi/IP'si yeni numaraya bulaşmasın).
export const BLOCKING_ACCOUNT_STATUSES = ['ACTIVE', 'AWAITING_OTP', 'AWAITING_MANUAL', 'REGISTERING', 'RESTRICTED', 'LOGGED_OUT', 'BANNED'];
// Aynı numara bu durumlardaysa ikinci kez başlatılmaz.
export const DUPLICATE_ACCOUNT_STATUSES = ['ACTIVE', 'AWAITING_OTP', 'AWAITING_MANUAL', 'REGISTERING'];

const LIVE_PHASES: ReadonlySet<Phase> = new Set<Phase>(['registering', 'verifying', 'awaiting_otp', 'awaiting_method']);

// ── Saf yardımcılar (testlerde doğrudan sınanır) ─────────────────────────────

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fmtPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) return `+90 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  return `+${d}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function bar(percent: number): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round(p / 10);
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} %${p}`;
}

/** Profil adı: 1-25 karakter, HTML açısından güvenli. Geçersizse null. */
export function cleanName(raw: string): string | null {
  const n = String(raw ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > LIMITS.NAME_MAX) return null;
  if (/^\d+$/.test(n)) return null; // yalnız rakam — büyük olasılıkla yanlış yere yazılmış numara/kod
  return n;
}

// ── 🧠 Akıllı numara tanıma ──────────────────────────────────────────────────
//
// ★2026-09-26 Operatör isteği: "numaranın başına +90 ya da 0 yazmasak da, boşluk/tire
// koysak da otomatik düzeltsin; anlayabilen ve sorun çözebilen bir sistem olsun."
//
// Kural: DÜZELT ama SESSİZCE DEĞİL. Her düzeltme `fixes` içinde döner ve toplu başlatma
// onayında operatöre gösterilir (yanlış numaraya kayıt = numara harcamak). Emin
// olunamayan durumda tahmin edilmez, açık bir hata verilir.
//
// Varsayılan ülke Türkiye (+90): filo TR ağırlıklı. Başka ülke numarası ülke koduyla
// (+355…, 0049…) yazılırsa olduğu gibi tanınır.

const DEFAULT_CC = '90';

/** Unicode rakamları (Arapça-Hint, Farsça, tam genişlik) ASCII'ye çevirir. */
function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
}

export type PhoneParse = { digits: string; name: string | null | undefined; fixes: string[] } | { error: string };

/**
 * Tek bir satırdan numarayı (ve varsa ismi) çıkarır. Numara satırın herhangi bir yerinde
 * olabilir ("Ahmet 0555 111 22 33", "0555-111-22-33 Destek", Excel'den sekmeli satır).
 */
export function parsePhoneLine(rawLine: string, countryFromPhone: (p: string) => string | null): PhoneParse {
  const line = asciiDigits(String(rawLine ?? '')).replace(/\t/g, ' ').trim();
  // En uzun "telefon benzeri" parça: rakam + ayırıcılar ( + - . / boşluk parantez ).
  const runs = [...line.matchAll(/\+?\(?\d[\d\s().\-/]{5,}\d\)?/g)];
  if (!runs.length) return { error: 'numara bulunamadı' };
  const best = runs.reduce((a, b) => (b[0].replace(/\D/g, '').length > a[0].replace(/\D/g, '').length ? b : a));
  const piece = best[0];
  const plus = /^\+/.test(piece.trim());
  let d = piece.replace(/\D/g, '');
  const fixes: string[] = [];

  // İsim: numaranın dışında kalan metin (baş/son ayırıcılar ve "tel:" gibi etiketler atılır).
  const rest = (line.slice(0, best.index) + ' ' + line.slice((best.index ?? 0) + piece.length))
    .replace(/\b(tel|telefon|numara|no|gsm|cep|phone|whatsapp|wp)\b\s*[:.]?/gi, ' ')
    .replace(/^[\s\-:|,;=/"'*]+|[\s\-:|,;=/"'*]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let name: string | null | undefined;
  if (rest) {
    const n = cleanName(rest);
    if (n) name = n;
    else fixes.push(`isim geçersiz ("${rest.slice(0, 20)}") — sorulacak`);
  }

  if (d.startsWith('00')) { d = d.slice(2); fixes.push('baştaki 00 → +'); }
  else if (!plus) {
    if (d.length === 11 && d.startsWith('0')) { d = DEFAULT_CC + d.slice(1); fixes.push('baştaki 0 → +90'); }
    else if (d.length === 10 && d.startsWith('5')) { d = DEFAULT_CC + d; fixes.push('ülke kodu eklendi (+90)'); }
  }
  // "+90 0555…" → ülke kodundan sonra fazladan 0
  if (d.startsWith(`${DEFAULT_CC}0`) && d.length === 13) { d = DEFAULT_CC + d.slice(3); fixes.push('+90 sonrasındaki fazla 0 silindi'); }

  // Türkiye numarası için sıkı doğrulama: 90 + 10 hane, cep numarası 5 ile başlar.
  if (d.startsWith(DEFAULT_CC)) {
    if (d.length < 12) return { error: `${12 - d.length} hane eksik (Türkiye: +90 5xx xxx xx xx)` };
    if (d.length > 12) return { error: `${d.length - 12} hane fazla (Türkiye: +90 5xx xxx xx xx)` };
    if (d[2] !== '5') fixes.push('⚠️ cep numarası değil (5 ile başlamıyor) — sabit hat WhatsApp kaydı alamayabilir');
  }
  if (!plus && d.length < 10) return { error: `numara kısa (${d.length} hane) — Türkiye cep numarası: 0555 111 22 33` };
  if (d.length < 8 || d.length > 15) return { error: 'numara çok kısa ya da çok uzun' };
  if (!countryFromPhone(d)) return { error: 'ülke kodu tanınmadı — başına +ülke kodu yazın (örn. +355…)' };
  return { digits: d, name, fixes };
}

/**
 * Operatörün yapıştırdığı listeyi ayrıştırır. Her satır: `numara` ya da `numara isim`.
 * Ayırıcı: satır sonu, virgül, noktalı virgül. Rakam/ayırıcıdan oluşmayan satırlar
 * geçersiz sayılır — tahmin edilmez (yanlış numaraya kayıt, hata mesajından kötüdür).
 */
export function parseEntryLines(
  text: string,
  countryFromPhone: (p: string) => string | null
): { entries: Entry[]; problems: string[]; fixes: string[] } {
  // Satır sonu / noktalı virgül her zaman ayırır. Virgül yalnız numaralar arasında ayırıcıdır
  // ("0555 111 22 33, 0555 111 22 34"); bu yüzden önce satırlara, sonra virgüllere bölünür.
  const lines = String(text ?? '')
    .split(/[\n;]+/)
    .flatMap((l) => (/\d[\s\d().\-]*,\s*\+?\(?\d/.test(l) ? l.split(',') : [l]))
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: Entry[] = [];
  const problems: string[] = [];
  const fixes: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const p = parsePhoneLine(line, countryFromPhone);
    if ('error' in p) { problems.push(`${esc(line.slice(0, 40))} — ${esc(p.error)}`); continue; }
    if (seen.has(p.digits)) { problems.push(`<code>${esc(fmtPhone(p.digits))}</code> — listede iki kez var, bir kez alındı`); continue; }
    seen.add(p.digits);
    const real = p.fixes.filter((f) => !f.startsWith('isim geçersiz'));
    if (real.length) fixes.push(`🔧 <code>${esc(line.slice(0, 32))}</code> → <code>${esc(fmtPhone(p.digits))}</code> <i>(${esc(real.join(', '))})</i>`);
    if (p.fixes.some((f) => f.startsWith('isim geçersiz'))) problems.push(`<code>${esc(fmtPhone(p.digits))}</code> — isim geçersiz (1-${LIMITS.NAME_MAX} karakter), sorulacak`);
    entries.push({ phone: p.digits, name: p.name });
  }
  if (entries.length > LIMITS.MAX_NUMBERS_PER_REQUEST) {
    problems.push(`Tek seferde en fazla ${LIMITS.MAX_NUMBERS_PER_REQUEST} numara — ilk ${LIMITS.MAX_NUMBERS_PER_REQUEST} tanesi alındı.`);
    entries.splice(LIMITS.MAX_NUMBERS_PER_REQUEST);
  }
  return { entries, problems, fixes };
}

/**
 * Metinden OTP kodunu çıkarır — SMS'in tamamı yapıştırılsa bile ("WhatsApp kodunuz: 123-456.
 * Bu kodu kimseyle paylaşmayın"). Önce 3-3 biçimi, sonra tek başına 6 hane, sonra 4-8 hane
 * aranır. Birden fazla farklı aday varsa (belirsiz) null döner — yanlış kodu girmek yerine sorulur.
 */
export function extractOtp(raw: string): string | null {
  const s = asciiDigits(String(raw ?? ''));
  const direct = normalizeOtpInput(s);
  if (direct) return direct;
  const split = [...s.matchAll(/(?<!\d)(\d{3})[\s\-.](\d{3})(?!\d)/g)].map((m) => m[1]! + m[2]!);
  if (new Set(split).size === 1) return split[0]!;
  const six = [...s.matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map((m) => m[1]!);
  if (new Set(six).size === 1) return six[0]!;
  const any = [...s.matchAll(/(?<!\d)(\d{4,8})(?!\d)/g)].map((m) => m[1]!);
  if (new Set(any).size === 1) return any[0]!;
  return null;
}

/**
 * Mesaj yalnız numaralardan (isteğe bağlı kısa bir isimle) mı oluşuyor? — komutsuz kısayol için.
 * Sohbet cümlesi ("yarın 0555 111 22 33'ü ara, unutma") numara listesi SAYILMAZ: her satırda
 * numara dışında kalan kısım geçerli bir isim (≤25 karakter) ya da boş olmalı.
 */
export function looksLikeNumberList(text: string, countryFromPhone: (p: string) => string | null): boolean {
  const lines = String(text ?? '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  return lines.every((l) => {
    const p = parsePhoneLine(l, countryFromPhone);
    return !('error' in p) && !p.fixes.some((f) => f.startsWith('isim geçersiz'));
  });
}

type LogLine = { label?: string; note?: string; step?: string };
export function renderLog(log: unknown[], limit: number): string[] {
  const out: string[] = [];
  let prev = '';
  for (const raw of log ?? []) {
    const l = (raw ?? {}) as LogLine;
    const note = typeof l.note === 'string' ? l.note : '';
    if (note.startsWith('📸') || note === '🎥 canlı') continue; // kare/nabız satırı durum değişikliği değil
    const label = typeof l.label === 'string' ? l.label : (l.step ?? '');
    const text = note && note !== label ? `${label} — ${note}` : label;
    if (!text || text === prev) continue;
    prev = text;
    out.push(text);
  }
  return out.slice(-limit).map((t) => `• ${esc(t.length > 140 ? `${t.slice(0, 140)}…` : t)}`);
}

function lastShot(result: Record<string, unknown>): { label: string; png: string } | null {
  const shots = Array.isArray(result.shots) ? (result.shots as Array<{ label?: string; png?: string }>) : [];
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i];
    if (sh && typeof sh.png === 'string' && sh.png.length > 100) return { label: sh.label ?? 'ekran', png: sh.png };
  }
  return null;
}

// ── Çekirdek ─────────────────────────────────────────────────────────────────

export function createTgRegister(deps: TgRegDeps, opts: { concurrency?: number } = {}) {
  const sessions = new Map<string, Session>();
  const batches = new Map<string, Batch>();
  const drafts = new Map<string, Draft>();
  const clampLimit = (n: number) =>
    Math.max(LIMITS.MIN_CONCURRENCY, Math.min(LIMITS.MAX_CONCURRENCY, Math.floor(n) || LIMITS.DEFAULT_CONCURRENCY));
  let limit = clampLimit(opts.concurrency ?? LIMITS.DEFAULT_CONCURRENCY);
  let dirty = false;
  let ticking = false;
  let loaded = false;

  const newId = (taken: (id: string) => boolean): string => {
    let id = '';
    do { id = Math.random().toString(36).slice(2, 8); } while (!id || taken(id));
    return id;
  };

  const setPhase = (s: Session, phase: Phase, note?: string): void => {
    if (s.phase !== phase) {
      s.phase = phase;
      s.phaseSince = deps.now();
      if (FINAL.has(phase)) s.finishedAt = deps.now();
    }
    if (note !== undefined) s.note = note;
    dirty = true;
  };

  const activeCount = () => [...sessions.values()].filter((s) => s.phase !== 'queued' && !FINAL.has(s.phase)).length;
  const sessionsFor = (chatId: string) => [...sessions.values()].filter((s) => s.chatId === chatId);
  const queuedSorted = () => [...sessions.values()].filter((x) => x.phase === 'queued').sort((a, b) => a.createdAt - b.createdAt);
  const queuePosition = (s: Session) => queuedSorted().findIndex((x) => x.id === s.id) + 1;

  // ── Kalıcılık ──────────────────────────────────────────────────────────────
  const persist = async (): Promise<void> => {
    if (!dirty) return;
    dirty = false;
    try {
      await deps.save(JSON.stringify({ v: 2, limit, sessions: [...sessions.values()], batches: [...batches.values()] }));
    } catch (e) {
      deps.log('warn', 'tg-kayit durum kaydedilemedi', { error: errMsg(e) });
    }
  };

  const restore = async (): Promise<void> => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = await deps.load();
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      // v1: düz oturum dizisi · v2: { v, limit, sessions, batches }
      const obj = Array.isArray(parsed) ? { sessions: parsed as Session[] } : (parsed as { limit?: number; sessions?: Session[]; batches?: Batch[] });
      if ('limit' in obj && typeof obj.limit === 'number') limit = clampLimit(obj.limit);
      for (const s of obj.sessions ?? []) {
        if (!s?.id || !s.token || !s.chatId) continue;
        s.excludedDevices ??= [];
        s.sentShotJobs ??= [];
        s.otpPromptMsgIds ??= [];
        sessions.set(s.id, s);
      }
      for (const b of ('batches' in obj ? obj.batches : undefined) ?? []) if (b?.id) batches.set(b.id, b);
      deps.log('info', 'tg-kayit durumu geri yuklendi', { oturum: sessions.size, toplu: batches.size, limit });
    } catch (e) {
      deps.log('warn', 'tg-kayit durumu okunamadi (bos baslaniyor)', { error: errMsg(e) });
    }
  };

  // ── Durum mesajı ───────────────────────────────────────────────────────────
  const methodButtons = (s: Session): InlineButton[][] => [
    [
      { text: '✉️ SMS', callback_data: `wr:m:${s.id}:sms` },
      { text: '📞 Sesli arama', callback_data: `wr:m:${s.id}:voice` }
    ],
    [{ text: '📵 Cevapsız arama', callback_data: `wr:m:${s.id}:missed_call` }]
  ];

  const clock = (ts: number, withSeconds = false) =>
    new Date(ts).toLocaleTimeString('tr-TR', {
      timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' as const } : {})
    });

  const renderStatus = async (s: Session): Promise<{ text: string; buttons: InlineButton[][] }> => {
    const now = deps.now();
    const head = [
      `📲 <b>WhatsApp Kaydı</b> · <code>${esc(fmtPhone(s.phone))}</code>`,
      `👤 ${s.name ? esc(s.name) : '<i>rastgele isim</i>'} · 🌍 ${esc(s.country)}` +
        (s.deviceName ? ` · 📱 <b>${esc(s.deviceName)}</b>${s.newDevice ? ' <i>(yeni)</i>' : ''}` : '')
    ];
    const lines: string[] = [];
    const elapsed = fmtDuration(now - s.phaseSince);
    const cancelBtn: InlineButton = { text: '🛑 İptal', callback_data: `wr:x:${s.id}` };
    const shotBtn: InlineButton = { text: '📷 Son ekran', callback_data: `wr:s:${s.id}` };
    let buttons: InlineButton[][] = [[cancelBtn]];

    switch (s.phase) {
      case 'queued':
        lines.push(`⏳ <b>Sırada</b> — ${queuePosition(s)}. sıra`);
        lines.push(`<i>Aynı anda en fazla ${limit} numara kayıtta olur (kod bekleyenler dahil).</i>`);
        break;
      case 'finding_device':
        lines.push('🔎 Boşta cihaz aranıyor…');
        break;
      case 'waiting_capacity':
        lines.push('⚠️ <b>Sunucu kapasitesi dolu</b> — boşta cihaz yok, yeni cihaz açılamıyor.');
        if (s.note) lines.push(`<i>${esc(s.note)}</i>`);
        lines.push(`🔁 ${Math.round(LIMITS.CAPACITY_RETRY_MS / 60_000)} dakikada bir yeniden deneniyor (bekleme ${elapsed}).`);
        break;
      case 'provisioning': {
        let pct = 0;
        let log: string[] = [];
        if (s.provisionJobId) {
          const st = await deps.provisionStatus(s.provisionJobId, s.workspaceId).catch(() => null);
          if (st) {
            pct = st.percent;
            log = renderLog(st.log, 7);
            if (st.lastProgress?.label) lines.push(`🛠 <b>${esc(String(st.lastProgress.label))}</b>`);
          }
        }
        lines.push(`${bar(pct)} · ⏱ ${elapsed}`);
        lines.push('<i>Cihaz açılırken ekran olmaz; kayıt başlayınca 📺 canlı ekran gelir.</i>');
        if (log.length) lines.push('', '<b>Kurulum logu:</b>', ...log);
        break;
      }
      case 'starting':
        lines.push(`🚀 Kayıt başlatılıyor… (⏱ ${elapsed})`);
        if (s.note) lines.push(`<i>${esc(s.note)}</i>`);
        break;
      case 'registering':
      case 'verifying':
      case 'awaiting_method':
      case 'awaiting_otp': {
        const st = s.accountId ? await deps.registerStatus(s.accountId, s.workspaceId).catch(() => null) : null;
        const label = st?.lastProgress?.label ? String(st.lastProgress.label) : '';
        if (s.phase === 'awaiting_otp') {
          lines.push('🔑 <b>Kod bekleniyor</b> — ekran görüntüsüne <b>yanıt olarak</b> kodu yazın.');
          if (st?.note) lines.push(`<i>${esc(String(st.note))}</i>`);
          if (st?.otpRejected) lines.push('❌ <b>Son girilen kod reddedildi</b> — doğru kodu tekrar yazın.');
        } else if (s.phase === 'awaiting_method') {
          lines.push('🔀 <b>Doğrulama yöntemi seçin</b> (aşağıdaki butonlar).');
        } else if (s.phase === 'verifying') {
          lines.push('✅ Kod/yöntem iletildi — WhatsApp doğruluyor…');
        } else {
          lines.push(label ? `📍 <b>${esc(label)}</b>` : '📍 Kayıt sürüyor');
        }
        const waiting = s.phase === 'awaiting_otp' || s.phase === 'awaiting_method';
        // Canlı ekran açıksa saat orada akar; durum mesajı yalnız ADIM değişince düzenlenir.
        const tail = waiting ? ` · 🕐 ${clock(s.phaseSince)}'den beri bekliyor` : s.liveMsgId ? ' · 📺 canlı ekran aşağıda' : ` · ⏱ ${elapsed}`;
        lines.push(bar(st?.percent ?? 0) + tail);
        const log = st ? renderLog(st.log, 6) : [];
        if (log.length) lines.push('', '<b>Kayıt logu:</b>', ...log);
        buttons = s.phase === 'awaiting_method' ? [...methodButtons(s), [shotBtn, cancelBtn]] : [[shotBtn, cancelBtn]];
        break;
      }
      case 'done':
        lines.push(`✅ <b>Hesap açıldı!</b> Toplam süre ${fmtDuration(now - s.createdAt)}.`);
        buttons = [[shotBtn]];
        break;
      case 'failed':
        lines.push(s.banned ? '⛔ <b>NUMARA YANIK — bu numarayla tekrar denemeyin</b>' : '❌ <b>Kayıt tamamlanamadı</b>');
        if (s.note) lines.push(esc(s.note));
        buttons = s.banned
          ? [[shotBtn]]
          : s.accountId
            ? [[{ text: '🔁 Tekrar dene', callback_data: `wr:r:${s.id}` }, shotBtn]]
            : [[{ text: '🔁 Baştan dene', callback_data: `wr:q:${s.id}` }]];
        break;
      case 'cancelled':
        lines.push('🛑 <b>İptal edildi.</b>');
        if (s.note) lines.push(`<i>${esc(s.note)}</i>`);
        buttons = [];
        break;
    }
    return { text: [...head, '━━━━━━━━━━━━', ...lines].join('\n'), buttons };
  };

  const refreshStatus = async (s: Session, force = false): Promise<void> => {
    // Toplu kayıtta sıradaki numaralar yalnız ÖZET mesajında görünür (50 numara = 50 mesaj olmasın).
    if (s.batchId && s.phase === 'queued' && !s.statusMsgId) return;
    const now = deps.now();
    if (!force && s.lastEditAt && now - s.lastEditAt < LIMITS.EDIT_MIN_INTERVAL_MS) return;
    const { text, buttons } = await renderStatus(s);
    if (!force && text === s.lastRendered) return;
    s.lastRendered = text;
    s.lastEditAt = now;
    if (s.statusMsgId && (await deps.edit(s.token, s.chatId, s.statusMsgId, text, buttons))) return;
    const id = await deps.send(s.token, s.chatId, text, buttons);
    if (id) { s.statusMsgId = id; dirty = true; }
  };

  // ── 📺 Canlı ekran ─────────────────────────────────────────────────────────
  const refreshLive = async (s: Session): Promise<void> => {
    if (!s.accountId || s.liveClosed) return;
    const now = deps.now();
    if (FINAL.has(s.phase)) {
      s.liveClosed = true;
      dirty = true;
      if (s.liveMsgId) {
        const mark = s.phase === 'done' ? '✅ Kayıt tamamlandı' : s.phase === 'cancelled' ? '🛑 İptal edildi' : '❌ Kayıt durdu';
        await deps.editCaption(s.token, s.chatId, s.liveMsgId, `📺 <b>Canlı ekran — son kare</b> · <code>${esc(fmtPhone(s.phone))}</code>\n${mark}`).catch(() => undefined);
      }
      return;
    }
    if (!LIVE_PHASES.has(s.phase)) return;
    const live = deps.liveShot(s.accountId);
    if (!live || live.ts === s.liveShotTs) return;
    if (s.liveEditAt && now - s.liveEditAt < LIMITS.LIVE_MIN_INTERVAL_MS) return;
    const note = live.note && live.note !== '🎥 canlı' ? ` — ${live.note.replace(/^📸\s*/, '')}` : '';
    const caption =
      `📺 <b>Canlı ekran</b> · <code>${esc(fmtPhone(s.phone))}</code>\n📍 ${esc(live.label)}${esc(note)}\n🕐 ${clock(live.ts, true)}` +
      (s.phase === 'awaiting_otp' ? '\n🔑 <i>Kod bekleniyor — kodu "Kod bekleniyor" mesajına yanıt olarak yazın.</i>' : '');
    s.liveEditAt = now;
    if (s.liveMsgId) {
      const r = await deps.editPhoto(s.token, s.chatId, s.liveMsgId, live.shot, caption);
      if (r === 'ok') { s.liveShotTs = live.ts; dirty = true; return; }
      if (r === 'skip') return;
      s.liveMsgId = undefined; // silinmiş → yenisini aç
    }
    const id = await deps.sendPhoto(s.token, s.chatId, live.shot, caption);
    if (id) { s.liveMsgId = id; s.liveShotTs = live.ts; dirty = true; }
  };

  // ── Kimlik kartı: HER ekran görüntüsünün başlığı aynı biçimde ────────────────
  // Operatör bir bakışta NE olduğunu, HANGİ numara/cihaz olduğunu ve NE YAPMASI gerektiğini
  // görmeli — toplu kayıtta 4 cihazın ekranı art arda düşerken karışıklık olmasın.
  const card = (s: Session, title: string, body: string[] = [], footer?: string): string =>
    [
      title,
      `📞 <code>${esc(fmtPhone(s.phone))}</code>`,
      `📱 Cihaz: <b>${esc(s.deviceName ?? '—')}</b>${s.name ? ` · 👤 ${esc(s.name)}` : ''}`,
      '━━━━━━━━━━━━',
      ...body,
      ...(footer ? ['', footer] : [])
    ].join('\n');

  // Cihaz daha AÇILMADAN oluşan hatalar (kurulum/başlatma/kapasite): ekran yok, ama operatör
  // HANGİ numara/cihazın NE hata verdiğini ayrı bir kartla görmeli (yalnız durum mesajı yetmez).
  const failAlert = async (s: Session, what: string, todo: string): Promise<void> => {
    setPhase(s, 'failed', what);
    await deps.send(s.token, s.chatId,
      card(s, '❌ <b>KAYIT BAŞLATILAMADI — HATA</b>', [`<b>Ne oldu:</b> ${esc(what.slice(0, 400))}`, '<i>(Cihaz ekranı henüz açılmadığı için ekran görüntüsü yok.)</i>'],
        `👉 <b>Ne yapmalı:</b> ${esc(todo)}`),
      s.accountId ? undefined : [[{ text: '🔁 Baştan dene', callback_data: `wr:q:${s.id}` }]]);
  };

  // ── Ekran görüntüsü (kayıt işinin son karesi) ──────────────────────────────
  const sendJobShot = async (
    s: Session,
    caption: string,
    o: { forceReply?: boolean; buttons?: InlineButton[][]; always?: boolean } = {}
  ): Promise<number | undefined> => {
    if (!s.accountId) return undefined;
    const job = await deps.latestRegisterJob(s.accountId);
    if (!job) return undefined;
    if (!o.always && s.sentShotJobs.includes(job.id)) return undefined;
    if (!o.always) { s.sentShotJobs.push(job.id); dirty = true; }
    const shot = lastShot(job.result);
    const photoOpts = { ...(o.forceReply ? { forceReply: true } : {}), ...(o.buttons ? { buttons: o.buttons } : {}) };
    if (!shot) return deps.send(s.token, s.chatId, `${caption}\n<i>(ekran görüntüsü alınamadı)</i>`, o.buttons);
    return deps.sendPhoto(s.token, s.chatId, shot.png, `${caption}\n<i>📷 ${esc(shot.label)}</i>`, photoOpts);
  };

  // ── Cihaz seçimi ───────────────────────────────────────────────────────────
  const findIdleDevice = async (s: Session): Promise<{ id: string; name: string } | null> => {
    const reserved = [...sessions.values()].filter((x) => x.id !== s.id && !FINAL.has(x.phase) && x.deviceId).map((x) => x.deviceId!);
    const occupied = await deps.occupiedDeviceIds(s.workspaceId);
    for (let guard = 0; guard < 20; guard++) {
      const exclude = [...new Set([...reserved, ...s.excludedDevices, ...occupied])];
      const candidates = await deps.onlineDevices(s.workspaceId, exclude);
      const usable = candidates.filter((d) => {
        if (exclude.includes(d.id)) return false;
        const m = (d.metadata ?? {}) as Record<string, unknown>;
        if (typeof m.instance !== 'string' || !m.instance) return false;       // Waydroid değil
        if (m.provisionStatus && m.provisionStatus !== 'READY') return false;    // kurulumu bitmemiş
        if (m.waRegisterStatus === 'REGISTERING') return false;                  // üzerinde kayıt sürüyor
        return true;
      });
      if (!usable.length) return null;
      const pick = usable.find((d) => ((d.metadata ?? {}) as Record<string, unknown>).proxyCountry === s.country) ?? usable[0]!;
      if ((await deps.busyJobCount(pick.id).catch(() => 0)) > 0) {   // bekleyen/çalışan iş var → başka cihaz
        s.excludedDevices.push(pick.id);
        continue;
      }
      return { id: pick.id, name: pick.name };
    }
    return null;
  };

  // ── Oturumu bir adım ilerlet ───────────────────────────────────────────────
  const advance = async (s: Session): Promise<void> => {
    const now = deps.now();
    switch (s.phase) {
      case 'finding_device':
      case 'waiting_capacity': {
        if (s.phase === 'waiting_capacity') {
          if (now - s.phaseSince > LIMITS.CAPACITY_GIVE_UP_MS) {
            await failAlert(s, 'Sunucu 1 saat boyunca dolu kaldı; yeni cihaz açılamadı.', 'Birkaç cihazı silin/uyutun, sonra 🔁 Baştan dene.');
            return;
          }
          if (s.lastCapacityTry && now - s.lastCapacityTry < LIMITS.CAPACITY_RETRY_MS) return;
        }
        s.lastCapacityTry = now;
        const idle = await findIdleDevice(s);
        if (idle) {
          s.deviceId = idle.id; s.deviceName = idle.name; s.newDevice = false;
          setPhase(s, 'starting', 'Boşta cihaz bulundu.');
          return;
        }
        try {
          const res = await deps.createInstance(s.country, s.workspaceId);
          s.provisionJobId = res.jobId; s.deviceId = res.deviceId; s.deviceName = res.name; s.newDevice = true;
          setPhase(s, 'provisioning', '');
        } catch (e) {
          const code = errCode(e);
          if (code === 'HOST_CAPACITY_EXHAUSTED' || code === 'NO_INSTANCE_SLOT') {
            const first = s.phase !== 'waiting_capacity';
            setPhase(s, 'waiting_capacity', errMsg(e));
            // Toplu kayıtta aynı uyarının her numara için tekrarlanmasını önle.
            const alreadyWarned = s.capacityWarned || (!!s.batchId && [...sessions.values()].some((x) => x.batchId === s.batchId && x.capacityWarned));
            if (first && !alreadyWarned) {
              s.capacityWarned = true;
              await deps.send(s.token, s.chatId,
                `⚠️ <b>Kapasite uyarısı</b>\n${esc(errMsg(e))}\n\nKayıtlar sırada bekletiliyor; yer açılınca otomatik devam eder (${Math.round(LIMITS.CAPACITY_RETRY_MS / 60_000)} dk'da bir denenir).`);
            }
            return;
          }
          await failAlert(s, `Cihaz açılamadı: ${errMsg(e)}`, '🔁 Baştan dene; tekrarlarsa /tani ile sistemi kontrol edin.');
        }
        return;
      }

      case 'provisioning': {
        if (!s.provisionJobId) { setPhase(s, 'failed', 'Kurulum işi kaybolmuş.'); return; }
        const st = await deps.provisionStatus(s.provisionJobId, s.workspaceId).catch(() => null);
        if (!st) return;
        if (st.phase === 'ready') { setPhase(s, 'starting', 'Cihaz hazır.'); return; }
        if (st.phase === 'failed') { await failAlert(s, `Cihaz kurulumu başarısız: ${st.error ?? 'bilinmeyen hata'}`, '🔁 Baştan dene (yeni cihaz açılır).'); return; }
        if (now - s.phaseSince > LIMITS.PROVISION_TIMEOUT_MS) await failAlert(s, 'Cihaz kurulumu 15 dakikayı aştı.', '🔁 Baştan dene; tekrarlarsa /tani.');
        return;
      }

      case 'starting': {
        if (!s.deviceId) { setPhase(s, 'finding_device'); return; }
        try {
          const r = await deps.startRegister(s.workspaceId, s.deviceId, `+${s.phone}`, s.name ?? undefined);
          s.accountId = r.accountId;
          setPhase(s, 'registering', '');
        } catch (e) {
          const code = errCode(e);
          if (code === 'DEVICE_HAS_ACTIVE_WHATSAPP') {
            // "Boşta" sandığımız cihazda canlı hesap çıktı — ona DOKUNMA, başka cihaz ara.
            s.excludedDevices.push(s.deviceId);
            s.deviceId = undefined; s.deviceName = undefined; s.newDevice = undefined;
            setPhase(s, 'finding_device', 'Seçilen cihazda aktif hesap vardı; başka cihaz aranıyor.');
            return;
          }
          if ((code === 'DEVICE_BUSY' || code === 'DEVICE_OFFLINE' || code === 'HOST_STALE') && now - s.phaseSince < LIMITS.START_RETRY_WINDOW_MS) {
            s.note = `Cihaz henüz hazır değil (${errMsg(e)}) — yeniden deneniyor.`;
            dirty = true;
            return;
          }
          await failAlert(s, `Kayıt başlatılamadı: ${errMsg(e)}`, '🔁 Baştan dene.');
        }
        return;
      }

      case 'registering':
      case 'verifying':
      case 'awaiting_otp':
      case 'awaiting_method': {
        if (!s.accountId) { setPhase(s, 'failed', 'Hesap kaydı kaybolmuş.'); return; }
        const st = await deps.registerStatus(s.accountId, s.workspaceId).catch(() => null);
        if (!st) return;
        const retryRow: InlineButton[][] = [[{ text: '🔁 Tekrar dene', callback_data: `wr:r:${s.id}` }]];
        const timeoutCard = () => card(s, '⌛ <b>ZAMAN AŞIMI</b>',
          ['Kayıt 12 dakikadır ilerlemiyor.'], '👉 Ne yapmalı: 🔁 Tekrar dene\'ye basın ya da paneldeki canlı ekrandan bakın.');

        // İş hâlâ kuyrukta/çalışıyorsa sonucu YORUMLAMA: yeni iş başlarken hesap bir süre ESKİ
        // durumda (AWAITING_OTP, eski otpChannel) kalır; o anda okunursa bayat istem giderdi.
        if (st.status !== 'ACTIVE') {
          const job = await deps.latestRegisterJob(s.accountId);
          if (job && (job.status === 'PENDING' || job.status === 'RUNNING')) {
            if (s.phase === 'awaiting_otp' || s.phase === 'awaiting_method') setPhase(s, 'verifying');
            if (now - s.phaseSince > LIMITS.REGISTER_TIMEOUT_MS) {
              setPhase(s, 'failed', 'Kayıt 12 dakikadır ilerlemiyor (zaman aşımı).');
              await sendJobShot(s, timeoutCard(), { always: true, buttons: retryRow });
            }
            return;
          }
        }

        if (st.status === 'ACTIVE') {
          setPhase(s, 'done', '');
          await sendJobShot(s, card(s, '✅ <b>HESAP AÇILDI</b>', [`Toplam süre ${fmtDuration(now - s.createdAt)}.`]), { always: true });
          return;
        }
        if (['FAILED', 'BANNED', 'RESTRICTED', 'LOGGED_OUT', 'AWAITING_MANUAL'].includes(st.status)) {
          // ★CANLI (26 Eyl, operatör testi): yanık numarada hesap `FAILED` olur, yasak bilgisi
          // `wallKind: 'BAN'` ve hata metnindeki [YASAKLI] işaretindedir — yalnız BANNED'e bakmak
          // yanık numaraya "Tekrar dene" sunuyordu (yanık numarayı yeniden denemek = asıl ban sürücüsü).
          const banned = st.status === 'BANNED' || st.wallKind === 'BAN' || /\[YASAKLI\]|NUMARA\/HESAP YASAKLI/.test(`${st.note ?? ''} ${st.action ?? ''}`);
          if (banned) s.banned = true;
          const manual = st.status === 'AWAITING_MANUAL';
          const what = [manual ? 'Kayıt elle müdahale gerektiren bir ekranda durdu.' : '', st.note].filter(Boolean).join('\n') || `Durum: ${st.status}`;
          const todo = banned
            ? '⛔ Numara yanmış görünüyor — bu numarayla TEKRAR DENEMEYİN.'
            : manual
              ? 'Paneldeki canlı ekrandan bakıp elle devam edin ya da 🔁 Tekrar dene.'
              : (st.action ?? '🔁 Tekrar dene\'ye basın (yeni çıkış IP\'siyle yeniden dener).');
          setPhase(s, 'failed', [what, st.action].filter(Boolean).join('\n'));
          await sendJobShot(s, card(s, '❌ <b>KAYIT DURDU — HATA</b>', [`<b>Ne oldu:</b> ${esc(what.slice(0, 400))}`], `👉 <b>Ne yapmalı:</b> ${esc(todo.slice(0, 250))}`),
            { always: true, ...(banned ? {} : { buttons: retryRow }) });
          return;
        }
        if (st.otpChannel === 'rate_limited') {
          const until = st.waitUntil ? clock(new Date(st.waitUntil).getTime()) : null;
          const what = st.note || 'WhatsApp şu an SMS göndermiyor (bekletme cezası).';
          const reason = [what, st.action, until ? `Bekleme bitişi: ${until}` : ''].filter(Boolean).join('\n');
          setPhase(s, 'failed', reason);
          await sendJobShot(s, card(s, '⏳ <b>WHATSAPP BEKLETİYOR</b>',
            [`<b>Ne oldu:</b> ${esc(what.slice(0, 300))}`, ...(until ? [`🕐 Bekleme bitişi: <b>${esc(until)}</b>`] : [])],
            `👉 <b>Ne yapmalı:</b> ${esc((st.action ?? 'Süre dolunca 🔁 Tekrar dene\'ye basın.').slice(0, 250))}`),
            { always: true, buttons: retryRow });
          return;
        }
        if (st.awaitingMethod) {
          if (s.phase !== 'awaiting_method') {
            setPhase(s, 'awaiting_method');
            await sendJobShot(s, card(s, '🔀 <b>DOĞRULAMA YÖNTEMİ SEÇİN</b>', ['WhatsApp kodu nasıl göndereceğini soruyor.'], '👉 Aşağıdan birini seçin.'),
              { buttons: methodButtons(s) });
          }
          return;
        }
        if (st.awaitingOtp) {
          const job = await deps.latestRegisterJob(s.accountId);
          const newPrompt = !!job && !s.sentShotJobs.includes(job.id);
          if (s.phase !== 'awaiting_otp' || newPrompt) {
            setPhase(s, 'awaiting_otp');
            // ★YANLIŞ CİHAZA KOD GİTMESİN: force_reply Telegram'ın yanıt kutusunu EN SON gelen
            // isteme kilitler. Aynı anda iki cihaz kod bekliyorsa operatör birincinin kodunu
            // yazarken kutu ikinciye bağlı olabilir → kod YANLIŞ cihaza gider. Bu yüzden
            // otomatik yanıt modu YALNIZ tek cihaz beklerken açılır; aksi hâlde operatör
            // ilgili ekran görüntüsünü sağa kaydırıp yanıtlar (kimlik kartı hangisi olduğunu söyler).
            const othersWaiting = [...sessions.values()].some((x) => x.id !== s.id && x.chatId === s.chatId && x.phase === 'awaiting_otp');
            const body = [
              ...(st.otpRejected ? ['❌ <b>Önceki kod REDDEDİLDİ</b> — doğru kodu yazın.'] : []),
              ...(st.note ? [`<i>${esc(String(st.note).slice(0, 250))}</i>`] : [])
            ];
            const how = othersWaiting
              ? `👉 Bu mesajı <b>SAĞA KAYDIRIP yanıtlayın</b> ve kodu yazın.\n⚠️ Şu an birden fazla cihaz kod bekliyor — kodu <b>bu numaranın</b> mesajına yanıtlayın.`
              : '👉 Kodu yazıp gönderin (yanıt modu açık) ya da bu mesajı sağa kaydırıp yanıtlayın.';
            const id = await sendJobShot(s, card(s, '🔑 <b>KOD BEKLENİYOR</b>', body, how), othersWaiting ? {} : { forceReply: true });
            if (id) { s.otpPromptMsgIds.push(id); dirty = true; }
          }
          return;
        }
        if (s.phase === 'awaiting_otp' || s.phase === 'awaiting_method') setPhase(s, 'verifying');
        if (now - s.phaseSince > LIMITS.REGISTER_TIMEOUT_MS) {
          setPhase(s, 'failed', 'Kayıt 12 dakikadır ilerlemiyor (zaman aşımı).');
          await sendJobShot(s, timeoutCard(), { always: true, buttons: retryRow });
        }
        return;
      }
      default:
        return;
    }
  };

  // ── Toplu özet mesajı ──────────────────────────────────────────────────────
  const PHASE_ICON: Record<Phase, string> = {
    queued: '⏳', finding_device: '🔎', waiting_capacity: '⚠️', provisioning: '🛠', starting: '🚀',
    registering: '📍', awaiting_method: '🔀', awaiting_otp: '🔑', verifying: '🔄', done: '✅', failed: '❌', cancelled: '🛑'
  };
  const PHASE_LABEL: Record<Phase, string> = {
    queued: 'sırada', finding_device: 'cihaz aranıyor', waiting_capacity: 'kapasite bekliyor', provisioning: 'cihaz kuruluyor',
    starting: 'başlatılıyor', registering: 'kayıt sürüyor', awaiting_method: 'YÖNTEM SEÇİN', awaiting_otp: 'KOD BEKLİYOR',
    verifying: 'doğrulanıyor', done: 'tamam', failed: 'başarısız', cancelled: 'iptal'
  };

  const renderBatch = (b: Batch): { text: string; buttons: InlineButton[][] } => {
    const list = b.sessionIds.map((id) => sessions.get(id)).filter((x): x is Session => !!x);
    const count = (pred: (s: Session) => boolean) => list.filter(pred).length;
    const done = count((s) => s.phase === 'done');
    const failed = count((s) => s.phase === 'failed');
    const cancelled = count((s) => s.phase === 'cancelled');
    const otp = count((s) => s.phase === 'awaiting_otp' || s.phase === 'awaiting_method');
    const queued = count((s) => s.phase === 'queued');
    const running = list.length - done - failed - cancelled - otp - queued;
    const capacity = list.some((s) => s.phase === 'waiting_capacity');
    const rows = list.map((s) => {
      let extra = '';
      if (s.phase === 'queued') extra = ` (${queuePosition(s)}.)`;
      if (s.deviceName && !FINAL.has(s.phase) && s.phase !== 'queued') extra = ` · ${esc(s.deviceName)}`;
      return `${PHASE_ICON[s.phase]} <code>${esc(fmtPhone(s.phone))}</code> — ${PHASE_LABEL[s.phase]}${extra}`;
    });
    const MAX_ROWS = 60;
    const shown = rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS), `<i>… ve ${rows.length - MAX_ROWS} numara daha (/sira)</i>`] : rows;
    const text = [
      `📦 <b>Toplu kayıt</b> · ${list.length} numara · 👤 ${esc(b.nameLabel)}`,
      '━━━━━━━━━━━━',
      `✅ ${done} tamam · 🔑 ${otp} kod/yöntem · 🔄 ${running} sürüyor · ⏳ ${queued} sırada · ❌ ${failed}${cancelled ? ` · 🛑 ${cancelled}` : ''}`,
      `<i>Aynı anda en fazla ${limit} numara kayıtta (kod bekleyenler dahil).</i>`,
      ...(capacity ? ['⚠️ <b>Sunucu kapasitesi dolu</b> — yer açılınca sıra kendiliğinden devam eder.'] : []),
      ...(otp ? ['🔑 <b>Kod bekleyen var</b> — ilgili ekran görüntüsüne yanıt olarak kodu yazın.'] : []),
      '',
      ...shown
    ].join('\n');
    const buttons: InlineButton[][] = queued ? [[{ text: `🛑 Sıradaki ${queued} numarayı iptal et`, callback_data: `wr:bx:${b.id}` }]] : [];
    return { text, buttons };
  };

  const refreshBatch = async (b: Batch, force = false): Promise<void> => {
    if (b.closed) return;
    const now = deps.now();
    if (!force && b.lastEditAt && now - b.lastEditAt < LIMITS.BATCH_MIN_INTERVAL_MS) return;
    const { text, buttons } = renderBatch(b);
    if (!force && text === b.lastRendered) return;
    b.lastRendered = text;
    b.lastEditAt = now;
    const all = b.sessionIds.map((id) => sessions.get(id)).filter(Boolean) as Session[];
    if (all.length && all.every((s) => FINAL.has(s.phase))) b.closed = true; // son hâl yazıldı, artık dokunma
    if (b.msgId && (await deps.edit(b.token, b.chatId, b.msgId, text, buttons))) { dirty = true; return; }
    const id = await deps.send(b.token, b.chatId, text, buttons);
    if (id) b.msgId = id;
    dirty = true;
  };

  // ── Zamanlayıcı turu ───────────────────────────────────────────────────────
  const promote = (): void => {
    // Kapasite doluyken sıradakileri başlatma: her biri aynı duvara çarpardı.
    if ([...sessions.values()].some((s) => s.phase === 'waiting_capacity')) return;
    let active = activeCount();
    for (const s of queuedSorted()) {
      if (active >= limit) break;
      setPhase(s, 'finding_device');
      active++;
    }
  };

  // Tur zaten sürüyorsa YENİSİNİ başlatma ama sürenin bitmesini BEKLE (boş dönme): böylece
  // "sıraya al → hemen bir tur" gibi çağrılar ve testler, turun gerçekten bittiğini bilir.
  let current: Promise<void> | null = null;
  const tick = (): Promise<void> => {
    if (current) return current;
    current = runTick().finally(() => { current = null; });
    return current;
  };

  const runTick = async (): Promise<void> => {
    if (ticking) return;
    ticking = true;
    try {
      await restore();
      const now = deps.now();
      for (const s of [...sessions.values()]) {
        if (FINAL.has(s.phase) && s.finishedAt && now - s.finishedAt > LIMITS.FINAL_KEEP_MS) { sessions.delete(s.id); dirty = true; }
      }
      for (const b of [...batches.values()]) {
        if (!b.sessionIds.some((id) => sessions.has(id))) { batches.delete(b.id); dirty = true; }
      }
      promote();
      for (const s of [...sessions.values()]) {
        if (FINAL.has(s.phase) && s.liveClosed && s.finishedAt && s.finishedAt < now - 60_000) continue;
        try {
          await advance(s);
        } catch (e) {
          deps.log('warn', 'tg-kayit oturum ilerletilemedi', { id: s.id, phase: s.phase, error: errMsg(e) });
        }
        // Bu turda biri bittiyse yerine sıradaki hemen alınsın (bir tur beklemesin).
        if (FINAL.has(s.phase)) promote();
        await refreshStatus(s).catch(() => undefined);
        await refreshLive(s).catch(() => undefined);
      }
      for (const b of batches.values()) await refreshBatch(b).catch(() => undefined);
      await persist();
    } finally {
      ticking = false;
    }
  };

  // ── Sıraya alma ────────────────────────────────────────────────────────────
  const enqueue = async (ctx: Ctx, entries: Array<{ phone: string; name: string | null }>, nameLabel: string): Promise<void> => {
    const now = deps.now();
    const created: Session[] = [];
    const batch: Batch | null = entries.length > 1
      ? { id: newId((id) => batches.has(id)), token: ctx.token, chatId: ctx.chatId, workspaceId: ctx.workspaceId, sessionIds: [], nameLabel, createdAt: now }
      : null;
    entries.forEach((e, i) => {
      const s: Session = {
        id: newId((id) => sessions.has(id)),
        token: ctx.token, chatId: ctx.chatId, workspaceId: ctx.workspaceId,
        phone: e.phone, name: e.name, country: deps.countryFromPhone(e.phone) ?? 'TR',
        ...(batch ? { batchId: batch.id } : {}),
        phase: 'queued',
        createdAt: now + i, // sıra kararlı olsun
        phaseSince: now,
        excludedDevices: [], sentShotJobs: [], otpPromptMsgIds: []
      };
      sessions.set(s.id, s);
      created.push(s);
      batch?.sessionIds.push(s.id);
    });
    if (batch) batches.set(batch.id, batch);
    dirty = true;
    await deps.send(ctx.token, ctx.chatId,
      `✅ <b>${created.length} numara sıraya alındı.</b>\n` +
      `Aynı anda en fazla <b>${limit}</b> numara kayıtta olur (kod bekleyenler dahil); gerisi sırayla açılır.\n` +
      (batch ? 'Aşağıdaki <b>toplu özet</b> canlı güncellenir; sırası gelen her numara için ayrıca canlı durum + 📺 canlı ekran açılır.\n' : '') +
      'Kod gerektiğinde ekran görüntüsüyle haber veririm — <b>o mesaja yanıt olarak</b> kodu yazmanız yeterli.');
    if (batch) await refreshBatch(batch, true);
    else for (const s of created) await refreshStatus(s, true);
    await persist();
    void tick();
  };

  // ── Numara / isim toplama ──────────────────────────────────────────────────
  const CANCEL_ROW: InlineButton[] = [{ text: '❌ Vazgeç', callback_data: 'wr:c' }];

  const askNumbers = async (ctx: Ctx): Promise<void> => {
    drafts.set(ctx.chatId, { token: ctx.token, workspaceId: ctx.workspaceId, stage: 'numbers', entries: [], idx: 0 });
    await deps.send(ctx.token, ctx.chatId,
      '📲 <b>Otomatik WhatsApp Kaydı</b>\n\n' +
      'Numarayı <b>ülke koduyla</b> yazın (örn. <code>+90 555 111 22 33</code>).\n' +
      `Toplu kayıt için <b>her satıra bir numara</b> yazın (en fazla ${LIMITS.MAX_NUMBERS_PER_REQUEST}).\n` +
      'İsterseniz numaranın yanına isim de yazabilirsiniz: <code>905551112233 Destek</code>\n\n' +
      `<i>Boşta cihaz varsa o kullanılır, yoksa yeni cihaz açılır. Aynı anda en fazla ${limit} numara kayıtta olur, gerisi sıraya girer.</i>`,
      [CANCEL_ROW]);
  };

  const filterDuplicates = async (workspaceId: string, entries: Entry[]): Promise<{ ok: Entry[]; problems: string[] }> => {
    const problems: string[] = [];
    const live = new Set<string>();
    for (const s of sessions.values()) if (!FINAL.has(s.phase) && s.workspaceId === workspaceId) live.add(s.phone);
    const existing = entries.length
      ? await deps.duplicateAccounts(workspaceId, entries.map((e) => `+${e.phone}`)).catch(() => [])
      : [];
    const existingMap = new Map(existing.map((a) => [String(a.phoneNumber).replace(/\D/g, ''), String(a.status)]));
    const ok: Entry[] = [];
    for (const e of entries) {
      if (live.has(e.phone)) { problems.push(`<code>${esc(fmtPhone(e.phone))}</code> — zaten Telegram sırasında`); continue; }
      const st = existingMap.get(e.phone);
      if (st) { problems.push(`<code>${esc(fmtPhone(e.phone))}</code> — zaten ${st === 'ACTIVE' ? 'aktif hesap' : `işlemde (${st})`}`); continue; }
      ok.push(e);
    }
    return { ok, problems };
  };

  const acceptNumbers = async (ctx: Ctx, text: string): Promise<void> => {
    const parsed = parseEntryLines(text, deps.countryFromPhone);
    const { ok, problems: dup } = await filterDuplicates(ctx.workspaceId, parsed.entries);
    const problems = [...parsed.problems, ...dup];
    const warn = problems.length ? `⚠️ ${problems.slice(0, 30).join('\n⚠️ ')}${problems.length > 30 ? `\n… ve ${problems.length - 30} uyarı daha` : ''}` : '';
    if (!ok.length) {
      drafts.set(ctx.chatId, { token: ctx.token, workspaceId: ctx.workspaceId, stage: 'numbers', entries: [], idx: 0 });
      await deps.send(ctx.token, ctx.chatId, `${warn ? `${warn}\n\n` : ''}❌ Kayda uygun numara yok. Numarayı tekrar yazın ya da vazgeçin.`, [CANCEL_ROW]);
      return;
    }
    // 🧠 Otomatik düzeltmeler SESSİZ değil: operatör neyin nasıl düzeltildiğini görür.
    const fixNote = parsed.fixes.length
      ? `🧠 <b>${parsed.fixes.length} numara otomatik düzeltildi:</b>\n${parsed.fixes.slice(0, 20).join('\n')}${parsed.fixes.length > 20 ? `\n<i>… ve ${parsed.fixes.length - 20} tane daha</i>` : ''}`
      : '';
    const notice = [fixNote, warn].filter(Boolean).join('\n\n');
    if (notice) await deps.send(ctx.token, ctx.chatId, notice);
    const d: Draft = { token: ctx.token, workspaceId: ctx.workspaceId, stage: 'names', entries: ok, idx: 0 };
    drafts.set(ctx.chatId, d);
    const unnamed = ok.filter((e) => e.name === undefined).length;
    if (unnamed === 0) { await finishDraft(ctx, d, 'satır başına'); return; }
    if (ok.length === 1) { await askNextName(ctx, d); return; }
    d.stage = 'naming_choice';
    const named = ok.length - unnamed;
    await deps.send(ctx.token, ctx.chatId,
      `👥 <b>${ok.length} numara</b> alındı${named ? ` (${named} tanesinin ismi satırda yazılı)` : ''}.\n` +
      `İsmi olmayan <b>${unnamed}</b> numara için profil adı ne olsun?`,
      [
        [{ text: '📝 Hepsine aynı isim', callback_data: 'wr:g:same' }, { text: '🎲 Hepsine rastgele', callback_data: 'wr:g:rand' }],
        [{ text: '✏️ Tek tek sor', callback_data: 'wr:g:each' }],
        CANCEL_ROW
      ]);
  };

  const askNextName = async (ctx: Ctx, d: Draft): Promise<void> => {
    while (d.idx < d.entries.length && d.entries[d.idx]!.name !== undefined) d.idx++;
    if (d.idx >= d.entries.length) { await finishDraft(ctx, d, 'tek tek'); return; }
    const e = d.entries[d.idx]!;
    const remaining = d.entries.slice(d.idx).filter((x) => x.name === undefined).length;
    const row: InlineButton[] = [{ text: '🎲 Rastgele isim', callback_data: 'wr:n:r' }];
    if (remaining > 1) row.push({ text: `🎲 Kalan ${remaining} numaraya rastgele`, callback_data: 'wr:n:all' });
    await deps.send(ctx.token, ctx.chatId,
      `👤 <b>${d.idx + 1}/${d.entries.length}</b> · <code>${esc(fmtPhone(e.phone))}</code>\n` +
      `WhatsApp <b>profil adını</b> yazın (en fazla ${LIMITS.NAME_MAX} karakter) ya da rastgele seçin:`,
      [row, CANCEL_ROW]);
  };

  const finishDraft = async (ctx: Ctx, d: Draft, how: string): Promise<void> => {
    const entries = d.entries.map((e) => ({ phone: e.phone, name: e.name ?? null }));
    const names = [...new Set(entries.map((e) => e.name ?? '🎲'))];
    const label = names.length === 1 ? (names[0] === '🎲' ? 'rastgele isim' : names[0]!) : how === 'satır başına' ? 'satır başına isim' : 'karışık isimler';
    if (entries.length === 1) {           // tekli kayıt: isim adımı zaten onay yerine geçer
      drafts.delete(ctx.chatId);
      await enqueue(ctx, entries, label);
      return;
    }
    // ★Toplu kayıt geri alınamaz bir iş başlatır (cihaz açar, numara harcar) → son bir onay.
    d.stage = 'confirm_start';
    d.nameLabel = label;
    const active = activeCount();
    const preview = entries.slice(0, 10).map((e) => `• <code>${esc(fmtPhone(e.phone))}</code> — ${e.name ? esc(e.name) : '<i>rastgele</i>'}`);
    const summary = [
      '📦 <b>Toplu kayıt özeti</b>',
      `• Numara: <b>${entries.length}</b>`,
      `• İsim: <b>${esc(label)}</b>`,
      `• Aynı anda en fazla <b>${limit}</b> numara kayıtta${active ? ` (şu an ${active} kayıt sürüyor)` : ''}; gerisi sırayla açılır`,
      '• Boşta cihaz yoksa yeni cihaz açılır; kapasite dolarsa uyarır ve bekler',
      '',
      ...preview,
      ...(entries.length > 10 ? [`<i>… ve ${entries.length - 10} numara daha</i>`] : []),
      '',
      '<b>Başlatılsın mı?</b>'
    ].join('\n');
    await deps.send(ctx.token, ctx.chatId, summary,
      [[{ text: `✅ Başlat (${entries.length} numara)`, callback_data: 'wr:ok' }], CANCEL_ROW]);
  };

  // Kodu hesaba iletir.
  const submitOtp = async (s: Session, rawCode: string): Promise<void> => {
    // 🧠 SMS'in tamamı yapıştırılsa bile kod çekilir ("WhatsApp kodunuz: 123-456 …").
    const code = extractOtp(rawCode);
    if (!code) { await deps.send(s.token, s.chatId, '❌ Kod anlaşılamadı — 6 haneli kodu yazın (örn. <code>123456</code>) ya da SMS\'i olduğu gibi yapıştırın.'); return; }
    if (!s.accountId) { await deps.send(s.token, s.chatId, '❌ Bu kayıtta hesap bulunamadı.'); return; }
    try {
      await deps.provideOtp(s.workspaceId, s.accountId, code);
      setPhase(s, 'verifying', '');
      // Kodun HANGİ cihaza gittiği açıkça yazılır — yanlışlık olursa operatör anında görür.
      await deps.send(s.token, s.chatId, card(s, `🔑 <b>KOD GÖNDERİLDİ:</b> <code>${esc(code)}</code>`, ['Cihaz kodu giriyor — sonuç birazdan gelecek.']));
      // İstemi "kod alındı" diye işaretle: aynı mesaja yanlışlıkla ikinci kez yanıt verilmesin.
      const lastPrompt = s.otpPromptMsgIds[s.otpPromptMsgIds.length - 1];
      if (lastPrompt) {
        await deps.editCaption(s.token, s.chatId, lastPrompt,
          card(s, `✅ <b>KOD ALINDI</b> (<code>${esc(code)}</code>) — doğrulanıyor`, [], 'ℹ️ Kod reddedilirse YENİ bir kod mesajı gelir; ona yanıt verin.')).catch(() => undefined);
      }
      await refreshStatus(s, true);
    } catch (e) {
      await deps.send(s.token, s.chatId, `❌ Kod gönderilemedi: ${esc(errMsg(e))}`);
    }
  };

  const renderQueue = async (ctx: Ctx): Promise<void> => {
    const list = sessionsFor(ctx.chatId).sort((a, b) => a.createdAt - b.createdAt);
    if (!list.length) {
      await deps.send(ctx.token, ctx.chatId, `📋 Telegram kayıt sırası boş. (Eşzamanlı sınır: ${limit})\nYeni kayıt için /wakayit ya da numarayı doğrudan yazın.`);
      return;
    }
    const rows = list.map((s) => `${PHASE_ICON[s.phase]} <code>${esc(fmtPhone(s.phone))}</code> — ${PHASE_LABEL[s.phase]}${s.deviceName ? ` · ${esc(s.deviceName)}` : ''}`);
    const act = list.filter((s) => s.phase !== 'queued' && !FINAL.has(s.phase)).length;
    await deps.send(ctx.token, ctx.chatId, `📋 <b>Telegram kayıt sırası</b> (${list.length}) · kayıtta ${act}/${limit}\n${rows.join('\n')}`);
  };

  // ── Dışa açık arayüz ───────────────────────────────────────────────────────
  const api = {
    commands: [
      { command: 'wakayit', description: '📲 Numara ile otomatik WhatsApp kaydı (tekli/toplu, cihaz açar, kodu sorar)' },
      { command: 'kod', description: '🔑 Kayıt kodunu gir — /kod 123456' },
      { command: 'sira', description: '📋 Telegram kayıt sırası ve durumları' },
      { command: 'kayitlimit', description: '⚙️ Aynı anda kaç kayıt yürüsün — /kayitlimit 4' }
    ],

    tick,
    restore,

    cancelDraft(chatId: string): void { drafts.delete(chatId); },

    /** Metin mesajı. true → burada tüketildi. chatIdle: botun başka adım-adım akışı açık DEĞİL. */
    async handleText(ctx: Ctx, text: string, chatIdle: boolean): Promise<boolean> {
      await restore();
      const cmd = text.trim();
      const lower = cmd.toLowerCase().replace(/^(\/\w+)@\w+/, '$1');
      const draft = drafts.get(ctx.chatId);

      if (lower === '/wakayit' || lower.startsWith('/wakayit ') || lower.startsWith('/wakayit\n')) {
        const rest = cmd.replace(/^\/wakayit(@\w+)?/i, '').trim();
        if (rest) await acceptNumbers(ctx, rest); else await askNumbers(ctx);
        return true;
      }
      if (lower === '/sira') { await renderQueue(ctx); return true; }
      if (lower === '/kayitlimit' || lower.startsWith('/kayitlimit ')) {
        const n = parseInt(cmd.replace(/\D/g, ''), 10);
        if (!n) {
          await deps.send(ctx.token, ctx.chatId, `⚙️ Aynı anda en fazla <b>${limit}</b> numara kayıtta. Değiştirmek için: <code>/kayitlimit 5</code> (${LIMITS.MIN_CONCURRENCY}-${LIMITS.MAX_CONCURRENCY})`);
          return true;
        }
        const old = limit;
        limit = clampLimit(n);
        dirty = true;
        await persist();
        await deps.send(ctx.token, ctx.chatId, `⚙️ Eşzamanlı kayıt sınırı <b>${old} → ${limit}</b>.${n !== limit ? ` <i>(izin verilen aralık ${LIMITS.MIN_CONCURRENCY}-${LIMITS.MAX_CONCURRENCY})</i>` : ''}`);
        void tick();
        return true;
      }
      if (lower === '/kod' || lower.startsWith('/kod ')) {
        const rest = cmd.replace(/^\/kod(@\w+)?/i, '').trim();
        const waiting = sessionsFor(ctx.chatId).filter((s) => s.phase === 'awaiting_otp');
        if (!rest) {
          await deps.send(ctx.token, ctx.chatId, waiting.length
            ? `🔑 Kod bekleyen ${waiting.length} kayıt var. Kodu ilgili ekran görüntüsüne <b>yanıt olarak</b> yazın ya da <code>/kod 123456</code> kullanın.`
            : 'Şu an kod bekleyen Telegram kaydı yok.');
          return true;
        }
        const tokens = rest.split(/\s+/);
        let target: Session | undefined;
        let code = rest;
        if (tokens.length >= 2) {
          const pp = parsePhoneLine(tokens.slice(0, -1).join(' '), deps.countryFromPhone);
          if (!('error' in pp)) { target = waiting.find((s) => s.phone === pp.digits); code = tokens[tokens.length - 1]!; }
        }
        if (!target) {
          if (waiting.length === 1) target = waiting[0];
          else {
            await deps.send(ctx.token, ctx.chatId, waiting.length
              ? `⚠️ ${waiting.length} kayıt kod bekliyor — hangisi olduğunu belirtin: <code>/kod +90555… 123456</code> ya da ilgili ekran görüntüsüne yanıt verin.`
              : 'Şu an kod bekleyen Telegram kaydı yok.');
            return true;
          }
        }
        await submitOtp(target!, code);
        return true;
      }

      // Botun başka bir akışı açıkken hiçbir şeye dokunma (o akışın girdisini çalmayalım).
      if (!chatIdle) { if (draft) drafts.delete(ctx.chatId); return false; }

      if (draft) {
        if (cmd.startsWith('/')) { drafts.delete(ctx.chatId); return false; }
        if (/^(iptal|vazgec|vazgeç|cancel)$/i.test(cmd)) {
          drafts.delete(ctx.chatId);
          await deps.send(ctx.token, ctx.chatId, '↩️ WhatsApp kaydı iptal edildi.');
          return true;
        }
        if (draft.stage === 'numbers') { await acceptNumbers(ctx, cmd); return true; }
        if (draft.stage === 'confirm_shortcut' || draft.stage === 'confirm_start') {
          await deps.send(ctx.token, ctx.chatId, 'ℹ️ Lütfen yukarıdaki <b>✅ Başlat / Evet</b> ya da <b>❌ Vazgeç</b> butonuna basın.');
          return true;
        }
        if (draft.stage === 'naming_choice') {
          await deps.send(ctx.token, ctx.chatId, 'ℹ️ Lütfen yukarıdaki butonlardan birini seçin (📝 Hepsine aynı isim / 🎲 Rastgele / ✏️ Tek tek).');
          return true;
        }
        const name = cleanName(cmd);
        if (!name) {
          await deps.send(ctx.token, ctx.chatId, `❌ İsim 1-${LIMITS.NAME_MAX} karakter olmalı (yalnız rakam olamaz). Tekrar yazın.`);
          return true;
        }
        if (draft.stage === 'group_name') {
          for (const e of draft.entries) if (e.name === undefined) e.name = name;
          await finishDraft(ctx, draft, 'hepsine aynı');
          return true;
        }
        draft.entries[draft.idx]!.name = name;
        draft.idx++;
        await askNextName(ctx, draft);
        return true;
      }

      // Akış açık değilken yalnız numara(lar)dan oluşan mesaj → ÖNCE SOR. Komutsuz bir mesajla
      // (ör. "905551112233 Merhaba") habersizce cihaz açıp numara harcamak kabul edilemez.
      if (looksLikeNumberList(cmd, deps.countryFromPhone)) {
        const n = parseEntryLines(cmd, deps.countryFromPhone).entries.length;
        drafts.set(ctx.chatId, { token: ctx.token, workspaceId: ctx.workspaceId, stage: 'confirm_shortcut', entries: [], idx: 0, raw: cmd });
        await deps.send(ctx.token, ctx.chatId,
          `📲 <b>${n || 'Bu'} numara</b> için WhatsApp kaydı başlatılsın mı?`,
          [[{ text: '✅ Evet, kaydet', callback_data: 'wr:y' }, { text: '❌ Hayır', callback_data: 'wr:c' }]]);
        return true;
      }

      // Tek kod bekleyen kayıt varken çıplak 4-8 haneli sayı → o kaydın kodu.
      if (normalizeOtpInput(cmd) && cmd.replace(/\D/g, '').length <= 8) {
        const waiting = sessionsFor(ctx.chatId).filter((s) => s.phase === 'awaiting_otp');
        if (waiting.length === 1) { await submitOtp(waiting[0]!, cmd); return true; }
        if (waiting.length > 1) {
          await deps.send(ctx.token, ctx.chatId, `⚠️ ${waiting.length} kayıt kod bekliyor — kodu ilgili <b>ekran görüntüsüne yanıt olarak</b> yazın.`);
          return true;
        }
      }
      return false;
    },

    /** Bir bot mesajına verilen yanıt (OTP istemine kod). true → tüketildi. */
    async handleReply(ctx: Ctx, replyTo: { message_id: number; text?: string; caption?: string }, text: string): Promise<boolean> {
      await restore();
      // Yanıt bir kod değilse HİÇ dokunma: normal akış işlesin.
      if (!extractOtp(text)) return false;
      let target = sessionsFor(ctx.chatId).find((s) => s.otpPromptMsgIds.includes(replyTo.message_id) || s.statusMsgId === replyTo.message_id || s.liveMsgId === replyTo.message_id);
      if (!target) {
        const body = `${replyTo.caption ?? ''} ${replyTo.text ?? ''}`;
        // Yalnız KOD İSTEMİ kartlarına verilen yanıtlar (kimlik kartı başlığı: "🔑 KOD BEKLENİYOR").
        if (!/KOD BEKLEN[İI]YOR/i.test(body)) return false;
        const m = /\+[\d\s]{10,20}/.exec(body);
        const digits = m ? m[0].replace(/\D/g, '') : '';
        if (digits) target = sessionsFor(ctx.chatId).find((s) => s.phone === digits && !FINAL.has(s.phase));
        if (!target && digits) {
          // Oturum hiç yoksa (ör. eski mesaj, bellek kaybı): DB'den kod bekleyen hesabı bul.
          const acc = await deps.findAwaitingAccountByPhone(ctx.workspaceId, `+${digits}`).catch(() => null);
          if (acc) {
            const now = deps.now();
            target = {
              id: newId((id) => sessions.has(id)), token: ctx.token, chatId: ctx.chatId, workspaceId: ctx.workspaceId,
              phone: digits, name: null, country: deps.countryFromPhone(digits) ?? 'TR', phase: 'awaiting_otp',
              createdAt: now, phaseSince: now, accountId: acc.id, deviceId: acc.deviceId ?? undefined,
              excludedDevices: [], sentShotJobs: [], otpPromptMsgIds: [replyTo.message_id]
            };
            sessions.set(target.id, target);
            dirty = true;
          }
        }
      }
      if (!target) return false;
      if (target.phase !== 'awaiting_otp') {
        await deps.send(ctx.token, ctx.chatId, `ℹ️ <code>${esc(fmtPhone(target.phone))}</code> şu an kod beklemiyor (durum: ${PHASE_LABEL[target.phase]}).`);
        return true;
      }
      await submitOtp(target, text);
      return true;
    },

    /** "wr:" ile başlayan butonlar. */
    async handleCallback(ctx: Ctx, data: string): Promise<void> {
      await restore();
      const [, action, sid, arg] = data.split(':');
      if (action === 'new') { await askNumbers(ctx); return; }
      if (action === 'list') { await renderQueue(ctx); return; }
      if (action === 'c') { drafts.delete(ctx.chatId); await deps.send(ctx.token, ctx.chatId, '↩️ WhatsApp kaydı iptal edildi.'); return; }
      if (action === 'y') {
        const d = drafts.get(ctx.chatId);
        if (!d || d.stage !== 'confirm_shortcut' || !d.raw) { await deps.send(ctx.token, ctx.chatId, 'ℹ️ Bu onay artık geçerli değil. /wakayit ile yeniden başlayın.'); return; }
        await acceptNumbers(ctx, d.raw);
        return;
      }
      if (action === 'ok') {
        const d = drafts.get(ctx.chatId);
        if (!d || d.stage !== 'confirm_start') { await deps.send(ctx.token, ctx.chatId, 'ℹ️ Bu onay artık geçerli değil (zaten başlatılmış ya da iptal edilmiş olabilir).'); return; }
        drafts.delete(ctx.chatId); // çift basışa karşı ÖNCE sil
        await enqueue(ctx, d.entries.map((e) => ({ phone: e.phone, name: e.name ?? null })), d.nameLabel ?? 'isim');
        return;
      }
      if (action === 'g') {
        const d = drafts.get(ctx.chatId);
        if (!d || d.stage !== 'naming_choice') { await deps.send(ctx.token, ctx.chatId, 'ℹ️ Bu adım artık geçerli değil. /wakayit ile yeniden başlayın.'); return; }
        if (sid === 'rand') { for (const e of d.entries) if (e.name === undefined) e.name = null; await finishDraft(ctx, d, 'rastgele'); return; }
        if (sid === 'same') {
          d.stage = 'group_name';
          await deps.send(ctx.token, ctx.chatId, `📝 Tüm numaralara verilecek <b>profil adını</b> yazın (en fazla ${LIMITS.NAME_MAX} karakter), örn. <code>Destek</code>:`, [CANCEL_ROW]);
          return;
        }
        if (sid === 'each') { d.stage = 'names'; d.idx = 0; await askNextName(ctx, d); return; }
        return;
      }
      if (action === 'n') {
        const d = drafts.get(ctx.chatId);
        if (!d || d.stage !== 'names') { await deps.send(ctx.token, ctx.chatId, 'ℹ️ Bu adım artık geçerli değil. /wakayit ile yeniden başlayın.'); return; }
        if (sid === 'all') { for (const e of d.entries) if (e.name === undefined) e.name = null; await finishDraft(ctx, d, 'tek tek'); return; }
        d.entries[d.idx]!.name = null;
        d.idx++;
        await askNextName(ctx, d);
        return;
      }
      if (action === 'bx') {
        const b = sid ? batches.get(sid) : undefined;
        if (!b || b.chatId !== ctx.chatId) return;
        let n = 0;
        for (const id of b.sessionIds) {
          const s = sessions.get(id);
          if (s && s.phase === 'queued') { setPhase(s, 'cancelled', 'Toplu iptal (sırada bekliyordu).'); n++; }
        }
        await deps.send(ctx.token, ctx.chatId, `🛑 Sıradaki <b>${n}</b> numara iptal edildi. Şu an kayıtta olanlar devam ediyor.`);
        await refreshBatch(b, true);
        await persist();
        return;
      }
      const s = sid ? sessions.get(sid) : undefined;
      if (!s || s.chatId !== ctx.chatId) {
        await deps.send(ctx.token, ctx.chatId, 'ℹ️ Bu kayıt artık takipte değil (süresi dolmuş olabilir). Yarım kalanlar için /kayit.');
        return;
      }
      switch (action) {
        case 's': {
          const id = await sendJobShot(s, `📷 <code>${esc(fmtPhone(s.phone))}</code> — son kaydedilen ekran`, { always: true });
          if (!id) await deps.send(ctx.token, ctx.chatId, 'ℹ️ Henüz ekran görüntüsü yok (kayıt başlamadı).');
          return;
        }
        case 'm': {
          if (!s.accountId || !arg || !['sms', 'voice', 'missed_call'].includes(arg)) return;
          try {
            await deps.provideMethod(s.workspaceId, s.accountId, arg);
            setPhase(s, 'verifying', '');
            await deps.send(ctx.token, ctx.chatId, `✅ Yöntem seçildi — cihaz devam ediyor.`);
          } catch (e) {
            await deps.send(ctx.token, ctx.chatId, `❌ Yöntem seçilemedi: ${esc(errMsg(e))}`);
          }
          await refreshStatus(s, true);
          return;
        }
        case 'r': {
          if (!s.accountId) return;
          if (s.banned) { // eski bir mesajdaki butona basılsa bile yanık numara yeniden denenmez
            await deps.send(ctx.token, ctx.chatId, `⛔ <code>${esc(fmtPhone(s.phone))}</code> yanık — WhatsApp kalıcı olarak reddetti. Tekrar denemek numarayı daha da yakar; yeni numara girin.`);
            return;
          }
          try {
            await deps.retryRegister(s.workspaceId, s.accountId);
            s.liveClosed = false; s.liveShotTs = undefined;
            setPhase(s, 'registering', '');
            await deps.send(ctx.token, ctx.chatId, `🔁 <code>${esc(fmtPhone(s.phone))}</code> yeni çıkış IP'siyle yeniden deneniyor.`);
          } catch (e) {
            await deps.send(ctx.token, ctx.chatId, `❌ Tekrar denenemedi: ${esc(errMsg(e))}`);
          }
          await refreshStatus(s, true);
          return;
        }
        case 'q': {
          if (s.accountId || !FINAL.has(s.phase)) return;
          setPhase(s, 'cancelled', 'Yeniden sıraya alındı.');
          await enqueue(ctx, [{ phone: s.phone, name: s.name }], s.name ?? 'rastgele isim');
          return;
        }
        case 'x': {
          if (FINAL.has(s.phase)) return;
          if (s.accountId) await deps.cancelAccount(s.workspaceId, s.accountId).catch(() => undefined);
          const note = s.phase === 'provisioning' ? 'Cihaz kurulumu arka planda tamamlanacak; bitince boşta cihaz olarak kullanılabilir.' : '';
          setPhase(s, 'cancelled', note);
          await refreshStatus(s, true);
          await persist();
          void tick(); // boşalan yuvaya sıradaki alınsın
          return;
        }
        default:
          return;
      }
    },

    renderQueue,

    /** Yalnız testler için: iç durumun salt-okunur görünümü. */
    _inspect() {
      return {
        sessions: [...sessions.values()],
        batches: [...batches.values()],
        drafts: new Map(drafts),
        limit,
        activeCount: activeCount()
      };
    }
  };
  return api;
}

export type TgRegister = ReturnType<typeof createTgRegister>;
