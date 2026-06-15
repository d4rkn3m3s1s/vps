import { prisma } from '../../db/prisma';
import { encryptString, decryptString } from '../../lib/crypto';
import type { Prisma } from '@prisma/client';

export async function upsertSocialAccount(opts: {
  provider: string;
  providerAccountId: string;
  userId: string;
  displayName?: string;
  username?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}) {
  const encAccess = encryptString(opts.accessToken);
  const encRefresh = opts.refreshToken ? encryptString(opts.refreshToken) : undefined;

  const existing = await prisma.socialAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: opts.provider as Prisma.SocialProvider,
        providerAccountId: opts.providerAccountId
      }
    }
  });

  if (existing) {
    return prisma.socialAccount.update({
      where: { id: existing.id },
      data: {
        displayName: opts.displayName,
        username: opts.username,
        accessTokenEnc: encAccess,
        refreshTokenEnc: encRefresh,
        tokenExpiresAt: opts.tokenExpiresAt,
        scopes: opts.scopes ?? [],
        metadata: opts.metadata ?? {}
      }
    });
  }

  return prisma.socialAccount.create({
    data: {
      provider: opts.provider as Prisma.SocialProvider,
      providerAccountId: opts.providerAccountId,
      userId: opts.userId,
      displayName: opts.displayName,
      username: opts.username,
      accessTokenEnc: encAccess,
      refreshTokenEnc: encRefresh,
      tokenExpiresAt: opts.tokenExpiresAt,
      scopes: opts.scopes ?? [],
      metadata: opts.metadata ?? {}
    }
  });
}

export async function listSocialAccountsForUser(userId: string) {
  const rows = await prisma.socialAccount.findMany({ where: { userId } });
  return rows.map(r => ({
    id: r.id,
    provider: r.provider,
    providerAccountId: r.providerAccountId,
    displayName: r.displayName,
    username: r.username,
    tokenExpiresAt: r.tokenExpiresAt,
    scopes: r.scopes,
    metadata: r.metadata
  }));
}

export async function getAccessTokenForAccount(id: string): Promise<string | null> {
  const row = await prisma.socialAccount.findUnique({ where: { id } });
  if (!row) return null;
  try {
    return decryptString(row.accessTokenEnc);
  } catch (err) {
    return null;
  }
}
