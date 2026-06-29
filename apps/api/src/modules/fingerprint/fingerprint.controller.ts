import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { fingerprintService } from './fingerprint.service';

const generateSchema = z.object({
  countryCode: z.string().length(2).optional(),
  gpsEnabled: z.boolean().optional()
});

const gpsSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  gpsEnabled: z.boolean().optional(),
  countryCode: z.string().length(2).optional()
});

function requireDeviceId(req: Request): string {
  const id = req.params.deviceId ?? req.params.id;
  if (typeof id !== 'string') throw new AppError('Device id is required', 400, 'INVALID_DEVICE_ID');
  return id;
}

export async function getFingerprintHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const fp = await fingerprintService.get(deviceId);
  res.json({ data: fp });
}

export async function regenerateFingerprintHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const input = generateSchema.parse(req.body ?? {});
  const fp = await fingerprintService.regenerate(deviceId, input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'fingerprint.regenerate',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { model: fp.model, country: fp.country }
  });
  res.json({ data: fp });
}

export async function updateGpsHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const input = gpsSchema.parse(req.body ?? {});
  const fp = await fingerprintService.updateGps(deviceId, input);
  res.json({ data: fp });
}

export async function listCountriesHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: fingerprintService.listCountries() });
}

// Push the stored fingerprint to the physical device (setprop over ADB).
export async function applyFingerprintHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const workspaceId = getWorkspaceId(req);
  const data = await fingerprintService.applyToDevice(deviceId, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'fingerprint.apply',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { jobId: data.jobId }
  });
  res.status(201).json({ data });
}

// Provision device/Play integrity (BASIC props over ADB; STRONG needs real device).
export async function provisionIntegrityHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const workspaceId = getWorkspaceId(req);
  const data = await fingerprintService.provisionIntegrity(deviceId, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'fingerprint.provisionIntegrity',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { jobId: data.jobId }
  });
  res.status(201).json({ data });
}
