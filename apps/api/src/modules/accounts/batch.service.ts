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
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, decryptString, safeDecrypt } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { accountsService } from './accounts.service';
import * as fivesim from './providers/fivesim.provider';

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
      }

      data.error = null;
      const updated = await prisma.generatedAccount.update({ where: { id }, data });
      return toPublic(updated);
    } catch (e) {
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
    await assertDeviceInWorkspace(deviceId, workspaceId);

    if (acc.platform === 'instagram') {
      if (!acc.emailAddress || !acc.passwordEnc || !acc.firstName) {
        throw new AppError('Önce hesabı hazırlayın (kimlik+e-posta+şifre)', 400, 'NOT_PROVISIONED');
      }
      const payload = {
        accountId: acc.id,
        email: acc.emailAddress,
        password: decryptString(acc.passwordEnc),
        fullName: [acc.firstName, acc.lastName].filter(Boolean).join(' '),
        ...(acc.birthDate ? { birthYear: Number(acc.birthDate.slice(0, 4)) } : {}),
        ...(acc.username ? { username: acc.username } : {})
      } as unknown as JobPayload;
      const job = await createJobRecord('REGISTER_INSTAGRAM', payload, deviceId, workspaceId);
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
      const job = await createJobRecord('REGISTER_WHATSAPP', payload, deviceId, workspaceId);
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
    await assertDeviceInWorkspace(deviceId, workspaceId);
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
    const to = input.to.replace(/[^\d]/g, '');
    if (!to) throw new AppError('Geçerli bir telefon numarası gerekli', 400, 'INVALID_RECIPIENT');
    const payload = { deviceId: input.deviceId, to, message: input.message } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_SEND', payload, input.deviceId, workspaceId);
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
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
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
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
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
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_BLOCKLIST', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Read the account's OWN WhatsApp number off the device (Settings profile row).
  // The number lands on the Job result; poll the job. Workspace-guarded.
  async myNumber(workspaceId: string | undefined, input: { deviceId: string }) {
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
    const payload = { deviceId: input.deviceId } as unknown as JobPayload;
    const job = await createJobRecord('WHATSAPP_MYNUMBER', payload, input.deviceId, workspaceId);
    return { job };
  }

  // Send a media message (image/document) from a device to a peer. mediaUrl must
  // be a public URL (SSRF-guarded on the agent when it downloads). Device-scoped.
  async sendMedia(
    workspaceId: string | undefined,
    input: { deviceId: string; to: string; mediaUrl: string; caption?: string | undefined; kind?: 'image' | 'document' | undefined }
  ) {
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
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
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
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
    await assertDeviceInWorkspace(input.deviceId, workspaceId);
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
    await assertDeviceInWorkspace(deviceId, workspaceId);
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

    // 3) Persist the account row so progress is visible while we drive it.
    const acc = await prisma.generatedAccount.create({
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
    const job1 = await createJobRecord(
      'REGISTER_WHATSAPP',
      { deviceId, accountId: acc.id, phoneNumber: phoneE164, fullName } as unknown as JobPayload,
      undefined,
      workspaceId
    );
    const r1 = await this.awaitJob(job1.id, 120_000);
    if (!r1) return fail('TIMEOUT', 'Numara giriş jobı zaman aşımına uğradı');
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
        await prisma.generatedAccount.update({ where: { id: acc.id }, data: { otpCodeEnc: encryptString(otp) } });
        break;
      }
      await sleep(5000);
    }
    if (!otp) return fail('OTP_TIMEOUT', 'OTP gelmedi (9 dk beklendi, numara WhatsApp kodunu almadı)');

    // 6) Second on-device pass: enter the OTP, finish the profile.
    const job2 = await createJobRecord(
      'REGISTER_WHATSAPP',
      { deviceId, accountId: acc.id, phoneNumber: phoneE164, fullName, otpCode: otp } as unknown as JobPayload,
      undefined,
      workspaceId
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
    phoneNumber: string
  ) {
    if (!deviceId) throw new AppError('Cihaz belirtilmedi', 400, 'NO_DEVICE');
    // Verify the device belongs to this workspace before dispatching a job to it.
    await assertDeviceInWorkspace(deviceId, workspaceId);

    // Normalize to E.164 (agent's splitE164 wants a leading country code).
    const digits = phoneNumber.replace(/[^\d]/g, '');
    if (digits.length < 6) throw new AppError('Geçerli bir telefon numarası gerekli (ülke kodu dahil)', 400, 'INVALID_NUMBER');
    const phoneE164 = `+${digits}`;

    // Random identity for the WhatsApp profile name (offline-first, never throws).
    const ident = await accountsService.generateIdentity().catch(() => null);
    const fullName =
      [ident?.firstName, ident?.lastName].filter(Boolean).join(' ') || 'Fleet User';
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

    await createJobRecord(
      'REGISTER_WHATSAPP',
      { deviceId, accountId: acc.id, phoneNumber: phoneE164, fullName } as unknown as JobPayload,
      undefined,
      workspaceId
    );

    return toPublic(acc);
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

    const otp = otpCode.replace(/\D/g, '').slice(0, 8);
    if (!otp) throw new AppError('Geçerli bir OTP kodu gerekli', 400, 'INVALID_OTP');

    const fullName = [acc.firstName, acc.lastName].filter(Boolean).join(' ') || 'Fleet User';

    const updated = await prisma.generatedAccount.update({
      where: { id: acc.id },
      data: { otpCodeEnc: encryptString(otp), status: 'REGISTERING', error: null }
    });

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
      workspaceId
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
