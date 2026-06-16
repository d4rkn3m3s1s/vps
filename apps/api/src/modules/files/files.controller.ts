import type { Request, Response } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit/audit.service';
import { filesService } from './files.service';

const pushSchema = z
  .object({
    deviceIds: z.array(z.string()).min(1),
    url: z.string().url().optional(),
    libraryAssetId: z.string().optional(),
    destination: z.enum(['gallery', 'downloads']).optional(),
    fileName: z.string().optional()
  })
  .refine((v) => v.url || v.libraryAssetId, { message: 'url or libraryAssetId is required' });

export async function pushFileHandler(req: Request, res: Response): Promise<void> {
  const input = pushSchema.parse(req.body);
  const result = await filesService.push(input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'file.push',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { count: result.pushed, destination: input.destination ?? 'gallery' }
  });
  res.status(201).json({ data: result });
}
