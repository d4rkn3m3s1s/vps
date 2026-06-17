import type { Request } from 'express';
import { prisma } from '../db/prisma';
import { sha256 } from './crypto';

// A request is a trusted server-side service call (eligible to bypass interactive
// security gates like 2FA) only if it asserts x-service-auth AND carries a
// currently-valid API key. Used by login and workspace switch.
export async function isServiceAuth(req: Request): Promise<boolean> {
  if (req.header('x-service-auth') !== '1') return false;
  const apiKey = req.header('x-api-key');
  if (!apiKey) return false;
  const record = await prisma.apiKey.findFirst({ where: { keyHash: sha256(apiKey), revokedAt: null } });
  return Boolean(record);
}
