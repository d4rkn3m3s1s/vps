import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { deviceHub } from './device.hub';
import { DeviceService } from './device.service';

const deviceService = new DeviceService();

const deviceCreateSchema = z.object({
  name: z.string().min(2),
  ipAddress: z.string().optional(),
  adbPort: z.coerce.number().int().positive().optional(),
  androidVersion: z.string().optional(),
  groupId: z.string().optional(),
  metadata: z.unknown().optional()
});

const deviceUpdateSchema = deviceCreateSchema.partial().extend({
  status: z.enum(['ONLINE', 'OFFLINE', 'STARTING', 'STOPPING', 'ERROR', 'UPDATING', 'REBOOTING']).optional(),
  cpuUsage: z.coerce.number().min(0).max(100).optional(),
  memoryUsage: z.coerce.number().min(0).max(100).optional(),
  diskUsage: z.coerce.number().min(0).max(100).optional(),
  groupId: z.string().nullable().optional(),
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

export async function listDevicesHandler(_req: Request, res: Response): Promise<void> {
  const data = await deviceService.listDevices();
  res.json({ data });
}

export async function createDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = deviceCreateSchema.parse(req.body);
  const data = await deviceService.createDevice(input);
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
  const data = await deviceService.getDevice(requireDeviceId(req));
  if (!data) {
    res.status(404).json({ error: 'DEVICE_NOT_FOUND', message: 'Device not found' });
    return;
  }
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

export async function listGroupsHandler(_req: Request, res: Response): Promise<void> {
  const data = await deviceService.listGroups();
  res.json({ data });
}

export async function createGroupHandler(req: Request, res: Response): Promise<void> {
  const input = groupCreateSchema.parse(req.body);
  const data = await deviceService.createGroup(input);
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

export async function deviceStatusSummaryHandler(_req: Request, res: Response): Promise<void> {
  const data = await deviceService.countByStatus();
  res.json({ data });
}
