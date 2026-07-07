import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { prisma } from '../db/prisma';
import { sha256 } from '../lib/crypto';
import { logger } from '../lib/logger';

// Lightweight abuse log for rejected API-key attempts. Throttled per source IP
// (~once/min) so the logging itself can't be turned into a secondary DoS / disk
// filler by an attacker spraying bad keys.
const lastAbuseLog = new Map<string, number>();
function logKeyAbuse(req: Request, reason: 'missing' | 'invalid'): void {
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const prev = lastAbuseLog.get(ip) ?? 0;
  if (now - prev < 60_000) return;
  lastAbuseLog.set(ip, now);
  // Keep the map bounded.
  if (lastAbuseLog.size > 5000) {
    for (const [k, t] of lastAbuseLog) if (now - t > 300_000) lastAbuseLog.delete(k);
  }
  logger.warn('api-key auth rejected', {
    reason,
    ip,
    path: req.path,
    method: req.method,
    userAgent: req.get('user-agent') ?? undefined
  });
}

export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    logKeyAbuse(req, 'missing');
    next(new AppError('Missing API key', 401, 'UNAUTHORIZED'));
    return;
  }

  const hashed = sha256(apiKey);
  const record = await prisma.apiKey.findFirst({
    where: {
      keyHash: hashed,
      revokedAt: null
    }
  });

  if (!record) {
    logKeyAbuse(req, 'invalid');
    next(new AppError('Invalid API key', 401, 'UNAUTHORIZED'));
    return;
  }

  req.apiKey = record;

  // Track usage (fire-and-forget, throttled to ~once/min to avoid a DB write on
  // every request). Never blocks or fails the request.
  const lastUsed = record.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsed > 60_000) {
    void prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }

  next();
}
