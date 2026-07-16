import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { catalogService } from './catalog.service';

const installAppSchema = z.object({
  packageName: z.string().min(1),
  deviceIds: z.array(z.string()).min(1),
  // Optional operator-supplied APK download URL — required when the catalog item
  // has no bundled apkUrl (Play Store package names can't be installed directly).
  apkUrl: z.string().url().optional()
});

export async function listAppsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await catalogService.listApps() });
}

export async function installAppHandler(req: Request, res: Response): Promise<void> {
  const input = installAppSchema.parse(req.body);
  const result = await catalogService.installApp(input.packageName, input.deviceIds, input.apkUrl, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'app.install',
    resourceType: 'app',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { packageName: input.packageName, count: result.installed }
  });
  res.status(201).json({ data: result });
}
