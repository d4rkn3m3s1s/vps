import crypto from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, decryptString, sha256 } from '../../lib/crypto';

const ISSUER = 'VPS Fleet';

// Verify a TOTP code with ±30s tolerance for client clock skew.
function verifyTotp(token: string, secret: string): boolean {
  try {
    return verifySync({ token, secret, epochTolerance: [30, 30] }).valid;
  } catch {
    return false;
  }
}

function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').replace(/(.{5})(.{5})/, '$1-$2')
  );
}

// Begins enrollment: generates a secret + otpauth QR. The secret is stored
// encrypted but 2FA is NOT enabled until the user confirms a valid code.
export async function setupTwoFactor(userId: string): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (user.twoFactorEnabled) throw new AppError('2FA is already enabled', 409, 'TWO_FACTOR_ALREADY_ENABLED');

  const secret = generateSecret();
  const otpauthUrl = generateURI({ strategy: 'totp', issuer: ISSUER, label: user.email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptString(secret) }
  });

  return { otpauthUrl, qrDataUrl, secret };
}

// Confirms enrollment with a TOTP code, enables 2FA, returns one-time backup
// codes (shown once).
export async function enableTwoFactor(userId: string, token: string): Promise<{ backupCodes: string[] }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (user.twoFactorEnabled) throw new AppError('2FA is already enabled', 409, 'TWO_FACTOR_ALREADY_ENABLED');
  if (!user.twoFactorSecret) throw new AppError('Run 2FA setup first', 400, 'TWO_FACTOR_NOT_SETUP');

  const secret = decryptString(user.twoFactorSecret);
  if (!verifyTotp(token, secret)) {
    throw new AppError('Invalid verification code', 400, 'TWO_FACTOR_INVALID_CODE');
  }

  const backupCodes = generateBackupCodes();
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorBackupCodes: backupCodes.map((c) => sha256(c))
    }
  });

  return { backupCodes };
}

// Disables 2FA. Requires a valid TOTP (or backup) code so a hijacked session
// can't silently turn it off.
export async function disableTwoFactor(userId: string, token: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (!user.twoFactorEnabled) throw new AppError('2FA is not enabled', 409, 'TWO_FACTOR_NOT_ENABLED');

  const ok = await verifyTwoFactorToken(userId, token);
  if (!ok) throw new AppError('Invalid verification code', 400, 'TWO_FACTOR_INVALID_CODE');

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] }
  });
}

// Verifies a TOTP code OR a one-time backup code (consuming it). Used by login.
export async function verifyTwoFactorToken(userId: string, token: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return false;

  const secret = decryptString(user.twoFactorSecret);
  if (verifyTotp(token, secret)) return true;

  // Fall back to a single-use backup code.
  const hashed = sha256(token.trim());
  if (user.twoFactorBackupCodes.includes(hashed)) {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: user.twoFactorBackupCodes.filter((c) => c !== hashed) }
    });
    return true;
  }
  return false;
}
