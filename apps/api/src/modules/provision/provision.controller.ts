import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { provisionService } from './provision.service';

const createSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  countryCode: z.string().length(2).optional(),
  deviceModel: z.string().max(80).optional(),
  androidVersion: z.string().max(20).optional(),
  // ISO country for a country-matched residential proxy (e.g. "AL", "US").
  proxyCountry: z.string().length(2).optional()
});

// Kurulum plan/adımlarını döndürür (dashboard adım çubuğu bunu kullanır).
export async function provisionStepsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: { steps: provisionService.steps() } });
}

// Bir kurulum job'unun kalıcı log geçmişi + son durumu (modal arka plandan dönünce
// geçmişi geri yükler).
export async function provisionStatusHandler(req: Request, res: Response): Promise<void> {
  const jobId = req.params.jobId;
  if (typeof jobId !== 'string') {
    res.status(400).json({ error: 'INVALID_JOB_ID', message: 'jobId is required' });
    return;
  }
  const data = await provisionService.getStatus(jobId, getWorkspaceId(req));
  res.json({ data });
}

// Tek-tık: sıfırdan yeni izole Waydroid instance oluşturur + kurulumu başlatır.
export async function createInstanceHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  const input = createSchema.parse(req.body ?? {});
  const data = await provisionService.createInstance(input, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.provision.create',
    resourceType: 'device',
    resourceId: data.deviceId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.status(201).json({ data });
}
