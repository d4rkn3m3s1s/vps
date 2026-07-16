import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { bulkService } from './bulk.service';

// The bulk endpoint may ONLY fan out device-lifecycle + install/proxy actions.
// Sensitive per-device operations (EMULATOR_SHELL, RPA_RUN, AGENT_RUN, the register
// flows, …) are intentionally excluded: those have dedicated single-device routes
// that enforce a per-device RBAC 'control' check + a command-level audit trail. The
// bulk router only does workspace-ownership scoping, so allowing arbitrary job types
// here let a granted VIEW-only member run adb shell on their own devices, bypassing
// the control gate and the shell audit. Allow-list, not the full JobTypes enum.
const BULK_ALLOWED_JOB_TYPES = [
  'DEVICE_WAKE', 'DEVICE_SLEEP',
  'EMULATOR_START', 'EMULATOR_STOP',
  'EMULATOR_OPEN_APP', 'EMULATOR_CLOSE_APP',
  'EMULATOR_INSTALL_APK', 'EMULATOR_SET_PROXY', 'APPLY_FINGERPRINT'
] as const;

const bulkJobSchema = z.object({
  deviceIds: z.array(z.string()).min(1),
  jobType: z.enum(BULK_ALLOWED_JOB_TYPES),
  payload: z.record(z.any()).optional()
});

const bulkProxySchema = z.object({
  deviceIds: z.array(z.string()).min(1),
  proxyId: z.string().min(1)
});

export async function bulkJobHandler(req: Request, res: Response): Promise<void> {
  const input = bulkJobSchema.parse(req.body);
  const result = await bulkService.runJob(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'bulk.job',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { jobType: input.jobType, count: result.created }
  });
  res.status(201).json({ data: result });
}

export async function bulkProxyHandler(req: Request, res: Response): Promise<void> {
  const input = bulkProxySchema.parse(req.body);
  const result = await bulkService.setProxy(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'bulk.proxy',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { proxyId: input.proxyId, count: result.updated }
  });
  res.status(201).json({ data: result });
}

const bulkDeviceIdsSchema = z.object({ deviceIds: z.array(z.string()).min(1) });

export async function bulkStopHandler(req: Request, res: Response): Promise<void> {
  const { deviceIds } = bulkDeviceIdsSchema.parse(req.body);
  const result = await bulkService.stopDevices(deviceIds, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'bulk.stop',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { count: result.stopped }
  });
  res.status(201).json({ data: result });
}

export async function bulkDeleteHandler(req: Request, res: Response): Promise<void> {
  const { deviceIds } = bulkDeviceIdsSchema.parse(req.body);
  const result = await bulkService.deleteDevices(deviceIds, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'bulk.delete',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { count: result.deleted }
  });
  res.json({ data: result });
}
