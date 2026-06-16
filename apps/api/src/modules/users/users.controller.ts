import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { createUser, deleteUser, listUsers } from './users.service';

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'member', 'viewer']).optional()
});

export async function listUsersHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await listUsers() });
}

export async function createUserHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const user = await createUser(input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'user.create',
    resourceType: 'user',
    resourceId: user.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { email: input.email, role: user.role }
  });
  res.status(201).json({ data: user });
}

export async function deleteUserHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('User id is required', 400, 'INVALID_USER_ID');
  const result = await deleteUser(id, req.auth?.userId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'user.delete',
    resourceType: 'user',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: result });
}
