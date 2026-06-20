import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { billingService } from '../billing/billing.service';
import { writeAuditLog } from '../audit/audit.service';
import { deviceHub } from './device.hub';
import { DeviceService } from './device.service';
import { createJobRecord } from '../jobs/jobs.service';
import { permissionsService } from '../permissions/permissions.service';
import { DEVICE_MODELS } from '../fingerprint/fingerprint.data';

const deviceService = new DeviceService();

const shellSchema = z.object({ command: z.string().min(1) });

const deviceCreateSchema = z.object({
  name: z.string().min(2),
  ipAddress: z.string().optional(),
  adbPort: z.coerce.number().int().positive().optional(),
  androidVersion: z.string().optional(),
  groupId: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  metadata: z.unknown().optional(),
  // Provisioning catalog selections.
  deviceModel: z.string().max(80).optional(),
  ramGb: z.coerce.number().int().min(2).max(24).optional(),
  cpuCores: z.coerce.number().int().min(2).max(16).optional()
});

const deviceUpdateSchema = deviceCreateSchema.partial().extend({
  status: z.enum(['ONLINE', 'OFFLINE', 'STARTING', 'STOPPING', 'ERROR', 'UPDATING', 'REBOOTING']).optional(),
  cpuUsage: z.coerce.number().min(0).max(100).optional(),
  memoryUsage: z.coerce.number().min(0).max(100).optional(),
  diskUsage: z.coerce.number().min(0).max(100).optional(),
  groupId: z.string().nullable().optional(),
  hostId: z.string().nullable().optional(),
  lastSeen: z.string().datetime().optional()
});

const deviceHeartbeatSchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE', 'STARTING', 'STOPPING', 'ERROR', 'UPDATING', 'REBOOTING']).optional(),
  cpuUsage: z.coerce.number().min(0).max(100).optional(),
  memoryUsage: z.coerce.number().min(0).max(100).optional(),
  diskUsage: z.coerce.number().min(0).max(100).optional(),
  lastSeen: z.string().datetime().optional()
});

const groupCreateSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional()
});

const groupUpdateSchema = groupCreateSchema.partial().extend({
  description: z.string().nullable().optional()
});

function requireDeviceId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') {
    throw new AppError('Device id is required', 400, 'INVALID_DEVICE_ID');
  }
  return id;
}

function requireGroupId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') {
    throw new AppError('Device group id is required', 400, 'INVALID_DEVICE_GROUP_ID');
  }
  return id;
}

function toAuditMetadata(value: unknown): Prisma.JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

export async function listDevicesHandler(req: Request, res: Response): Promise<void> {
  const data = await deviceService.listDevices(getWorkspaceId(req));
  // Granular RBAC: a restricted (non-admin, has-grants) user only sees the
  // devices/groups they were granted. Service identity (no JWT) is unrestricted.
  if (req.auth) {
    const visible = await permissionsService.filterVisibleDevices(req.auth.userId, req.auth.role, data);
    res.json({ data: visible });
    return;
  }
  res.json({ data });
}

// ── File transfer + clipboard ────────────────────────────────────────────
const clipboardSetSchema = z.object({ text: z.string().max(10000) });

// Set the device clipboard to the given text (dispatched to the host agent).
export async function clipboardSetHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const { text } = clipboardSetSchema.parse(req.body);
  const job = await createJobRecord('EMULATOR_CLIPBOARD_SET', { deviceId, text } as never, undefined, getWorkspaceId(req));
  res.status(201).json({ data: { jobId: job.id } });
}

// Read the device clipboard (queues a job; result lands on the job record).
export async function clipboardGetHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const job = await createJobRecord('EMULATOR_CLIPBOARD_GET', { deviceId } as never, undefined, getWorkspaceId(req));
  res.status(201).json({ data: { jobId: job.id } });
}

const pullSchema = z.object({ remotePath: z.string().min(1).max(500) });

// Pull a file off the device to the host (queues a job; the agent returns the
// host-side path on completion).
export async function pullFileHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const { remotePath } = pullSchema.parse(req.body);
  const job = await createJobRecord('EMULATOR_PULL_FILE', { deviceId, remotePath } as never, undefined, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.file.pull',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { remotePath }
  });
  res.status(201).json({ data: { jobId: job.id } });
}

// Provisioning catalog: the device models + hardware tiers an operator can pick
// from when creating a cloud phone. Sourced from the fingerprint device table
// so the chosen model maps to a real, plausible fingerprint.
export async function provisioningCatalogHandler(_req: Request, res: Response): Promise<void> {
  res.json({
    data: {
      models: DEVICE_MODELS.map((d) => ({
        model: d.model,
        manufacturer: d.manufacturer,
        brand: d.brand,
        resolution: d.resolution,
        dpi: d.dpi,
        osVersions: d.osVersions
      })),
      // Common cloud-phone hardware tiers (RAM/CPU), purely advisory metadata.
      ramTiers: [4, 6, 8, 12],
      cpuTiers: [4, 6, 8]
    }
  });
}

export async function createDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = deviceCreateSchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  // Enforce the plan's device quota before creating (workspace-scoped calls only).
  // Admins / workspace owners are uncapped — on a self-hosted install the operator
  // who runs the platform shouldn't be limited by billing plans.
  const unlimited = req.auth?.role === 'admin' || req.auth?.workspaceRole === 'admin';
  if (workspaceId) await billingService.assertCanAddDevice(workspaceId, { unlimited });
  const data = await deviceService.createDevice(input, workspaceId);
  deviceHub.broadcast({ type: 'device.created', deviceId: data.id, payload: data, timestamp: new Date().toISOString() });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.create',
    resourceType: 'device',
    resourceId: data.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: toAuditMetadata({ ...input })
  });
  res.status(201).json({ data });
}

export async function getDeviceHandler(req: Request, res: Response): Promise<void> {
  const id = requireDeviceId(req);
  const data = await deviceService.getDevice(id, getWorkspaceId(req));
  if (!data) {
    res.status(404).json({ error: 'DEVICE_NOT_FOUND', message: 'Device not found' });
    return;
  }
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'view');
  res.json({ data });
}

export async function updateDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = deviceUpdateSchema.parse(req.body);
  const id = requireDeviceId(req);
  const data = await deviceService.updateDevice(id, input);
  deviceHub.broadcast({ type: 'device.updated', deviceId: id, payload: data, timestamp: new Date().toISOString() });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.update',
    resourceType: 'device',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: toAuditMetadata({ ...input })
  });
  res.json({ data });
}

export async function deleteDeviceHandler(req: Request, res: Response): Promise<void> {
  const id = requireDeviceId(req);
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'delete');
  const data = await deviceService.deleteDevice(id);
  deviceHub.broadcast({ type: 'device.deleted', deviceId: id, payload: data, timestamp: new Date().toISOString() });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.delete',
    resourceType: 'device',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.status(204).send();
}

export async function heartbeatDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = deviceHeartbeatSchema.parse(req.body);
  const id = requireDeviceId(req);
  const data = await deviceService.heartbeat(id, input);
  deviceHub.broadcast({ type: 'device.heartbeat', deviceId: id, payload: data, timestamp: new Date().toISOString() });
  res.json({ data });
}

export async function listGroupsHandler(req: Request, res: Response): Promise<void> {
  const data = await deviceService.listGroups(getWorkspaceId(req));
  res.json({ data });
}

export async function createGroupHandler(req: Request, res: Response): Promise<void> {
  const input = groupCreateSchema.parse(req.body);
  const data = await deviceService.createGroup(input, getWorkspaceId(req));
  res.status(201).json({ data });
}

export async function updateGroupHandler(req: Request, res: Response): Promise<void> {
  const input = groupUpdateSchema.parse(req.body);
  const data = await deviceService.updateGroup(requireGroupId(req), input);
  res.json({ data });
}

export async function deleteGroupHandler(req: Request, res: Response): Promise<void> {
  await deviceService.deleteGroup(requireGroupId(req));
  res.status(204).send();
}

export async function deviceStatusSummaryHandler(req: Request, res: Response): Promise<void> {
  const data = await deviceService.countByStatus(getWorkspaceId(req));
  res.json({ data });
}

// Runs a raw ADB shell command on the device by recording a SHELL job. The
// command executes once a KVM host is attached to the fleet.
export async function deviceShellHandler(req: Request, res: Response): Promise<void> {
  const id = requireDeviceId(req);
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'control');
  const { command } = shellSchema.parse(req.body);
  const job = await createJobRecord('EMULATOR_SHELL', { deviceId: id, command });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.shell',
    resourceType: 'device',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { command }
  });
  res.status(201).json({ data: { jobId: job.id } });
}
