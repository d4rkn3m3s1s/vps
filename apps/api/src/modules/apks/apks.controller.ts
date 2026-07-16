import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { installBundledApk, listBundledApks } from './apks.service';

const installSchema = z.object({
  apkFile: z.string().min(1),
  deviceIds: z.array(z.string()).min(1)
});

// GET /apks — bundled APKs available for one-click install.
export async function listApksHandler(_req: Request, res: Response): Promise<void> {
  const apks = await listBundledApks();
  res.json({ data: apks });
}

// POST /apks/install — queue an install of a bundled APK onto devices.
export async function installApkHandler(req: Request, res: Response): Promise<void> {
  const input = installSchema.parse(req.body);
  // Fail-CLOSED: require a concrete workspace so the ownership guard inside
  // installBundledApk can't be bypassed by a workspace-less token (which made the
  // device filter drop, passing the check for ANY device ids — cross-tenant install).
  const workspaceId = requireWorkspaceId(req);
  const result = await installBundledApk(input.apkFile, input.deviceIds, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'apk.install',
    resourceType: 'apk',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { apkFile: input.apkFile, packageName: result.packageName, count: result.queued }
  });
  res.status(201).json({ data: result });
}
