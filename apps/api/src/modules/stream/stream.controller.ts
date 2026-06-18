import type { Request, Response } from 'express';
import { AppError } from '../../lib/errors';
import { signAccessToken } from '../../lib/jwt';
import { prisma } from '../../db/prisma';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { streamHub } from './stream.hub';

// Mints a short-lived token the browser uses to open the /ws/stream socket for a
// specific device. We re-sign a fresh access token (scoped to the caller's
// workspace) rather than expose the long-lived session — the WS layer verifies
// it the same way as any access token, and authorizes the device on connect.
export async function streamTokenHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const workspaceId = getWorkspaceId(req);
  const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, hostId: true, workspaceId: true } });
  if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  if (workspaceId && device.workspaceId && device.workspaceId !== workspaceId) {
    throw new AppError('Device not in your workspace', 403, 'FORBIDDEN');
  }
  if (!req.auth?.userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');

  const token = signAccessToken({
    sub: req.auth.userId,
    email: req.auth.email ?? '',
    role: req.auth.role ?? 'operator',
    ...(workspaceId ? { workspaceId } : {})
  });
  res.json({ data: { token, deviceId, online: Boolean(device.hostId) } });
}

// Live stream stats for the system/health dashboard.
export async function streamStatsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: streamHub.stats() });
}
