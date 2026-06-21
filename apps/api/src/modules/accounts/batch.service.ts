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
import { encryptString, decryptString } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { accountsService } from './accounts.service';

type Platform = 'whatsapp' | 'instagram' | 'facebook';

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

  // Register an account ON A DEVICE: dispatch a REGISTER_INSTAGRAM job carrying
  // the account's identity + email + password. The host agent runs the IG signup
  // RPA, reads the email confirmation code from catchmail itself, and reports
  // whether it CREATED the account or hit an SMS/captcha wall. Only Instagram is
  // automated today (email-based signup); other platforms aren't supported yet.
  async registerAccount(workspaceId: string | undefined, id: string, deviceId: string) {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    if (acc.platform !== 'instagram') throw new AppError('Otomatik kayıt şu an sadece Instagram için', 400, 'PLATFORM_UNSUPPORTED');
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
