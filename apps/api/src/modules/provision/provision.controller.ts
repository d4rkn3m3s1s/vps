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

// Batch: same fields + how many to create. `name` becomes a prefix when count>1.
const batchSchema = createSchema.extend({
  count: z.number().int().min(1).max(20).optional(),
  namePrefix: z.string().min(1).max(40).optional()
});

// Kurulum plan/adımlarını döndürür (dashboard adım çubuğu bunu kullanır).
export async function provisionStepsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: { steps: provisionService.steps() } });
}

// Host'larda kaç cihaz daha sığar (canlı disk/RAM'den).
export async function provisionCapacityHandler(req: Request, res: Response): Promise<void> {
  const data = await provisionService.capacity(getWorkspaceId(req));
  res.json({ data });
}

// Host CPU yükü + boşta (uyutulabilir) cihaz adayları. Dashboard "CPU yüksek —
// boşta cihazları uyut?" uyarısı ve manuel toplu-sleep için kullanır.
export async function provisionCpuPressureHandler(req: Request, res: Response): Promise<void> {
  const data = await provisionService.cpuPressure(getWorkspaceId(req));
  res.json({ data });
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

// Operatör panelden devam eden/kuyruğa alınmış kurulumu iptal eder. Job FAILED olur,
// yarım cihaz FAILED işaretlenir, badge temizlenir. Workspace-guarded (IDOR-safe).
export async function provisionCancelHandler(req: Request, res: Response): Promise<void> {
  const jobId = req.params.jobId;
  if (typeof jobId !== 'string') {
    res.status(400).json({ error: 'INVALID_JOB_ID', message: 'jobId is required' });
    return;
  }
  const data = await provisionService.cancel(jobId, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.provision.cancel',
    resourceType: 'job',
    resourceId: jobId
  }).catch(() => undefined);
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

// Toplu tek-tık: `count` adet cihazı benzersiz rastgele isim + her birine ayrı proxy
// (aynı ülke, provider-rotation farklı IP) ile arka arkaya oluşturur. Hata-toleranslı:
// biri patlarsa diğerleri devam eder, per-device sonuç listesi döner.
export async function createBatchHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  const input = batchSchema.parse(req.body ?? {});
  const data = await provisionService.createBatch(input, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.provision.batch',
    resourceType: 'device',
    resourceId: data.started[0]?.deviceId ?? 'batch',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  }).catch(() => undefined);
  res.status(201).json({ data });
}
