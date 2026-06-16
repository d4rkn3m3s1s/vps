import { prisma } from '../../db/prisma';
import { encryptString, decryptString } from '../../lib/crypto';
import type { Prisma, SocialProvider } from '@prisma/client';

export async function upsertSocialAccount(opts: {
  provider: string;
  providerAccountId: string;
  userId: string;
  displayName?: string | undefined;
  username?: string | undefined;
  accessToken: string;
  refreshToken?: string | undefined;
  tokenExpiresAt?: Date | undefined;
  scopes?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}) {
  const encAccess = encryptString(opts.accessToken);
  const encRefresh = opts.refreshToken ? encryptString(opts.refreshToken) : undefined;

  const existing = await prisma.socialAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: opts.provider as SocialProvider,
        providerAccountId: opts.providerAccountId
      }
    }
  });

  if (existing) {
    return prisma.socialAccount.update({
      where: { id: existing.id },
      data: {
        displayName: opts.displayName ?? null,
        username: opts.username ?? null,
        accessTokenEnc: encAccess,
        refreshTokenEnc: encRefresh ?? null,
        tokenExpiresAt: opts.tokenExpiresAt ?? null,
        scopes: opts.scopes ?? [],
        metadata: (opts.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  }

  return prisma.socialAccount.create({
    data: {
      provider: opts.provider as SocialProvider,
      providerAccountId: opts.providerAccountId,
      userId: opts.userId,
      displayName: opts.displayName ?? null,
      username: opts.username ?? null,
      accessTokenEnc: encAccess,
      refreshTokenEnc: encRefresh ?? null,
      tokenExpiresAt: opts.tokenExpiresAt ?? null,
      scopes: opts.scopes ?? [],
      metadata: (opts.metadata ?? {}) as Prisma.InputJsonValue
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
