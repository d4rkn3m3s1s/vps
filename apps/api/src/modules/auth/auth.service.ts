import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { sha256 } from '../../lib/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt';
import { env } from '../../config/env';
import type { AuthResponse, LoginInput } from './auth.types';

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

async function issueTokens(user: { id: string; email: string; role: string }): Promise<AuthResponse> {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
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
    user
  };
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const matches = await bcrypt.compare(input.password, user.passwordHash);
  if (!matches) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
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
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, createdAt: true, updatedAt: true } });
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return user;
}
