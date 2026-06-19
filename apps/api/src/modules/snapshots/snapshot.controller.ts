import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { snapshotService } from './snapshot.service';

const visibility = z.enum(['PRIVATE', 'WORKSPACE', 'PUBLIC']);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  visibility: visibility.optional()
});

export async function listSnapshotsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await snapshotService.listSnapshots(getWorkspaceId(req)) });
}

export async function listMarketHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await snapshotService.listMarket() });
}

export async function createSnapshotHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const input = createSchema.parse(req.body);
  const data = await snapshotService.createSnapshot(deviceId, input, {
    workspaceId: getWorkspaceId(req),
    userId: req.auth?.userId
  });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'snapshot.create',
    resourceType: 'device_snapshot',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { name: input.name }
  });
  res.status(201).json({ data });
}

const restoreSchema = z.object({ deviceId: z.string().min(1) });

export async function restoreSnapshotHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const { deviceId } = restoreSchema.parse(req.body);
  const data = await snapshotService.restoreSnapshot(id, deviceId, { workspaceId: getWorkspaceId(req) });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'snapshot.restore',
    resourceType: 'device_snapshot',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { deviceId }
  });
  res.json({ data });
}

const cloneSchema = z.object({
  name: z.string().min(1).max(80),
  groupId: z.string().optional(),
  hostId: z.string().optional()
});

export async function cloneSnapshotHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const input = cloneSchema.parse(req.body);
  const data = await snapshotService.cloneFromSnapshot(id, input, { workspaceId: getWorkspaceId(req) });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'snapshot.clone',
    resourceType: 'device_snapshot',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { newDeviceId: data.deviceId }
  });
  res.status(201).json({ data });
}

const resetSchema = z.object({
  regenerateFingerprint: z.boolean().optional(),
  wipeData: z.boolean().optional()
});

export async function resetDeviceHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const input = resetSchema.parse(req.body ?? {});
  const data = await snapshotService.resetDevice(deviceId, input, { workspaceId: getWorkspaceId(req) });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.reset',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { ...input }
  });
  res.json({ data });
}

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  visibility: visibility.optional()
});

export async function updateSnapshotHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const input = updateSchema.parse(req.body);
  res.json({ data: await snapshotService.updateSnapshot(id, input, getWorkspaceId(req)) });
}

export async function deleteSnapshotHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  res.json({ data: await snapshotService.deleteSnapshot(id, getWorkspaceId(req)) });
}
