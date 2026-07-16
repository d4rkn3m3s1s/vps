import type { Request } from 'express';
import { prisma } from '../db/prisma';
import { sha256 } from './crypto';

// A request is a trusted server-side service call (eligible to bypass interactive
// security gates like 2FA) only if it asserts x-service-auth AND carries the ONE
// non-tenant bootstrap service key. Used by login and workspace switch.
//
// SECURITY: this must NOT accept just any valid API key. Any user can mint a
// workspace-scoped key (scopes like ['read'], workspaceId set); if that were enough,
// an attacker with a leaked user key + password could send x-service-auth:1 and skip
// 2FA entirely — defeating 2FA's whole purpose. So we require the key to be the
// bootstrap identity: keyPrefix 'default', no workspace, no user, wildcard scope
// (ensureBootstrapIdentity seeds exactly this; user-minted keys can never match).
export async function isServiceAuth(req: Request): Promise<boolean> {
  if (req.header('x-service-auth') !== '1') return false;
  const apiKey = req.header('x-api-key');
  if (!apiKey) return false;
  const record = await prisma.apiKey.findFirst({ where: { keyHash: sha256(apiKey), revokedAt: null } });
  if (!record) return false;
  return record.keyPrefix === 'default'
    && record.workspaceId === null
    && record.userId === null
    && record.scopes.includes('*');
}
