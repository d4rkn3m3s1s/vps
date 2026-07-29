// Batch account farm — creates many social accounts in one run, each going
// through the provisioning lifecycle:
//   PENDING → IDENTITY_READY → CONTACT_READY → AWAITING_OTP → REGISTERING → ACTIVE
//
// Phase 1 here covers everything UP TO on-device registration: generate a fake
// identity, mint a disposable inbox, rent a phone number, and poll for the OTP.
// The on-device WhatsApp/IG/FB registration (RPA) is wired on top of this.
//
// Secrets (password, OTP) are AES-256-GCM encrypted at rest.

import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertSafePublicUrl } from '../../lib/urlGuard';
import { encryptString, decryptString, safeDecrypt } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { WA_REGISTER_STEPS, waRegisterService } from './wa-register.service';
import { IG_REGISTER_STEPS } from './ig-register.service';
import { autoAttachCountryProxy, autoAttachCountryProxyByCountry } from './auto-proxy';
import { accountsService } from './accounts.service';
import * as fivesim from './providers/fivesim.provider';
import { getWhatsappState, checkWhatsappAccess, EMPTY_WHATSAPP_STATE } from '../devices/whatsappCategory';

type Platform = 'whatsapp' | 'instagram' | 'facebook';
type SmsProvider = 'sms-bus' | '5sim';

// 5sim uses lowercase country slugs, tried cheap/reliable-first for WhatsApp.
// Only used when provider === '5sim' (needs FIVESIM_API_KEY). sms-bus's public
// WhatsApp numbers are burned (never deliver), so 5sim is the working path.
const WA_5SIM_COUNTRIES = ['usa', 'england', 'canada', 'netherlands', 'poland', 'indonesia'];
function fivesimCfg(): fivesim.FiveSimConfig {
  return {
    apiKey: process.env.FIVESIM_API_KEY || '',
    ...(process.env.FIVESIM_BASE_URL ? { baseUrl: process.env.FIVESIM_BASE_URL } : {})
  };
}

// WhatsApp numbers on sms-bus, tried in order until one yields a number. Ordered
// by OTP-delivery reliability for WhatsApp first, then cheap fallbacks — sms-bus
// exposes no price/stock endpoint, so we just try and use the first that returns
// a number. USA/Bangladesh reliably have stock + deliver the WA code; Turkey was
// observed to take the number but NOT receive the OTP (dead for WhatsApp), so it
// sits last. Verified country ids from /list/countries.
const WHATSAPP_CHEAP_COUNTRIES: Array<{ id: number; code: string; cc: string }> = [
  { id: 5, code: 'us', cc: '1' },    // USA — most reliable WA OTP delivery
  { id: 8, code: 'bd', cc: '880' },  // Bangladesh — has stock + delivers
  { id: 7, code: 'id', cc: '62' },   // Indonesia
  { id: 22, code: 'in', cc: '91' },  // India
  { id: 53, code: 'ph', cc: '63' },  // Philippines
  { id: 70, code: 'vn', cc: '84' },  // Vietnam
  { id: 195, code: 'tr', cc: '90' }  // Turkey — LAST (takes number, no WA OTP)
];

// (Calling-code → ISO mapping lives in auto-proxy.ts (countryFromPhone); the
// country-matched proxy auto-assign here routes through autoAttachCountryProxy.)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Guard: the target device must belong to the caller's workspace before we
// dispatch a job to it. A foreign (or missing) device resolves to "not found"
// rather than letting a client-supplied deviceId drive another tenant's phone.
async function assertDeviceInWorkspace(deviceId: string, workspaceId?: string): Promise<void> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true }
  });
  if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
}

// How long a host agent's heartbeat can be stale before we treat it as dead.
// The agent long-polls /agent/jobs/next roughly every few seconds and the host
// heartbeats on a ~60-90s ticker, so 3 min of silence means it's really gone.
const AGENT_STALE_MS = 3 * 60 * 1000;

// Refuse to dispatch on-device work to a device that can't run it RIGHT NOW:
// stopped (OFFLINE), or bound to a host whose agent hasn't checked in recently
// (ADB down / agent crashed / host asleep). Without this the job sits PENDING
// forever and the dashboard spins "yükleniyor" with no error. Callers that drive
// a real device (WhatsApp register/send, RPA, etc.) should call this so the
// operator gets an immediate, honest "device offline" instead of a silent hang.
async function assertDeviceReady(deviceId: string, workspaceId?: string): Promise<void> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true, name: true, status: true, hostId: true, host: { select: { lastSeenAt: true, status: true } } }
  });
  if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');

  // Stopped / errored device — a job would never run.
  if (device.status === 'OFFLINE' || device.status === 'ERROR') {
    throw new AppError(
      `Cihaz "${device.name}" durdurulmuş (${device.status}). Önce cihazı uyandırın, sonra tekrar deneyin.`,
      409,
      'DEVICE_OFFLINE'
    );
  }

  // Bound to a host whose agent is silent → nothing will claim the job.
  if (device.hostId) {
    const last = device.host?.lastSeenAt ? device.host.lastSeenAt.getTime() : 0;
    const stale = !last || Date.now() - last > AGENT_STALE_MS;
    if (stale || device.host?.status === 'OFFLINE') {
      throw new AppError(
        `Cihazın sunucu aracısı yanıt vermiyor (agent/ADB bağlantısı kopmuş olabilir). İş gönderilemedi — aracıyı/cihazı kontrol edin.`,
        409,
        'AGENT_UNREACHABLE'
      );
    }
  }
}

// A strong, mixed-class password for a fresh account (upper/lower/digit/symbol).
function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const b = randomBytes(16);
  // Guarantee at least one of each class, then fill to length 14.
  const chars = sets.map((s, i) => s[b[i]! % s.length]!);
  for (let i = 4; i < 14; i++) chars.push(all[b[i]! % all.length]!);
  return chars.join('');
}

// Map a friendly platform to the SMS provider's project id by matching the
// service title in the provider's project list (cached per call).
async function resolveProjectId(platform: string): Promise<string | null> {
  const projects = await accountsService.smsProjects().catch(() => []);
  const hit = (projects as Array<{ id: string | number; title: string }>).find((p) =>
    (p.title || '').toLowerCase().includes(platform.toLowerCase())
  );
  return hit ? String(hit.id) : null;
}

export class BatchService {
  // Create a batch of N accounts (status PENDING). A batch id groups them.
  async createBatch(
    workspaceId: string | undefined,
    input: { platform: Platform; count: number; countryCode?: string | undefined }
  ) {
    const count = Math.min(50, Math.max(1, input.count));
    const batchId = `batch_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)}`;
    const rows = Array.from({ length: count }, () => ({
      batchId,
      platform: input.platform,
      status: 'PENDING' as const,
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      ...(workspaceId ? { workspaceId } : {})
    }));
    await prisma.generatedAccount.createMany({ data: rows });
    const accounts = await prisma.generatedAccount.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' }
    });
    return { batchId, count, accounts: accounts.map(toPublic) };
  }

  async list(workspaceId: string | undefined, batchId?: string) {
    const accounts = await prisma.generatedAccount.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}), ...(batchId ? { batchId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500
    });
    return accounts.map(toPublic);
  }

  async get(workspaceId: string | undefined, id: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    return toPublic(acc);
  }

  // Provision one account: identity → inbox → number. Advances status and stores
  // the artefacts. OTP is then polled separately (pollOtp). Idempotent-ish: each
  // sub-step is skipped if already done.
  async provision(workspaceId: string | undefined, id: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');

    try {
      const data: Record<string, unknown> = {};

      // 1) Identity (+ a generated account password, stored encrypted)
      if (!acc.firstName) {
        const ident = await accountsService.generateIdentity(acc.countryCode ?? undefined);
        Object.assign(data, {
          firstName: ident.firstName,
          lastName: ident.lastName,
          gender: ident.gender,
          birthDate: ident.birthDate,
          username: ident.username,
          countryCode: ident.countryCode || acc.countryCode,
          status: 'IDENTITY_READY'
        });
        if (!acc.passwordEnc) data.passwordEnc = encryptString(generatePassword());
      }

      // 2) Inbox (seed from username/id)
      if (!acc.emailAddress) {
        const seed = String((data.username as string) || acc.username || acc.id);
        const { address } = accountsService.makeInbox(seed);
        data.emailAddress = address;
        data.status = 'CONTACT_READY';
      }

      // 3) Phone number for the platform
      if (!acc.phoneNumber) {
        const projectId = await resolveProjectId(acc.platform);
        if (!projectId) throw new Error(`${acc.platform} için SMS servisi bulunamadı`);
        // Country: use a numeric provider country id if the account carries one;
        // else fall back to the first available country.
        const countries = await accountsService.smsCountries().catch(() => []);
        const list = countries as Array<{ id: string | number; code: string }>;
        const match =
          list.find((c) => (c.code || '').toUpperCase() === (acc.countryCode ?? '').toUpperCase()) ?? list[0];
        if (!match) throw new Error('SMS sağlayıcısında ülke bulunamadı');
        const rented = await accountsService.smsGetNumber(match.id, projectId);
        data.phoneNumber = rented.number;
        data.smsRequestId = rented.requestId;
        data.status = 'AWAITING_OTP';
        // Persist the rented number's requestId IMMEDIATELY (before any further
        // work) so it is never lost on a later failure — a leaked requestId means
        // a rented number we paid for but can never cancel/reuse. This makes the
        // number recoverable by the catch below (and any reaper).
        await prisma.generatedAccount.update({
          where: { id },
          data: { phoneNumber: rented.number, smsRequestId: rented.requestId }
        });
      }

      data.error = null;
      const updated = await prisma.generatedAccount.update({ where: { id }, data });
      return toPublic(updated);
    } catch (e) {
      // Release any number we rented in this attempt so it isn't paid-for-and-lost.
      const cur = await prisma.generatedAccount.findUnique({ where: { id }, select: { smsRequestId: true } }).catch(() => null);
      if (cur?.smsRequestId) {
        await accountsService.smsCancel(cur.smsRequestId).catch(() => undefined);
      }
      const updated = await prisma.generatedAccount.update({
        where: { id },
        data: { status: 'FAILED', error: e instanceof Error ? e.message : 'provision hatası' }
      });
      return toPublic(updated);
    }
  }

  // Poll the SMS provider for this account's OTP. On success, store it encrypted
  // (status stays AWAITING_OTP until on-device registration consumes it).
  async pollOtp(workspaceId: string | undefined, id: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (!acc.smsRequestId) throw new AppError('Numara henüz alınmadı', 400, 'NO_NUMBER');

    const res = await accountsService.smsReadOtp(acc.smsRequestId);
    if (res.status === 'received') {
      const updated = await prisma.generatedAccount.update({
        where: { id },
        data: { otpCodeEnc: encryptString(res.code) }
      });
      return { status: 'received', code: res.code, account: toPublic(updated) };
    }
    return { status: res.status };
  }

  // Step-by-step screenshots from the account's most recent WhatsApp registration
  // job (bug-tracking) — the operator SEES exactly where a failed run stalled.
  async getRegistrationShots(workspaceId: string | undefined, id: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, status: true, error: true }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    // The register job folds accountId into its payload; find the latest one.
    const jobs = await prisma.job.findMany({
      where: { type: 'REGISTER_WHATSAPP', ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, payload: true, result: true, status: true, error: true, createdAt: true }
    });
    const job = jobs.find((j) => (j.payload as { accountId?: string } | null)?.accountId === id);
    const result = (job?.result ?? {}) as { shots?: Array<{ label: string; ts: string; png: string }>; status?: string; note?: string };
    return {
      accountId: id,
      status: acc.status,
      error: acc.error,
      jobStatus: job?.status ?? null,
      resultStatus: result.status ?? null,
      note: result.note ?? null,
      shots: Array.isArray(result.shots) ? result.shots : []
    };
  }

  // Provision an entire batch sequentially (best-effort, continues on failure).
  async provisionBatch(workspaceId: string | undefined, batchId: string) {
    const accounts = await prisma.generatedAccount.findMany({
      where: { batchId, ...(workspaceId ? { workspaceId } : {}) }
    });
    const results = [];
    for (const a of accounts) {
      results.push(await this.provision(workspaceId, a.id));
    }
    return { batchId, provisioned: results.length, accounts: results };
  }

  // Register an account ON A DEVICE. Dispatches the platform's registration job
  // to the host agent, which runs the on-device signup RPA and reports whether
  // it CREATED the account or hit a wall (SMS/captcha/device-integrity).
  //   - instagram: REGISTER_INSTAGRAM (email-based; agent reads the email code)
  //   - whatsapp:  REGISTER_WHATSAPP  (phone-based; needs the rented number + OTP)
  // Facebook isn't automated yet.
  async registerAccount(workspaceId: string | undefined, id: string, deviceId: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    // Verify the target device belongs to this workspace before dispatching a job
    // to it (closes cross-tenant device control via a client-supplied deviceId).
    await assertDeviceReady(deviceId, workspaceId);
    // Load the device's Waydroid instance so we can country-match a proxy below.
    const dev = await prisma.device.findFirst({
      where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
      select: { metadata: true }
    });

    if (acc.platform === 'instagram') {
      if (!acc.emailAddress || !acc.passwordEnc || !acc.firstName) {
        throw new AppError('Önce hesabı hazırlayın (kimlik+e-posta+şifre)', 400, 'NOT_PROVISIONED');
      }
      // Country-match the exit IP to the account's country (Instagram also flags a
      // mismatched exit region). Prefer the phone country if a number is set, else
      // the account's countryCode. Best-effort; never blocks the register.
      const igInstance = ((dev?.metadata ?? {}) as Record<string, unknown>).instance;
      // Track whether auto-proxy just enqueued an EMULATOR_SET_PROXY job. If it did,
      // that job is a deliberate PRE-STEP of this same one-click flow (the agent runs
      // it before the register, in order, since it serializes per device). We must
      // then create the register with skipBusyCheck — otherwise assertDeviceIdle sees
      // the still-PENDING SET_PROXY and rejects the register with DEVICE_BUSY ("Cihaz
      // meşgul — Proxy ayarlama sürüyor"), which is exactly the one-click stall.
      let proxyQueued = false;
      if (typeof igInstance === 'string' && igInstance) {
        const igCc = acc.phoneNumber ? undefined : (acc.countryCode ?? undefined);
        if (acc.phoneNumber) {
          proxyQueued = Boolean(await autoAttachCountryProxy(deviceId, igInstance, acc.phoneNumber, workspaceId).catch(() => null));
        } else if (igCc) {
          proxyQueued = Boolean(await autoAttachCountryProxyByCountry(deviceId, igInstance, igCc, workspaceId).catch(() => null));
        }
      }
      const payload = {
        accountId: acc.id,
        email: acc.emailAddress,
        // Ship the ciphertext straight through (acc.passwordEnc is already encrypted);
        // agent.materializePayload decrypts passwordEnc→password at claim time so the
        // stored payload / GET /jobs/:id never expose the account password in the clear.
        passwordEnc: acc.passwordEnc,
        fullName: [acc.firstName, acc.lastName].filter(Boolean).join(' '),
        ...(acc.birthDate ? { birthYear: Number(acc.birthDate.slice(0, 4)) } : {}),
        ...(acc.username ? { username: acc.username } : {})
      } as unknown as JobPayload;
      const job = await createJobRecord('REGISTER_INSTAGRAM', payload, deviceId, workspaceId, proxyQueued ? { skipBusyCheck: true } : undefined);
      const updated = await prisma.generatedAccount.update({
        where: { id },
        data: { status: 'REGISTERING', deviceId }
      });
      return { job, account: toPublic(updated) };
    }

    if (acc.platform === 'whatsapp') {
      if (!acc.phoneNumber || !acc.firstName) {
        throw new AppError('Önce hesabı hazırlayın (kimlik + numara)', 400, 'NOT_PROVISIONED');
      }
      // Country-match the exit IP to the number BEFORE registering — WhatsApp bans a
      // mismatch ("Login not available"). Best-effort; never blocks the register.
      // If auto-proxy enqueues the SET_PROXY job, the register below must skip the
      // busy-check (that job is this flow's own pre-step, run in order by the agent);
      // otherwise the register is rejected DEVICE_BUSY ("Proxy ayarlama sürüyor").
      const waInstance = ((dev?.metadata ?? {}) as Record<string, unknown>).instance;
      let proxyQueued = false;
      if (typeof waInstance === 'string' && waInstance) {
        proxyQueued = Boolean(await autoAttachCountryProxy(deviceId, waInstance, acc.phoneNumber, workspaceId).catch(() => null));
      }
      // The OTP may already be in hand (pollOtp stored it); pass it so the agent
      // can complete in one shot. If absent, the agent stops at OTP_WAIT and the
      // operator re-runs register after pollOtp succeeds.
      const otpCode = acc.otpCodeEnc ? decryptString(acc.otpCodeEnc) : undefined;
      const payload = {
        accountId: acc.id,
        phoneNumber: acc.phoneNumber,
        fullName: [acc.firstName, acc.lastName].filter(Boolean).join(' '),
        ...(otpCode ? { otpCode } : {}),
        ...(acc.countryCode ? { countryCode: acc.countryCode } : {})
      } as unknown as JobPayload;
      const job = await createJobRecord('REGISTER_WHATSAPP', payload, deviceId, workspaceId, proxyQueued ? { skipBusyCheck: true } : undefined);
      const updated = await prisma.generatedAccount.update({
        where: { id },
        data: { status: 'REGISTERING', deviceId }
      });
      return { job, account: toPublic(updated) };
    }

    throw new AppError('Otomatik kayıt şu an sadece Instagram ve WhatsApp için', 400, 'PLATFORM_UNSUPPORTED');
  }

  // Send a WhatsApp message from a registered account's device, via the wa.me
  // deep link (recipient need not be a saved contact). Dispatches WHATSAPP_SEND.
  async sendWhatsApp(
    workspaceId: string | undefined,
    id: string,
    input: { to: string; message: string; deviceId?: string | undefined }
  ) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (acc.platform !== 'whatsapp') throw new AppError('Sadece WhatsApp hesapları mesaj gönderebilir', 400, 'PLATFORM_UNSUPPORTED');
    const deviceId = input.deviceId || acc.deviceId;
    if (!deviceId) throw new AppError('Cihaz belirtilmedi (hesap bir cihaza bağlı değil)', 400, 'NO_DEVICE');
    // Verify the device belongs to this workspace before dispatching (cross-tenant guard).
    await assertDeviceReady(deviceId, workspaceId);
    const payload = { accountId: acc.id, to: input.to, message: input.message } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_SEND', payload, deviceId, workspaceId);
    return { job };
  }

  // Send a WhatsApp message directly from a DEVICE (no account row needed) — the
  // WhatsApp page picks a device, not an account. Verifies the device belongs to
  // the workspace, then dispatches WHATSAPP_SEND (agent uses vtouch + wa.me).
  async sendFromDevice(
    workspaceId: string | undefined,
    input: { deviceId: string; to: string; message: string }
  ) {
    const device = await prisma.device.findFirst({
      where: { id: input.deviceId, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true }
    });
    if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    // ★2026-07-23: fail fast on a known-dead account. If the device's WhatsApp account is
    // already BANNED or LOGGED_OUT (stamped by a prior send outcome / health-watch), a new
    // send WILL fail on-device — so reject it up front with a clear 409 instead of queuing
    // a job that burns a device slot and returns an opaque CHAT_NOT_OPENED minutes later.
    // We deliberately DON'T block RESTRICTED: a restricted account can still reply in
    // EXISTING threads (only new-chat starts fail), so we let it try and report per-send.
    // ★★2026-07-28 BUG-FIX: eskiden sorgu `status: { in: ['BANNED','LOGGED_OUT'] }` ile
    // cihazda GECMISTE HERHANGI BIR ZAMAN banlanmis satiri ariyordu -> bir kez banlanan
    // cihaz, YENI ve CALISAN bir numarayla yeniden kaydedilse bile bir daha mesaj
    // ATAMIYORDU (kalici 409). Ustelik KART bunu gostermiyordu: rozet EN YENI hesaba
    // bakiyor (dogru), koruma ise "hic banlanmis mi" diye bakiyordu -> panel "saglikli"
    // derken API reddediyordu (celiskili durum).
    // CANLI KANIT (watest): ACTIVE +905015716660 (27 Tem, calisan) + BANNED 905391147788
    // (16 Tem, degistirilmis) -> her gonderim "hesap YASAKLI" ile 409 aliyordu. Fix sonrasi
    // ayni gonderim status=SENT ile GECTI.
    // FIX: kart ile AYNI kurali kullan — EN YENI hesap satiri (FAILED gibi ara durumlar
    // haric) neyse ona bak. Boylece panel ile API asla celismez.
    // ★2026-07-29: bu kural artik devices/whatsappCategory.ts'te TEK yerde yasiyor
    // (panel karti, public API guard'i ve /devices/:id capabilities ayni tabloyu okur).
    // requireAccountRow:false — bu yol dashboard'un WhatsApp sayfasindir ve HESAP SATIRI
    // SART KOSMAZ (fonksiyon aciklamasindaki "no account row needed"). Canli filoda DB'de
    // satiri olmayan ama cihazda WhatsApp'i KAYITLI cihazlar var; onlari kirmamak icin
    // burada sadece OLU hesap (BANNED/LOGGED_OUT) reddedilir. Public API katmani ayni
    // tabloyu kati modda uygular.
    const waState = await getWhatsappState(input.deviceId).catch(() => EMPTY_WHATSAPP_STATE);
    const access = checkWhatsappAccess(waState, 'send', { requireAccountRow: false });
    if (!access.allowed) throw new AppError(access.message, 409, access.code);
    const to = input.to.replace(/[^\d]/g, '');
    if (!to) throw new AppError('Geçerli bir telefon numarası gerekli', 400, 'INVALID_RECIPIENT');
    const payload = { deviceId: input.deviceId, to, message: input.message } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_SEND', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Change the device's OWN WhatsApp profile DISPLAY NAME (pushname). The agent drives
  // Settings › Profile › Name and types via ADBKeyboard. Workspace-scoped + assertDeviceReady
  // gives an immediate DEVICE_OFFLINE/AGENT_UNREACHABLE instead of a silent PENDING hang.
  async setProfileName(workspaceId: string | undefined, input: { deviceId: string; name: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError('İsim gerekli', 400, 'INVALID_NAME');
    if (name.length > 25) throw new AppError('İsim en fazla 25 karakter (WhatsApp sınırı)', 400, 'NAME_TOO_LONG');
    const payload = { deviceId: input.deviceId, name } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_SET_NAME', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Change the device's OWN WhatsApp profile PICTURE. `imageB64` is a base64 PNG/JPEG
  // (data-URI prefix tolerated). The agent pushes it to the gallery, indexes it into
  // MediaStore, and opens WhatsApp's SetAsProfilePhoto → crop → Done. Workspace-scoped.
  async setAvatar(workspaceId: string | undefined, input: { deviceId: string; imageB64: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const imageB64 = String(input.imageB64 ?? '').trim();
    if (!imageB64) throw new AppError('Resim gerekli (base64 PNG/JPEG)', 400, 'INVALID_IMAGE');
    // Guard against absurd payloads (base64 ~1.37× raw; 8MB raw ≈ 11MB b64 cap).
    if (imageB64.length > 11_000_000) throw new AppError('Resim çok büyük (maks ~8MB)', 400, 'IMAGE_TOO_LARGE');
    const payload = { deviceId: input.deviceId, imageB64 } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_SET_AVATAR', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Send a Telegram message directly from a DEVICE (no account row needed) — mirrors
  // sendFromDevice for WhatsApp. Verifies the device belongs to the workspace, then
  // dispatches TELEGRAM_SEND. The agent runtime-detects the installed Telegram package
  // (org.telegram.messenger / .web / org.thunderdog.challegram — not fixed), opens the
  // chat via the tg:// deep link, and taps Send. The recipient must be a Telegram user
  // reachable by phone; the agent reports INVALID_RECIPIENT/BLOCKED/NOT_INSTALLED/
  // NOT_LOGGED_IN otherwise.
  async sendTelegramFromDevice(
    workspaceId: string | undefined,
    input: { deviceId: string; to: string; message: string }
  ) {
    // Verify the device belongs to this workspace AND is reachable right now (assertDeviceReady
    // gives an immediate DEVICE_OFFLINE/AGENT_UNREACHABLE instead of a silent PENDING hang —
    // sendFromDevice above predates that helper, but new code should use it).
    await assertDeviceReady(input.deviceId, workspaceId);
    const to = input.to.replace(/[^\d]/g, '');
    if (!to) throw new AppError('Geçerli bir telefon numarası gerekli', 400, 'INVALID_RECIPIENT');
    const payload = { deviceId: input.deviceId, to, message: input.message } as unknown as JobPayload;
    const job = await createJobRecord('TELEGRAM_SEND', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Fetch a contact's WhatsApp profile (avatar + name/about) on a device. The
  // agent screenshots the avatar and scrapes the contact-info screen; the result
  // lands on the Job row AND is persisted onto the conversation thread by
  // agentService.complete (avatar/profileInfo). Device-scoped + workspace-guarded.
  async fetchProfile(
    workspaceId: string | undefined,
    input: { deviceId: string; to?: string | undefined; from?: string | undefined }
  ) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const to = (input.to || '').replace(/[^\d]/g, '');
    if (!to && !input.from) throw new AppError('to veya from gerekli', 400, 'MISSING_TARGET');
    const payload = {
      deviceId: input.deviceId,
      ...(to ? { to } : {}),
      ...(input.from ? { from: input.from } : {})
    } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_PROFILE', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Block or unblock a contact on a device via the WhatsApp UI. `block` defaults
  // to true. The conversation's `blocked` flag is reconciled in
  // agentService.complete once the agent confirms the toggle. Workspace-guarded.
  async blockContact(
    workspaceId: string | undefined,
    input: { deviceId: string; to?: string | undefined; from?: string | undefined; block?: boolean | undefined }
  ) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const to = (input.to || '').replace(/[^\d]/g, '');
    if (!to && !input.from) throw new AppError('to veya from gerekli', 400, 'MISSING_TARGET');
    const block = input.block !== false;
    const payload = {
      deviceId: input.deviceId,
      block,
      ...(to ? { to } : {}),
      ...(input.from ? { from: input.from } : {})
    } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_BLOCK', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Read the device's blocked-contacts list (Settings › Privacy › Blocked). The
  // scraped names/numbers land on the Job row; agentService.complete reconciles
  // matching conversation threads' `blocked` flags. Workspace-guarded.
  async listBlocked(
    workspaceId: string | undefined,
    input: { deviceId: string }
  ) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_BLOCKLIST', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Read the account's OWN WhatsApp number off the device (Settings profile row).
  // The number lands on the Job result; poll the job. Workspace-guarded.
  async myNumber(workspaceId: string | undefined, input: { deviceId: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_MYNUMBER', payload, input.deviceId, workspaceId);
    return { job };
  }

  // ── Root-DB read jobs (no UI on the device — read WhatsApp's own SQLite). All
  // dispatch a job the agent answers from msgstore.db/wa.db; the result lands on
  // Job.result. Same shape as myNumber: assert device, record job, return it.
  async waReceipts(workspaceId: string | undefined, input: { deviceId: string; to: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, to: input.to, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_RECEIPTS', payload, input.deviceId, workspaceId) };
  }
  async waMedia(workspaceId: string | undefined, input: { deviceId: string; to?: string | undefined; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.to ? { to: input.to } : {}), ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_MEDIA', payload, input.deviceId, workspaceId) };
  }
  async waCalls(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_CALLS', payload, input.deviceId, workspaceId) };
  }
  async waSearch(workspaceId: string | undefined, input: { deviceId: string; query: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, query: input.query, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_SEARCH', payload, input.deviceId, workspaceId) };
  }
  async waUnread(workspaceId: string | undefined, input: { deviceId: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_UNREAD', payload, input.deviceId, workspaceId) };
  }
  async waConversations(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_CONVERSATIONS', payload, input.deviceId, workspaceId) };
  }
  // Full address book (WhatsApp contacts the account knows) — read from wa.db.
  async waContacts(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_CONTACTS', payload, input.deviceId, workspaceId) };
  }
  // Members of a group chat (by subject or jid id) — read from msgstore.db.
  async waGroupMembers(workspaceId: string | undefined, input: { deviceId: string; group: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, group: input.group, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_GROUP_MEMBERS', payload, input.deviceId, workspaceId) };
  }
  // Per-chat aggregate stats (message/media counts, first/last ts) — msgstore.db.
  async waChatSummary(workspaceId: string | undefined, input: { deviceId: string; to: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, to: input.to } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_CHAT_SUMMARY', payload, input.deviceId, workspaceId) };
  }
  // Account health: registered number + WhatsApp version + registered flag — no UI.
  async waAccountHealth(workspaceId: string | undefined, input: { deviceId: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_ACCOUNT_HEALTH', payload, input.deviceId, workspaceId) };
  }
  // Pull DOWNLOADED media off the device as base64 (root cat) — not-yet-downloaded
  // media comes back pending. Optional `to` scopes to one chat.
  async waFetchMedia(workspaceId: string | undefined, input: { deviceId: string; to?: string | undefined; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.to ? { to: input.to } : {}), ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_FETCH_MEDIA', payload, input.deviceId, workspaceId) };
  }
  // Emoji reactions (optionally scoped to one chat) — message_add_on_reaction.
  async waReactions(workspaceId: string | undefined, input: { deviceId: string; to?: string | undefined; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.to ? { to: input.to } : {}), ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_REACTIONS', payload, input.deviceId, workspaceId) };
  }
  // Polls (question + options + vote counts) — message_poll.
  async waPolls(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_POLLS', payload, input.deviceId, workspaceId) };
  }
  // Per-recipient read receipts for own sent messages in a chat (who-read-in-group) — receipt_user.
  async waReadBy(workspaceId: string | undefined, input: { deviceId: string; to: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, to: input.to, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_READ_BY', payload, input.deviceId, workspaceId) };
  }
  // Starred (bookmarked) messages across all chats — message.starred.
  async waStarred(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_STARRED', payload, input.deviceId, workspaceId) };
  }
  // WhatsApp Business labels (name/color/chat-count + predefined flag) — labels.
  async waLabels(workspaceId: string | undefined, input: { deviceId: string }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_LABELS', payload, input.deviceId, workspaceId) };
  }
  // View-once media pulled as base64 (even after opened, if the file remains) — root.
  async waViewOnce(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_VIEW_ONCE', payload, input.deviceId, workspaceId) };
  }
  // Voice notes (PTT audio), optionally with base64 audio — root.
  async waVoiceNotes(workspaceId: string | undefined, input: { deviceId: string; to?: string | undefined; limit?: number | undefined; withAudio?: boolean | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.to ? { to: input.to } : {}), ...(input.limit ? { limit: input.limit } : {}), ...(input.withAudio === false ? { withAudio: false } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_VOICE_NOTES', payload, input.deviceId, workspaceId) };
  }
  // Deleted ("delete for everyone") messages that survive in the DB — anti-delete, root.
  async waDeleted(workspaceId: string | undefined, input: { deviceId: string; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_DELETED', payload, input.deviceId, workspaceId) };
  }
  // Every URL shared in the account's chats (optionally one chat) — root.
  async waLinks(workspaceId: string | undefined, input: { deviceId: string; to?: string | undefined; limit?: number | undefined }) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId, ...(input.to ? { to: input.to } : {}), ...(input.limit ? { limit: input.limit } : {}) } as unknown as JobPayload;
    return { job: await createJobRecord('WHATSAPP_LINKS', payload, input.deviceId, workspaceId) };
  }

  // Send a media message (image/document) from a device to a peer. mediaUrl must
  // be a public URL (SSRF-guarded on the agent when it downloads). Device-scoped.
  async sendMedia(
    workspaceId: string | undefined,
    input: { deviceId: string; to: string; mediaUrl: string; caption?: string | undefined; kind?: 'image' | 'document' | undefined }
  ) {
    await assertDeviceReady(input.deviceId, workspaceId);
    // SSRF guard at the API boundary: resolve the mediaUrl's host and reject any
    // that points at a private/loopback/link-local address (e.g. cloud metadata
    // 169.254.169.254) BEFORE the agent downloads it. Does a real DNS lookup so
    // a public hostname that resolves internally is still blocked.
    await assertSafePublicUrl(input.mediaUrl);
    const to = input.to.replace(/[^\d]/g, '');
    if (!to) throw new AppError('Geçerli bir telefon numarası gerekli', 400, 'INVALID_RECIPIENT');
    const payload = {
      deviceId: input.deviceId,
      to,
      mediaUrl: input.mediaUrl,
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.kind ? { kind: input.kind } : {})
    } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_SEND_MEDIA', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Delete a message in a chat: scope 'me' (for me) or 'everyone' (unsend).
  // Optional matchText targets a specific bubble; otherwise the last outgoing one.
  async deleteMessage(
    workspaceId: string | undefined,
    input: { deviceId: string; to: string; scope?: 'me' | 'everyone' | undefined; matchText?: string | undefined }
  ) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const to = input.to.replace(/[^\d]/g, '');
    if (!to) throw new AppError('Geçerli bir telefon numarası gerekli', 400, 'INVALID_RECIPIENT');
    const payload = {
      deviceId: input.deviceId,
      to,
      scope: input.scope ?? 'everyone',
      ...(input.matchText ? { matchText: input.matchText } : {})
    } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_DELETE_MSG', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Clear all local messages in a chat (overflow → Clear chat). Device-scoped.
  async clearChat(
    workspaceId: string | undefined,
    input: { deviceId: string; to: string }
  ) {
    await assertDeviceReady(input.deviceId, workspaceId);
    const to = input.to.replace(/[^\d]/g, '');
    if (!to) throw new AppError('Geçerli bir telefon numarası gerekli', 400, 'INVALID_RECIPIENT');
    const payload = { deviceId: input.deviceId, to } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_CLEAR_CHAT', payload, input.deviceId, workspaceId);
    return { job };
  }

  // List stored WhatsApp messages (inbound captured by the agent's notification
  // poll + outbound we sent) for a device, newest first. Workspace-scoped so a
  // key can only read its own devices' messages.
  async listMessages(
    workspaceId: string | undefined,
    input: { deviceId: string; limit?: number | undefined; direction?: 'IN' | 'OUT' | undefined }
  ) {
    // Verify the device belongs to this workspace (closes cross-tenant read).
    const device = await prisma.device.findFirst({
      where: { id: input.deviceId, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true }
    });
    if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    const take = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const rows = await prisma.whatsappMessage.findMany({
      where: {
        deviceId: input.deviceId,
        ...(input.direction ? { direction: input.direction } : {})
      },
      orderBy: { createdAt: 'desc' },
      take
    });
    // Message body is AES-256-GCM encrypted at rest; decrypt for display.
    // safeDecrypt keeps pre-encryption plaintext rows readable (backward-compat).
    const messages = rows.map((m) => ({ ...m, body: safeDecrypt(m.body) }));
    return { messages };
  }

  // Read recent WhatsApp messages from a chat on the account's device.
  // Dispatches WHATSAPP_READ; the result lands on the Job row when the agent
  // completes (poll the job to get the messages).
  async readWhatsApp(
    workspaceId: string | undefined,
    id: string,
    input: { from?: string | undefined; to?: string | undefined; deviceId?: string | undefined }
  ) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (acc.platform !== 'whatsapp') throw new AppError('Sadece WhatsApp hesapları mesaj okuyabilir', 400, 'PLATFORM_UNSUPPORTED');
    const deviceId = input.deviceId || acc.deviceId;
    if (!deviceId) throw new AppError('Cihaz belirtilmedi (hesap bir cihaza bağlı değil)', 400, 'NO_DEVICE');
    // Verify the device belongs to this workspace before dispatching (cross-tenant guard).
    await assertDeviceReady(deviceId, workspaceId);
    const payload = {
      accountId: acc.id,
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {})
    } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_READ', payload, deviceId, workspaceId);
    return { job };
  }

  // ── FULLY AUTOMATIC WhatsApp registration ──────────────────────────────────
  // One call drives the whole pipeline on a device, with NO operator OTP entry:
  //   1. rent the cheapest available WhatsApp number (sms-bus)
  //   2. generate an identity, persist the account (status REGISTERING)
  //   3. dispatch REGISTER_WHATSAPP so the agent types the number + submits
  //   4. poll sms-bus for the OTP the SMS arrives at the rented number
  //   5. re-dispatch REGISTER_WHATSAPP with otpCode so the agent enters it
  //   6. report ACTIVE / the wall hit (ban / device-integrity / rejected code)
  //
  // Long-running: this awaits each on-device job and polls the SMS for up to
  // ~3 min. The caller may run it in the background and poll the account, or
  // await it (the test path). Progress is reflected on the GeneratedAccount row.
  async autoRegisterWhatsApp(
    workspaceId: string | undefined,
    deviceId: string,
    opts?: { fullName?: string; countryId?: number; batchId?: string; provider?: SmsProvider }
  ) {
    if (!deviceId) throw new AppError('Cihaz belirtilmedi', 400, 'NO_DEVICE');

    const provider: SmsProvider = opts?.provider ?? 'sms-bus';

    // 1) Identity (name) — used both for the WA profile and the account row.
    const ident = await accountsService.generateIdentity().catch(() => null);
    const fullName =
      opts?.fullName?.trim() ||
      [ident?.firstName, ident?.lastName].filter(Boolean).join(' ') ||
      'Fleet User';
    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ') || null;

    // 2) Rent a WhatsApp number from the chosen provider, cheap/reliable-first.
    let rented: { requestId: string; number: string } | null = null;
    let usedCC = '';
    const errors: string[] = [];

    if (provider === '5sim') {
      if (!process.env.FIVESIM_API_KEY) {
        throw new AppError('5sim seçildi ama FIVESIM_API_KEY tanımlı değil', 400, 'NO_5SIM_KEY');
      }
      for (const country of WA_5SIM_COUNTRIES) {
        try {
          const r = await fivesim.getNumber(fivesimCfg(), country, 'whatsapp');
          if (r?.number) { rented = r; usedCC = r.number.slice(0, r.number.length - 10) || ''; break; }
        } catch (e) {
          errors.push(`${country}: ${e instanceof Error ? e.message : 'hata'}`);
        }
      }
    } else {
      const projectId = (await resolveProjectId('whatsapp')) ?? '5';
      const tryCountries = opts?.countryId
        ? WHATSAPP_CHEAP_COUNTRIES.filter((c) => c.id === opts.countryId)
        : WHATSAPP_CHEAP_COUNTRIES;
      for (const country of tryCountries) {
        try {
          const r = await accountsService.smsGetNumber(country.id, projectId);
          if (r?.number) { rented = r; usedCC = country.cc; break; }
        } catch (e) {
          errors.push(`${country.code}: ${e instanceof Error ? e.message : 'hata'}`);
        }
      }
    }
    if (!rented) {
      throw new AppError(`WhatsApp numarası alınamadı (${provider}). ${errors.join(' | ')}`, 502, 'NO_NUMBER');
    }

    // 3) Persist the account row so progress is visible while we drive it. If the
    // create itself fails, the number was already rented (money spent) but there
    // is no account row yet — so release it here rather than leaking a paid-for
    // number (the releaseNumber helper below only exists AFTER this create).
    let acc;
    try {
      acc = await prisma.generatedAccount.create({
        data: {
          platform: 'whatsapp',
          status: 'REGISTERING',
          firstName: firstName ?? 'Fleet',
          lastName,
          phoneNumber: rented.number,
          smsRequestId: rented.requestId,
          countryCode: usedCC,
          deviceId,
          ...(opts?.batchId ? { batchId: opts.batchId } : {}),
          ...(workspaceId ? { workspaceId } : {})
        }
      });
    } catch (e) {
      if (provider === '5sim') await fivesim.cancelNumber(fivesimCfg(), rented.requestId).catch(() => undefined);
      else await accountsService.smsCancel(rented.requestId).catch(() => undefined);
      throw e;
    }

    // Release the rented number on the right provider (refunds a dead attempt).
    const releaseNumber = async () => {
      if (provider === '5sim') await fivesim.cancelNumber(fivesimCfg(), rented!.requestId).catch(() => undefined);
      else await accountsService.smsCancel(rented!.requestId).catch(() => undefined);
    };
    const fail = async (status: string, note: string, extra?: unknown) => {
      await prisma.generatedAccount.update({ where: { id: acc.id }, data: { status: 'FAILED', error: note } });
      await releaseNumber();
      return { ok: false, status, note, account: toPublic(await prisma.generatedAccount.findUniqueOrThrow({ where: { id: acc.id } })), extra };
    };

    // 4) First on-device pass: enter number + submit. Agent stops at OTP_WAIT.
    //    deviceId goes in the PAYLOAD (the agent claims jobs by payload.deviceId);
    //    the emulatorId FK column points at the legacy Emulator table, not Device.
    const phoneE164 = rented.number.startsWith('+') ? rented.number : `+${rented.number}`;

    // ── Auto-assign a country-matched proxy BEFORE the first register pass ───────
    // ★This fully-automatic flow previously dispatched REGISTER_WHATSAPP with NO
    // proxy step — unlike registerAccount and startOperatorRegister, which both call
    // autoAttachCountryProxy first. So an auto-rented number registered on the host's
    // raw datacenter exit IP → country mismatch → "Login not available"/ban. Mirror the
    // operator path: resolve the instance, attach a country-matched proxy, and skip the
    // busy-check on job1 when a SET_PROXY was queued (it's this flow's own pre-step).
    const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } });
    const devMeta = (dev?.metadata ?? {}) as Record<string, unknown>;
    const devInstance = typeof devMeta.instance === 'string' ? devMeta.instance : '';
    let autoProxy: { country: string } | null = null;
    if (devInstance) {
      autoProxy = await autoAttachCountryProxy(deviceId, devInstance, phoneE164, workspaceId).catch(() => null);
    }

    // ── job1 (number-entry) with AUTO-RETRY on a TRANSIENT failure ─────────────
    // The first on-device pass (enter number → OTP screen) can fail for INFRA reasons
    // that have nothing to do with the number: the device was momentarily busy with
    // another job (DEVICE_BUSY), ADB blipped, or the job timed out in the queue. Those
    // are safe to retry — we haven't consumed an OTP yet, so re-running just re-enters
    // the number. A HARD reject (device_wall / not-installed / banned) is NOT retried:
    // re-attempting only burns the number and raises ban risk. We retry up to twice.
    const isTransientReg = (r: { status?: string; error?: string | null } | null): boolean => {
      if (!r) return true; // null = awaitJob timeout → transient
      const s = `${r.status ?? ''} ${r.error ?? ''}`.toLowerCase();
      if (/wall|not_installed|banned|reddet|engellendi|resmi uygulama|couldn|sms gönder/.test(s)) return false;
      return /busy|meşgul|timeout|zaman aşımı|device_busy|command failed|ulaşılamadı/.test(s);
    };
    let r1 = null;
    for (let regAttempt = 0; regAttempt <= 2; regAttempt++) {
      const j1 = await createJobRecord(
        'REGISTER_WHATSAPP',
        { deviceId, accountId: acc.id, phoneNumber: phoneE164, fullName, regAttempt } as unknown as JobPayload,
        undefined,
        workspaceId,
        { skipBusyCheck: Boolean(autoProxy) || regAttempt > 0 }
      );
      r1 = await this.awaitJob(j1.id, 120_000);
      // Success (reached OTP_WAIT) or a HARD failure → stop retrying.
      const res = (r1?.result as Record<string, unknown>) ?? {};
      const reachedOtp = r1?.status !== 'FAILED' && (!res.status || res.status === 'OTP_WAIT');
      if (reachedOtp || !isTransientReg(r1)) break;
      if (regAttempt < 2) {
        logger.info('register job1 transient fail — retrying', { deviceId, attempt: regAttempt + 1, status: r1?.status });
        await sleep(4000); // brief settle before re-dispatch
      }
    }
    if (!r1) return fail('TIMEOUT', 'Numara giriş jobı zaman aşımına uğradı (2 tekrar sonrası)');
    if (r1.status === 'FAILED') return fail('FAILED', `Numara girişi başarısız: ${r1.error ?? ''}`);
    const res1 = (r1.result as Record<string, unknown>) ?? {};
    if (res1.status && res1.status !== 'OTP_WAIT') {
      // hit a wall (DEVICE_WALL / NOT_INSTALLED / etc.) before OTP
      return fail(String(res1.status), String(res1.note ?? 'Numara aşamasında engel'), res1);
    }

    // 5) Poll the provider for the OTP. sms-bus numbers live ~15-20 min (reuse
    //    window is 20 min), and WhatsApp can take a few minutes to send — the old
    //    3-min cap was too short. Poll up to ~9 min, but bail early if the number
    //    is reported released/expired (no point waiting on a dead number).
    let otp = '';
    for (let i = 0; i < 108; i++) {
      const sms = provider === '5sim'
        ? await fivesim.getSms(fivesimCfg(), rented.requestId).catch(() => ({ status: 'waiting' as const }))
        : await accountsService.smsReadOtp(rented.requestId).catch(() => ({ status: 'waiting' as const }));
      if (sms.status === 'received' && sms.code) {
        otp = String(sms.code).replace(/\D/g, '').slice(0, 6);
        // otpCodeEnc is written in the atomic claim below (not here) so the write and
        // the "still ours?" status gate happen together — avoids a torn state where the
        // code is saved but the operator flow has already taken over.
        break;
      }
      await sleep(5000);
    }
    if (!otp) return fail('OTP_TIMEOUT', 'OTP gelmedi (9 dk beklendi, numara WhatsApp kodunu almadı)');

    // ★Atomically CLAIM the account before dispatching job2. On OTP_WAIT the shared
    // completion hook flips this account to AWAITING_OTP, which opens the panel's OTP
    // box — an operator could enter the code themselves (provideOperatorOtp), which
    // claims REGISTERING→dispatches its OWN job2. Without this guard, our loop would
    // ALSO write otpCodeEnc and dispatch a SECOND job2 (same OTP, same device) and then
    // clobber the operator flow by force-writing ACTIVE/FAILED. updateMany with a status
    // gate makes the claim exclusive: count 0 → the operator already took over, so we
    // bow out and let their flow finish.
    const claim = await prisma.generatedAccount.updateMany({
      where: { id: acc.id, status: { in: ['REGISTERING', 'AWAITING_OTP'] } },
      data: { status: 'REGISTERING', otpCodeEnc: encryptString(otp) }
    });
    if (claim.count === 0) {
      await releaseNumber();
      return { ok: true, status: 'OPERATOR_TOOK_OVER', phoneNumber: phoneE164, note: 'Operatör OTP akışını devraldı — otomatik akış çekildi', account: toPublic(await prisma.generatedAccount.findUniqueOrThrow({ where: { id: acc.id } })) };
    }

    // 6) Second on-device pass: enter the OTP, finish the profile.
    const job2 = await createJobRecord(
      'REGISTER_WHATSAPP',
      // OTP travels ENCRYPTED (otpCodeEnc); agent.materializePayload decrypts it to
      // otpCode at claim time, so the stored payload / GET /jobs/:id never expose the
      // plaintext code (it's a live account-takeover secret for ~10 min).
      { deviceId, accountId: acc.id, phoneNumber: phoneE164, fullName, otpCodeEnc: encryptString(otp) } as unknown as JobPayload,
      undefined,
      workspaceId,
      { skipBusyCheck: true } // OTP continuation of the same registration flow
    );
    const r2 = await this.awaitJob(job2.id, 120_000);
    if (!r2) return fail('TIMEOUT', 'OTP giriş jobı zaman aşımına uğradı');
    if (r2.status === 'FAILED') return fail('FAILED', `OTP girişi başarısız: ${r2.error ?? ''}`);
    const res2 = (r2.result as Record<string, unknown>) ?? {};
    if (res2.status && !['ACTIVE', 'REGISTERED', 'DONE', 'OK'].includes(String(res2.status))) {
      return fail(String(res2.status), String(res2.note ?? 'OTP aşamasında engel'), res2);
    }

    // Success — mark ACTIVE.
    const done = await prisma.generatedAccount.update({ where: { id: acc.id }, data: { status: 'ACTIVE', error: null } });
    return { ok: true, status: 'ACTIVE', phoneNumber: phoneE164, otp, account: toPublic(done), result: res2 };
  }

  // ── OPERATOR-OTP WhatsApp registration ─────────────────────────────────────
  // The one-click flow where the OPERATOR supplies their OWN number and enters
  // the OTP themselves (no SMS provider). Unlike autoRegisterWhatsApp this is
  // ASYNC: we dispatch and return immediately; the agent's OTP_WAIT/CREATED
  // outcome is reflected onto the account by the REGISTER_WHATSAPP job-completion
  // hook (agent.service.ts). The dashboard polls the account row for status.

  // Pass 1: create the account row + dispatch REGISTER_WHATSAPP WITHOUT an OTP so
  // the agent enters the number, auto-accepts the permission/consent screens, and
  // stops at OTP_WAIT. A random name is generated here (used at the profile step).
  async startOperatorRegister(
    workspaceId: string | undefined,
    deviceId: string,
    phoneNumber: string,
    operatorName?: string,
    force?: boolean
  ) {
    if (!deviceId) throw new AppError('Cihaz belirtilmedi', 400, 'NO_DEVICE');
    // Verify the device belongs to this workspace before dispatching a job to it.
    await assertDeviceReady(deviceId, workspaceId);

    // ★DATA-LOSS GUARD: a fresh REGISTER_WHATSAPP makes the agent run `pm clear com.whatsapp`
    // (factory-reset) BEFORE entering the new number — so starting a new registration on a
    // device that ALREADY holds a live WhatsApp account WIPES that account. Block it unless
    // the operator explicitly confirms (force). The authoritative signal is an ACTIVE
    // whatsapp GeneratedAccount on this device (Device.protected is a manual lock, not set
    // automatically on WA success, so it's NOT reliable here). AWAITING_MANUAL counts too
    // (account exists, just needs a human step). VERIFIED risk (operator flagged live).
    if (!force) {
      const existing = await prisma.generatedAccount.findFirst({
        where: {
          deviceId,
          platform: 'whatsapp',
          status: { in: ['ACTIVE', 'AWAITING_MANUAL'] },
          ...(workspaceId ? { workspaceId } : {})
        },
        select: { id: true, phoneNumber: true }
      });
      if (existing) {
        throw new AppError(
          `Bu cihazda zaten aktif bir WhatsApp hesabı var (${existing.phoneNumber ?? 'numara bilinmiyor'}). Yeni kayıt bu hesabı SİLER. Yine de devam etmek için onaylayın.`,
          409,
          'DEVICE_HAS_ACTIVE_WHATSAPP'
        );
      }
    }

    // Normalize to E.164 (agent's splitE164 wants a leading country code).
    const digits = phoneNumber.replace(/[^\d]/g, '');
    if (digits.length < 6) throw new AppError('Geçerli bir telefon numarası gerekli (ülke kodu dahil)', 400, 'INVALID_NUMBER');
    const phoneE164 = `+${digits}`;

    // Profile name: use the operator-supplied name when given, else a random offline
    // identity (offline-first, never throws). Either way the agent types this exact name.
    const chosen = (operatorName ?? '').trim();
    let fullName = chosen;
    if (!fullName) {
      const ident = await accountsService.generateIdentity().catch(() => null);
      fullName = [ident?.firstName, ident?.lastName].filter(Boolean).join(' ') || 'Fleet User';
    }
    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ') || null;

    const acc = await prisma.generatedAccount.create({
      data: {
        platform: 'whatsapp',
        status: 'REGISTERING',
        firstName: firstName ?? 'Fleet',
        lastName,
        phoneNumber: phoneE164,
        deviceId,
        ...(workspaceId ? { workspaceId } : {})
      }
    });

    // ── Auto-assign a country-matched proxy BEFORE registering ──────────────────
    // WhatsApp rejects a number whose country != the exit-IP country ("Login not
    // available"). So we map the number's calling code → ISO country, pick a
    // healthy proxy in that country, and route the device's Waydroid instance
    // through it (redsocks + iptables via EMULATOR_SET_PROXY → wd-proxy.sh) BEFORE
    // the REGISTER_WHATSAPP job runs. Best-effort: if there's no matching proxy or
    // the device has no instance, we skip and let registration proceed (the
    // operator can assign one manually). We fold the instance + decrypted
    // credentials into the payload directly (claimNext doesn't do it for us).
    // Use the SAME country-matched proxy path as the batch register (registerAccount)
    // and Instagram: autoAttachCountryProxy picks the workspace's 'provider' proxy and
    // routes the device's instance through a sticky "-cc-<CC>" login (thordata), so a
    // single provider entry covers every country. The previous inline lookup required a
    // per-country proxy row with status≠FAILED, which never matched when only a generic
    // provider proxy existed → registration silently ran on the datacenter IP and got
    // "Login not available"-banned. Best-effort; never blocks the register.
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } });
    const meta = (device?.metadata ?? {}) as Record<string, unknown>;
    const instance = typeof meta.instance === 'string' ? meta.instance : '';
    let proxyAssigned: { country: string } | null = null;
    if (instance) {
      proxyAssigned = await autoAttachCountryProxy(deviceId, instance, phoneE164, workspaceId).catch(() => null);
    }

    // The REGISTER_WHATSAPP dispatch is the point of no return. If it fails (e.g.
    // the device just became busy with another exclusive job), the account row we
    // created above would otherwise be stranded in REGISTERING forever with no job
    // ever driving it. Compensate: mark the account FAILED so the operator sees a
    // real failure instead of a hung "sürüyor", then surface the error.
    let regJob;
    try {
      regJob = await createJobRecord(
        'REGISTER_WHATSAPP',
        { deviceId, accountId: acc.id, phoneNumber: phoneE164, fullName } as unknown as JobPayload,
        undefined,
        workspaceId,
        // If auto-proxy just queued a SET_PROXY job, skip the busy-check: that job is
        // THIS flow's own pre-step (agent runs it before the register, per-device
        // serialized). Without this, assertDeviceIdle sees the still-PENDING SET_PROXY
        // and rejects with DEVICE_BUSY "Proxy ayarlama sürüyor" — the exact one-click
        // stall the operator hit. This is the operator-OTP path (startOperatorRegister),
        // separate from registerAccount which was fixed the same way.
        proxyAssigned ? { skipBusyCheck: true } : undefined
      );
    } catch (e) {
      await prisma.generatedAccount
        .update({ where: { id: acc.id }, data: { status: 'FAILED', error: e instanceof Error ? e.message : 'Kayıt işi başlatılamadı' } })
        .catch(() => undefined);
      throw e;
    }

    // Mark the device as "WhatsApp kaydı sürüyor" (mirrors provisionStatus) so the
    // profiles card can show a badge + reopen the live panel after "arka plana al".
    // Cleared by the REGISTER_WHATSAPP completion hook (agent.service).
    await prisma.device
      .update({
        where: { id: deviceId },
        data: {
          metadata: {
            ...((await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } }))?.metadata as Record<string, unknown> ?? {}),
            waRegisterStatus: 'REGISTERING',
            waRegisterAccountId: acc.id,
            waRegisterPhone: phoneE164,
            waRegisterJobId: regJob.id
          } as Prisma.InputJsonValue
        }
      })
      .catch(() => undefined);

    // Return the account + the live-panel bootstrap (accountId/deviceId/steps) so
    // the dashboard can open the WhatsApp progress modal immediately.
    return {
      ...toPublic(acc),
      accountId: acc.id,
      deviceId,
      steps: WA_REGISTER_STEPS,
      ...(proxyAssigned ? { proxyAssigned } : {})
    };
  }

  // ── One-click Instagram registration (email-based, fully autonomous) ────────
  // Mirrors startOperatorRegister but for Instagram: create the account row with
  // an auto-generated identity + email + password, then dispatch REGISTER_INSTAGRAM.
  // The agent enters everything and reads the confirmation code from the email
  // (catchmail) itself — there is NO operator-OTP step. The REGISTER_INSTAGRAM
  // completion hook (agent.service) flips the account to ACTIVE (CREATED),
  // AWAITING_MANUAL (captcha/SMS wall) or FAILED. Optional overrides let a caller
  // pass a specific email/password/name; anything omitted is generated.
  async startInstagramRegister(
    workspaceId: string | undefined,
    deviceId: string,
    overrides?: { email?: string | undefined; password?: string | undefined; fullName?: string | undefined; birthYear?: number | undefined }
  ) {
    if (!deviceId) throw new AppError('Cihaz belirtilmedi', 400, 'NO_DEVICE');
    await assertDeviceReady(deviceId, workspaceId);

    // Identity: use overrides where given, else generate offline-first.
    const ident = await accountsService.generateIdentity().catch(() => null);
    const fullName =
      (overrides?.fullName && overrides.fullName.trim()) ||
      [ident?.firstName, ident?.lastName].filter(Boolean).join(' ') ||
      'Fleet User';
    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ') || null;

    // Email: use override, else derive a catchmail inbox from a random seed so the
    // agent can read the confirmation code from it.
    const seed = randomBytes(6).toString('hex');
    const email = (overrides?.email && overrides.email.trim()) || accountsService.makeInbox(seed).address;
    const password = (overrides?.password && overrides.password.trim()) || generatePassword();
    const birthYear =
      typeof overrides?.birthYear === 'number' && overrides.birthYear >= 1950 && overrides.birthYear <= 2007
        ? overrides.birthYear
        : 1990 + (randomBytes(1)[0]! % 15); // 1990–2004

    const acc = await prisma.generatedAccount.create({
      data: {
        platform: 'instagram',
        status: 'REGISTERING',
        firstName: firstName ?? 'Fleet',
        lastName,
        emailAddress: email,
        passwordEnc: encryptString(password),
        birthDate: `${birthYear}-01-01`,
        deviceId,
        ...(workspaceId ? { workspaceId } : {})
      }
    });

    // Dispatch REGISTER_INSTAGRAM. As with WhatsApp, this is the point of no
    // return — if it fails, mark the account FAILED so it isn't stranded.
    let regJob;
    try {
      regJob = await createJobRecord(
        'REGISTER_INSTAGRAM',
        {
          deviceId,
          accountId: acc.id,
          email,
          // Encrypt the freshly-generated password; agent.materializePayload restores
          // passwordEnc→password at claim time. Prevents the plaintext password from
          // sitting in Job.payload / GET /jobs/:id.
          passwordEnc: encryptString(password),
          fullName,
          birthYear
        } as unknown as JobPayload,
        undefined,
        workspaceId
      );
    } catch (e) {
      await prisma.generatedAccount
        .update({ where: { id: acc.id }, data: { status: 'FAILED', error: e instanceof Error ? e.message : 'Kayıt işi başlatılamadı' } })
        .catch(() => undefined);
      throw e;
    }

    // Mark the device "Instagram kaydı sürüyor" so the profiles card shows a badge
    // and can reopen the live panel. Cleared by the REGISTER_INSTAGRAM hook.
    await prisma.device
      .update({
        where: { id: deviceId },
        data: {
          metadata: {
            ...((await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } }))?.metadata as Record<string, unknown> ?? {}),
            igRegisterStatus: 'REGISTERING',
            igRegisterAccountId: acc.id,
            igRegisterEmail: email,
            igRegisterJobId: regJob.id
          } as Prisma.InputJsonValue
        }
      })
      .catch(() => undefined);

    return {
      ...toPublic(acc),
      accountId: acc.id,
      deviceId,
      email,
      steps: IG_REGISTER_STEPS
    };
  }

  // Pass 2: the operator hands us the SMS code. Store it (encrypted) and re-
  // dispatch REGISTER_WHATSAPP WITH the otpCode so the agent enters it and
  // finishes the profile (random name). The completion hook then flips the
  // account to ACTIVE (or FAILED on a rejected code / wall).
  async provideOperatorOtp(
    workspaceId: string | undefined,
    accountId: string,
    otpCode: string
  ) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id: accountId, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (acc.status !== 'AWAITING_OTP') {
      throw new AppError('Hesap OTP aşamasında değil', 400, 'NOT_AWAITING_OTP');
    }
    if (!acc.deviceId) throw new AppError('Hesap bir cihaza bağlı değil', 400, 'NO_DEVICE');
    if (!acc.phoneNumber) throw new AppError('Hesapta numara yok', 400, 'NO_NUMBER');
    // Fail fast if the device went offline between register-start and OTP-submit — the
    // register-start endpoint already guarantees this; without it the OTP job sits
    // PENDING for ~6min while the caller polls a stale "REGISTERING". (BULGU 5.)
    await assertDeviceReady(acc.deviceId, workspaceId);

    const otp = otpCode.replace(/\D/g, '').slice(0, 8);
    if (!otp) throw new AppError('Geçerli bir OTP kodu gerekli', 400, 'INVALID_OTP');

    const fullName = [acc.firstName, acc.lastName].filter(Boolean).join(' ') || 'Fleet User';

    // Atomic AWAITING_OTP → REGISTERING transition. The earlier status check is a
    // fast-fail; this conditional update is the real guard. Two concurrent OTP
    // submissions (double-click / retry) would both pass the check above and each
    // dispatch a REGISTER_WHATSAPP job — this flips only once, so the loser gets
    // a 409 and no duplicate job is created.
    const claimed = await prisma.generatedAccount.updateMany({
      where: { id: acc.id, status: 'AWAITING_OTP' },
      data: { otpCodeEnc: encryptString(otp), status: 'REGISTERING', error: null }
    });
    if (claimed.count === 0) {
      throw new AppError('Hesap zaten işleniyor', 409, 'OTP_ALREADY_SUBMITTED');
    }
    const updated = await prisma.generatedAccount.findUniqueOrThrow({ where: { id: acc.id } });

    await createJobRecord(
      'REGISTER_WHATSAPP',
      {
        deviceId: acc.deviceId,
        accountId: acc.id,
        phoneNumber: acc.phoneNumber,
        fullName,
        otpCode: otp
      } as unknown as JobPayload,
      undefined,
      workspaceId,
      { skipBusyCheck: true } // OTP continuation of the same registration flow
    );

    return toPublic(updated);
  }

  // Operator picked a verification method on the "Choose how to verify" sheet
  // (sms | voice | missed_call). Re-dispatch REGISTER_WHATSAPP carrying verifyMethod so
  // the agent selects that row + Continue, instead of blindly guessing. Same atomic
  // AWAITING_OTP→REGISTERING guard as provideOperatorOtp so a double-tap can't create
  // two jobs.
  async provideVerifyMethod(
    workspaceId: string | undefined,
    accountId: string,
    method: string
  ) {
    const m = String(method || '').trim().toLowerCase();
    if (!['sms', 'voice', 'missed_call'].includes(m)) {
      throw new AppError('Geçersiz doğrulama yöntemi', 400, 'INVALID_VERIFY_METHOD');
    }
    const acc = await prisma.generatedAccount.findFirst({
      where: { id: accountId, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (acc.status !== 'AWAITING_OTP') {
      throw new AppError('Hesap doğrulama-yöntemi aşamasında değil', 400, 'NOT_AWAITING_OTP');
    }
    if (!acc.deviceId) throw new AppError('Hesap bir cihaza bağlı değil', 400, 'NO_DEVICE');
    if (!acc.phoneNumber) throw new AppError('Hesapta numara yok', 400, 'NO_NUMBER');
    // Same offline fast-fail as provideOperatorOtp (BULGU 5).
    await assertDeviceReady(acc.deviceId, workspaceId);

    const fullName = [acc.firstName, acc.lastName].filter(Boolean).join(' ') || 'Fleet User';

    const claimed = await prisma.generatedAccount.updateMany({
      where: { id: acc.id, status: 'AWAITING_OTP' },
      data: { status: 'REGISTERING', error: null }
    });
    if (claimed.count === 0) {
      throw new AppError('Hesap zaten işleniyor', 409, 'METHOD_ALREADY_SUBMITTED');
    }
    const updated = await prisma.generatedAccount.findUniqueOrThrow({ where: { id: acc.id } });

    await createJobRecord(
      'REGISTER_WHATSAPP',
      {
        deviceId: acc.deviceId,
        accountId: acc.id,
        phoneNumber: acc.phoneNumber,
        fullName,
        verifyMethod: m
      } as unknown as JobPayload,
      undefined,
      workspaceId,
      { skipBusyCheck: true } // continuation of the same registration flow
    );

    return toPublic(updated);
  }

  // Wait for a Job to reach a terminal state (COMPLETED / FAILED), polling the
  // row. Returns the job (with its result) or null on timeout.
  private async awaitJob(jobId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (job && (job.status === 'COMPLETED' || job.status === 'FAILED')) return job;
      await sleep(2500);
    }
    return null;
  }

  async cancel(workspaceId: string | undefined, id: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (acc.smsRequestId) await accountsService.smsCancel(acc.smsRequestId).catch(() => undefined);
    const updated = await prisma.generatedAccount.update({
      where: { id },
      data: { status: 'FAILED', error: 'iptal edildi' }
    });
    // ALSO clear the device's WA-registration badge so the profile card stops showing
    // "Kod bekleniyor" and unlocks the WhatsApp button for a fresh register. Without
    // this a stuck REGISTERING/AWAITING_OTP account left the card locked forever even
    // after cancel. Only clears if the badge belongs to THIS account.
    if (acc.deviceId) {
      const dev = await prisma.device.findUnique({ where: { id: acc.deviceId }, select: { metadata: true } }).catch(() => null);
      const meta = (dev?.metadata ?? {}) as Record<string, unknown>;
      if (meta.waRegisterAccountId === acc.id) {
        delete meta.waRegisterStatus;
        delete meta.waRegisterAccountId;
        delete meta.waRegisterPhone;
        delete meta.waRegisterJobId;
        await prisma.device.update({ where: { id: acc.deviceId }, data: { metadata: meta as object } }).catch(() => undefined);
      }
    }
    return toPublic(updated);
  }

  async remove(workspaceId: string | undefined, id: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    await prisma.generatedAccount.delete({ where: { id } });
    return { deleted: true };
  }
}

// Public shape: never leak encrypted secrets; expose whether they exist + the
// decrypted OTP (operators need to see it).
function toPublic(a: {
  id: string; batchId: string | null; platform: string; status: string;
  firstName: string | null; lastName: string | null; gender: string | null;
  birthDate: string | null; countryCode: string | null; emailAddress: string | null;
  username: string | null; phoneNumber: string | null; smsRequestId: string | null;
  otpCodeEnc: string | null; deviceId: string | null; error: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: a.id,
    batchId: a.batchId,
    platform: a.platform,
    status: a.status,
    firstName: a.firstName,
    lastName: a.lastName,
    fullName: [a.firstName, a.lastName].filter(Boolean).join(' ') || null,
    gender: a.gender,
    birthDate: a.birthDate,
    countryCode: a.countryCode,
    emailAddress: a.emailAddress,
    username: a.username,
    phoneNumber: a.phoneNumber,
    otpCode: a.otpCodeEnc ? decryptString(a.otpCodeEnc) : null,
    deviceId: a.deviceId,
    error: a.error,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  };
}

export const batchService = new BatchService();
