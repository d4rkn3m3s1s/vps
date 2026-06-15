import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { prisma } from '../db/prisma';
import { sha256 } from '../lib/crypto';

export async function requireApiKey(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
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
    next(new AppError('Invalid API key', 401, 'UNAUTHORIZED'));
    return;
  }

  req.apiKey = record;
  next();
}
