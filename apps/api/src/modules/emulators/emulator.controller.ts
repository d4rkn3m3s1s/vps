import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { EmulatorService } from './emulator.service';

const emulatorService = new EmulatorService();

const createSchema = z.object({
  name: z.string().min(2),
  image: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const installSchema = z.object({
  apkPath: z.string().min(1)
});

const shellSchema = z.object({
  command: z.string().min(1)
});

const appSchema = z.object({
  packageName: z.string().min(1),
  activity: z.string().optional()
});

function requireEmulatorId(req: Request): string {
  const emulatorId = req.params.id;
  if (typeof emulatorId !== 'string') {
    throw new AppError('Emulator id is required', 400, 'INVALID_EMULATOR_ID');
  }

  return emulatorId;
}

export async function createEmulatorHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const result = await emulatorService.create(input, req.auth?.userId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.create',
    resourceType: 'emulator',
    resourceId: result.emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { name: input.name, image: input.image ?? null }
  });
  res.status(202).json({ data: result });
}

export async function listEmulatorsHandler(_req: Request, res: Response): Promise<void> {
  const data = await emulatorService.list();
  res.json({ data });
}

export async function startEmulatorHandler(req: Request, res: Response): Promise<void> {
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.start(emulatorId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.start',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.status(202).json({ data: result });
}

export async function stopEmulatorHandler(req: Request, res: Response): Promise<void> {
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.stop(emulatorId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.stop',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.status(202).json({ data: result });
}

export async function deleteEmulatorHandler(req: Request, res: Response): Promise<void> {
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.remove(emulatorId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.delete',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.status(202).json({ data: result });
}

export async function installApkHandler(req: Request, res: Response): Promise<void> {
  const input = installSchema.parse(req.body);
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.installApk(emulatorId, input.apkPath);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.install_apk',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { apkPath: input.apkPath }
  });
  res.status(202).json({ data: result });
}

export async function screenshotHandler(req: Request, res: Response): Promise<void> {
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.screenshot(emulatorId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.screenshot',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.status(202).json({ data: result });
}

export async function shellHandler(req: Request, res: Response): Promise<void> {
  const input = shellSchema.parse(req.body);
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.shell(emulatorId, input.command);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.shell',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { command: input.command }
  });
  res.status(202).json({ data: result });
}

export async function openAppHandler(req: Request, res: Response): Promise<void> {
  const input = appSchema.parse(req.body);
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.openApp(emulatorId, input.packageName, input.activity);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.open_app',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { packageName: input.packageName, activity: input.activity ?? null }
  });
  res.status(202).json({ data: result });
}

export async function closeAppHandler(req: Request, res: Response): Promise<void> {
  const input = appSchema.pick({ packageName: true }).parse(req.body);
  const emulatorId = requireEmulatorId(req);
  const result = await emulatorService.closeApp(emulatorId, input.packageName);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'emulator.close_app',
    resourceType: 'emulator',
    resourceId: emulatorId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { packageName: input.packageName }
  });
  res.status(202).json({ data: result });
}
