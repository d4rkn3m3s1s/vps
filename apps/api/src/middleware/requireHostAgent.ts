import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { prisma } from '../db/prisma';
import { sha256 } from '../lib/crypto';

// Authenticates a KVM host agent by its one-time agent key (the value shown once
// at registration). The plaintext key is sent in the `x-agent-key` header; we
// look the host up by the sha256 hash so the key is never stored in the clear.
export async function requireHostAgent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const agentKey = req.header('x-agent-key');
  if (!agentKey) {
    next(new AppError('Missing agent key', 401, 'UNAUTHORIZED'));
    return;
  }

  const host = await prisma.host.findFirst({ where: { agentKeyHash: sha256(agentKey) } });
  if (!host) {
    next(new AppError('Invalid agent key', 401, 'UNAUTHORIZED'));
    return;
  }

  req.hostAgent = host;
  next();
}
