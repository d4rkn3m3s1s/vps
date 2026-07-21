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
import { streamHub } from '../stream/stream.hub';
import { prisma } from '../../db/prisma';
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
  lastSeen: z.string().datetime().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  // Protect a valuable device (active account) from delete/reset/restore.
  protected: z.boolean().optional()
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
  const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const data = await deviceService.listDevices(getWorkspaceId(req), tag, search);
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
  const workspaceId = getWorkspaceId(req);
  // Tenant guard: only queue on-device jobs for a device in the caller's
  // workspace (otherwise a foreign deviceId could inject clipboard text into
  // another tenant's phone). Mirrors deviceShellHandler.
  const device = await deviceService.getDevice(deviceId, workspaceId);
  if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  const { text } = clipboardSetSchema.parse(req.body);
  const job = await createJobRecord('EMULATOR_CLIPBOARD_SET', { deviceId, text } as never, undefined, workspaceId);
  res.status(201).json({ data: { jobId: job.id } });
}

// Really start a stopped Waydroid instance (wd-run.sh + boot + route).
export async function wakeDeviceHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const data = await deviceService.wake(deviceId, getWorkspaceId(req));
  res.status(201).json({ data });
}

// Cleanly stop a running Waydroid instance (wd-stop.sh).
export async function sleepDeviceHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const data = await deviceService.sleep(deviceId, getWorkspaceId(req));
  res.status(201).json({ data });
}

// Reboot = sleep then wake (two chained jobs).
export async function rebootDeviceHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const data = await deviceService.reboot(deviceId, getWorkspaceId(req));
  res.status(201).json({ data });
}

// Operator "refresh stream" — recovers a live screen stuck on "bağlanıyor" by
// nudging the host agent to re-open ADB + re-send stream.start for this device.
// Reports whether the agent is actually reachable so the UI can say
// "aracı çevrimdışı" instead of silently doing nothing.
export async function refreshStreamHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const workspaceId = getWorkspaceId(req);
  const device = await prisma.device.findFirst({
    where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true, hostId: true, ipAddress: true, adbPort: true }
  });
  if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
  const serial = device.ipAddress && device.adbPort ? `${device.ipAddress}:${device.adbPort}` : null;
  const { agentConnected } = streamHub.refreshDeviceStream(device.id, device.hostId, serial);
  res.json({
    data: {
      agentConnected,
      ...(agentConnected
        ? { message: 'Yayın yenilendi — birkaç saniye içinde görüntü gelmeli.' }
        : { message: 'Sunucu aracısı çevrimdışı görünüyor — yayın başlatılamadı. Aracıyı/cihazı kontrol edin.' })
    }
  });
}

// Read the device clipboard (queues a job; result lands on the job record).
export async function clipboardGetHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const workspaceId = getWorkspaceId(req);
  const device = await deviceService.getDevice(deviceId, workspaceId);
  if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  const job = await createJobRecord('EMULATOR_CLIPBOARD_GET', { deviceId } as never, undefined, workspaceId);
  res.status(201).json({ data: { jobId: job.id } });
}

const pullSchema = z.object({ remotePath: z.string().min(1).max(500) });

// Pull a file off the device to the host (queues a job; the agent returns the
// host-side path on completion).
export async function pullFileHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const workspaceId = getWorkspaceId(req);
  // Tenant guard: prevent pulling files off another tenant's device (data exfil).
  const device = await deviceService.getDevice(deviceId, workspaceId);
  if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  const { remotePath } = pullSchema.parse(req.body);
  const job = await createJobRecord('EMULATOR_PULL_FILE', { deviceId, remotePath } as never, undefined, workspaceId);
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
  deviceHub.broadcast({ type: 'device.created', deviceId: data.id, payload: data, timestamp: new Date().toISOString(), ...(workspaceId ? { workspaceId } : {}) });
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

// Quick profile — Multilogin-style one-call disposable cloud phone.
const quickProfileSchema = z.object({
  countryCode: z.string().length(2).optional(),
  deviceModel: z.string().optional(),
  androidVersion: z.string().optional(),
  ramGb: z.coerce.number().int().positive().optional(),
  cpuCores: z.coerce.number().int().positive().optional(),
  autoStart: z.boolean().optional()
});
export async function quickProfileHandler(req: Request, res: Response): Promise<void> {
  const input = quickProfileSchema.parse(req.body ?? {});
  const workspaceId = getWorkspaceId(req);
  const unlimited = req.auth?.role === 'admin' || req.auth?.workspaceRole === 'admin';
  if (workspaceId) await billingService.assertCanAddDevice(workspaceId, { unlimited });
  const result = await deviceService.quickProfile(input, workspaceId);
  deviceHub.broadcast({ type: 'device.created', deviceId: result.device.id, payload: result.device, timestamp: new Date().toISOString(), ...(workspaceId ? { workspaceId } : {}) });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.quick',
    resourceType: 'device',
    resourceId: result.device.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: toAuditMetadata({ ...input })
  });
  res.status(201).json({ data: result });
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

// Per-device CPU/mem/disk timeseries for the health charts. ?hours=N (1..168).
export async function getDeviceMetricsHandler(req: Request, res: Response): Promise<void> {
  const id = requireDeviceId(req);
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'view');
  const hours = Math.min(Math.max(1, Number(req.query.hours) || 6), 168);
  const data = await deviceService.getMetrics(id, hours, getWorkspaceId(req));
  res.json({ data });
}

export async function updateDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = deviceUpdateSchema.parse(req.body);
  const id = requireDeviceId(req);
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'control');
  const updWsId = getWorkspaceId(req);
  const data = await deviceService.updateDevice(id, input, updWsId);
  deviceHub.broadcast({ type: 'device.updated', deviceId: id, payload: data, timestamp: new Date().toISOString(), ...(updWsId ? { workspaceId: updWsId } : {}) });
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
  const delWsId = getWorkspaceId(req);
  const data = await deviceService.deleteDevice(id, delWsId);
  deviceHub.broadcast({ type: 'device.deleted', deviceId: id, payload: data, timestamp: new Date().toISOString(), ...(delWsId ? { workspaceId: delWsId } : {}) });
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
  const data = await deviceService.updateGroup(requireGroupId(req), input, getWorkspaceId(req));
  res.json({ data });
}

export async function deleteGroupHandler(req: Request, res: Response): Promise<void> {
  await deviceService.deleteGroup(requireGroupId(req), getWorkspaceId(req));
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
  const workspaceId = getWorkspaceId(req);
  // Load-bearing: resolve the device strictly within the caller's workspace so a
  // tenant can't queue an arbitrary shell command against another tenant's device
  // (the host agent runs the job by device.hostId binding). getDevice uses a
  // workspace-scoped findFirst → cross-workspace ids return null → 404.
  const device = await deviceService.getDevice(id, workspaceId);
  if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'control');
  const { command } = shellSchema.parse(req.body);
  const job = await createJobRecord('EMULATOR_SHELL', { deviceId: id, command } as never, undefined, workspaceId);
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
