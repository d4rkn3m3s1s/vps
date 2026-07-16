import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { prisma } from '../../db/prisma';
import { accountsService } from './accounts.service';

// Phase 1: provider connectivity + primitive operations (number/OTP/mail/
// identity). These are the building blocks the on-device registrar will call.

export async function providerStatusHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await accountsService.providerStatus() });
}

// ── SMS (sms-bus) ────────────────────────────────────────────────────────────
export async function smsBalanceHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await accountsService.smsBalance() });
  } catch (err) {
    res.json({ data: null, unavailable: true, reason: err instanceof Error ? err.message : 'provider unreachable' });
  }
}

// These two are read-only catalog lookups the accounts UI fetches on mount. If
// the SMS provider is unreachable (no internet / provider down) we degrade
// gracefully to an empty list + `unavailable` flag instead of a 500, so the page
// renders a "provider offline" state rather than crashing.
export async function smsCountriesHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await accountsService.smsCountries() });
  } catch (err) {
    res.json({ data: [], unavailable: true, reason: err instanceof Error ? err.message : 'provider unreachable' });
  }
}

export async function smsProjectsHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ data: await accountsService.smsProjects() });
  } catch (err) {
    res.json({ data: [], unavailable: true, reason: err instanceof Error ? err.message : 'provider unreachable' });
  }
}

const getNumberSchema = z.object({
  countryId: z.union([z.string(), z.number()]),
  projectId: z.union([z.string(), z.number()]),
  reuse: z.boolean().optional()
});
export async function smsGetNumberHandler(req: Request, res: Response): Promise<void> {
  const { countryId, projectId, reuse } = getNumberSchema.parse(req.body);
  res.json({ data: await accountsService.smsGetNumber(countryId, projectId, reuse) });
}

function requireRequestId(req: Request): string {
  const id = req.params.requestId;
  if (typeof id !== 'string' || !id) throw new AppError('request_id gereklidir', 400, 'INVALID_REQUEST_ID');
  return id;
}
// SECURITY: the provider's request_id is a shared, guessable global id and the SMS
// provider key is platform-wide, so reading/cancelling by raw request_id is a
// cross-tenant IDOR (another tenant's WhatsApp/IG OTP could be read → account
// takeover). Only allow a request_id that maps to a GeneratedAccount IN THE CALLER'S
// workspace (the rented number's requestId is persisted there at rental time).
async function assertOwnsRequestId(req: Request): Promise<string> {
  const requestId = requireRequestId(req);
  const workspaceId = getWorkspaceId(req);
  const owned = await prisma.generatedAccount.findFirst({
    where: { smsRequestId: requestId, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true }
  });
  if (!owned) throw new AppError('İstek bulunamadı', 404, 'REQUEST_NOT_FOUND');
  return requestId;
}
export async function smsOtpHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await accountsService.smsReadOtp(await assertOwnsRequestId(req)) });
}
export async function smsCancelHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await accountsService.smsCancel(await assertOwnsRequestId(req)) });
}

// ── Mail (catchmail) ─────────────────────────────────────────────────────────
const inboxSchema = z.object({ seed: z.string().min(1) });
export async function makeInboxHandler(req: Request, res: Response): Promise<void> {
  const { seed } = inboxSchema.parse(req.body);
  res.json({ data: accountsService.makeInbox(seed) });
}

function requireAddress(req: Request): string {
  const a = req.query.address;
  if (typeof a !== 'string' || !a.includes('@')) throw new AppError('address gereklidir', 400, 'INVALID_ADDRESS');
  return a;
}
export async function mailInboxHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await accountsService.mailInbox(requireAddress(req)) });
}
export async function mailMessageHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (typeof id !== 'string' || !id) throw new AppError('mesaj id gereklidir', 400, 'INVALID_MESSAGE_ID');
  res.json({ data: await accountsService.mailMessage(requireAddress(req), id) });
}

// ── Identity (randomuser) ────────────────────────────────────────────────────
const identitySchema = z.object({
  country: z.string().min(2).max(2).optional(),
  gender: z.enum(['male', 'female']).optional()
});
export async function generateIdentityHandler(req: Request, res: Response): Promise<void> {
  const { country, gender } = identitySchema.parse(req.body ?? {});
  res.json({ data: await accountsService.generateIdentity(country, gender) });
}
