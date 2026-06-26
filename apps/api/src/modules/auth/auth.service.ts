import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { sha256 } from '../../lib/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt';
import { env } from '../../config/env';
import { verifyTwoFactorToken } from './twoFactor.service';
import type { AuthResponse, LoginInput, TwoFactorRequired } from './auth.types';

function createRefreshTokenId(): string {
  return crypto.randomUUID();
}

export async function ensureBootstrapIdentity(): Promise<void> {
  const passwordHash = await bcrypt.hash(env.adminPassword, 12);
  await prisma.user.upsert({
    where: { email: env.adminEmail },
    update: { passwordHash, role: 'admin' },
    create: {
      email: env.adminEmail,
      passwordHash,
      role: 'admin'
    }
  });

  await prisma.apiKey.upsert({
    where: { keyPrefix: 'default' },
    update: { keyHash: sha256(env.defaultApiKey), revokedAt: null, name: 'default-admin-key' },
    create: {
      keyPrefix: 'default',
      keyHash: sha256(env.defaultApiKey),
      name: 'default-admin-key',
      scopes: ['*']
    }
  });
}

// Resolve which workspace a freshly-issued token should be scoped to. If a
// preferred id is given and the user is a member, use it; otherwise fall back to
// their first membership (most recently anchored to 'default' on bootstrap).
// A user without 2FA is never scoped into a workspace that enforces require2fa —
// such workspaces are skipped so the default token never lands somewhere the
// switch gate would reject.
async function resolveActiveWorkspace(
  userId: string,
  preferredWorkspaceId?: string
): Promise<{ workspaceId: string; workspaceRole: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
  const has2fa = Boolean(user?.twoFactorEnabled);

  // Is this workspace blocked for a 2FA-less user?
  async function blocked(workspaceId: string): Promise<boolean> {
    if (has2fa) return false;
    const s = await prisma.workspaceSettings.findUnique({ where: { workspaceId } });
    return Boolean(s?.require2fa);
  }

  if (preferredWorkspaceId) {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: preferredWorkspaceId, userId } }
    });
    if (m && !(await blocked(m.workspaceId))) return { workspaceId: m.workspaceId, workspaceRole: m.role };
  }

  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  for (const m of memberships) {
    if (!(await blocked(m.workspaceId))) return { workspaceId: m.workspaceId, workspaceRole: m.role };
  }
  return null;
}

async function issueTokens(
  user: { id: string; email: string; role: string },
  preferredWorkspaceId?: string
): Promise<AuthResponse> {
  const ws = await resolveActiveWorkspace(user.id, preferredWorkspaceId);
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    ...(ws ? { workspaceId: ws.workspaceId, workspaceRole: ws.workspaceRole } : {})
  });
  const refreshTokenJti = createRefreshTokenId();
  const refreshToken = signRefreshToken({ sub: user.id, jti: refreshTokenJti });
  const refreshTokenHash = sha256(refreshToken);

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt: expiryDate
    }
  });

  return {
    accessToken,
    refreshToken,
    user,
    ...(ws ? { workspace: { id: ws.workspaceId, role: ws.workspaceRole } } : {})
  };
}

// Re-issues tokens scoped to a different workspace the user belongs to.
// The trusted server-side service identity bypasses the require2fa gate the same
// way it bypasses interactive 2FA at login.
export async function switchWorkspace(
  userId: string,
  workspaceId: string,
  options: { serviceAuth?: boolean } = {}
): Promise<AuthResponse> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } }
  });
  if (!member) throw new AppError('Not a member of that workspace', 403, 'FORBIDDEN');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  // Enforce the workspace's require2fa policy on interactive access.
  if (!options.serviceAuth) {
    const settings = await prisma.workspaceSettings.findUnique({ where: { workspaceId } });
    if (settings?.require2fa && !user.twoFactorEnabled) {
      throw new AppError(
        'This workspace requires two-factor authentication. Enable 2FA in Settings before switching to it.',
        403,
        'TWO_FACTOR_REQUIRED'
      );
    }
  }

  return issueTokens({ id: user.id, email: user.email, role: user.role }, workspaceId);
}

export async function login(
  input: LoginInput,
  options: { serviceAuth?: boolean } = {}
): Promise<AuthResponse | TwoFactorRequired> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const matches = await bcrypt.compare(input.password, user.passwordHash);
  if (!matches) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  // 2FA gate: password is correct, but if 2FA is on we need a valid code.
  // The server-side service client (trusted, holds the API key) bypasses 2FA —
  // 2FA protects the interactive browser login, not service-to-service auth.
  if (user.twoFactorEnabled && !options.serviceAuth) {
    if (!input.twoFactorToken) {
      return { twoFactorRequired: true };
    }
    const ok = await verifyTwoFactorToken(user.id, input.twoFactorToken);
    if (!ok) {
      throw new AppError('Invalid verification code', 401, 'TWO_FACTOR_INVALID_CODE');
    }
  }

  // Workspace-level require2fa policy: if the user has 2FA disabled and EVERY
  // workspace they belong to enforces 2FA, they cannot reach any workspace —
  // block login with actionable guidance instead of issuing a dead-end token.
  // (If only SOME workspaces require it, login succeeds into a non-required one;
  // the switch gate blocks the required ones.) Service auth bypasses this.
  if (!user.twoFactorEnabled && !options.serviceAuth) {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { workspaceId: true }
    });
    if (memberships.length > 0) {
      const enforcing = await prisma.workspaceSettings.count({
        where: { workspaceId: { in: memberships.map((m) => m.workspaceId) }, require2fa: true }
      });
      if (enforcing >= memberships.length) {
        throw new AppError(
          'All of your workspaces require two-factor authentication. Contact an admin to reset access and enable 2FA.',
          403,
          'TWO_FACTOR_REQUIRED'
        );
      }
    }
  }

  return issueTokens({ id: user.id, email: user.email, role: user.role });
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const payload = verifyRefreshToken(refreshToken);
  const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt.getTime() < Date.now()) {
    throw new AppError('Refresh token is not valid', 401, 'INVALID_REFRESH_TOKEN');
  }

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() }
  });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return issueTokens({ id: user.id, email: user.email, role: user.role });
}

export async function logout(refreshToken: string): Promise<void> {
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
  if (!token) return;
  await prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, twoFactorEnabled: true, createdAt: true, updatedAt: true } });
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return user;
}
