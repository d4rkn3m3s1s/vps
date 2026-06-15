import type { Request, Response } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit/audit.service';
import { getCurrentUser, login, logout, refresh } from './auth.service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const result = await login(input);
  await writeAuditLog({
    userId: result.user.id,
    action: 'auth.login',
    resourceType: 'auth',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: result });
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const input = refreshSchema.parse(req.body);
  const result = await refresh(input.refreshToken);
  await writeAuditLog({
    userId: result.user.id,
    action: 'auth.refresh',
    resourceType: 'auth',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: result });
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const input = refreshSchema.parse(req.body);
  await logout(input.refreshToken);
  if (req.auth) {
    await writeAuditLog({
      userId: req.auth.userId,
      action: 'auth.logout',
      resourceType: 'auth',
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined
    });
  }
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    return;
  }

  const user = await getCurrentUser(req.auth.userId);
  res.json({ data: user });
}
