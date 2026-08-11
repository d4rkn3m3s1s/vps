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
  if (!req.auth?.userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  // FAIL-CLOSED: mint a stream token only when the caller has a workspace, the device
  // has one, and they match. The old `workspaceId && device.workspaceId && ...` guard
  // skipped entirely when either was null → a workspace-less token could stream+control
  // any (or any null-workspace) device. Same fix as stream.hub handleViewerUpgrade.
  if (!workspaceId || !device.workspaceId || device.workspaceId !== workspaceId) {
    throw new AppError('Device not in your workspace', 403, 'FORBIDDEN');
  }

  // ★2026-08-12: ömür 2 saatten 10 DAKİKAYA indirildi. Üstteki yorum "short-lived"
  // diyordu ama `signAccessToken` env varsayılanını (JWT_ACCESS_EXPIRES_IN=2h)
  // kullanıyordu — yani oturum token'ıyla AYNI ömür. Bu token `typ:'access'` taşıdığı
  // için sızması hâlinde 2 saat boyunca TÜM REST yüzeyinde geçerli olurdu.
  // 10 dakika neden yeterli: token yalnızca WS UPGRADE anında doğrulanıyor; bağlantı
  // kurulduktan sonra ömrü akışı etkilemiyor, kopmada panel yeni token alıyor.
  const token = signAccessToken({
    sub: req.auth.userId,
    email: req.auth.email ?? '',
    role: req.auth.role ?? 'operator',
    ...(workspaceId ? { workspaceId } : {})
  }, '10m');
  res.json({ data: { token, deviceId, online: Boolean(device.hostId) } });
}

// Live stream stats for the system/health dashboard.
export async function streamStatsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: streamHub.stats() });
}
