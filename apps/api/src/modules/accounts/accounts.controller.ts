import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
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
export async function smsOtpHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await accountsService.smsReadOtp(requireRequestId(req)) });
}
export async function smsCancelHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await accountsService.smsCancel(requireRequestId(req)) });
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
