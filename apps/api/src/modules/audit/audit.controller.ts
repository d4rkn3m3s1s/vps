import type { Request, Response } from 'express';
import { z } from 'zod';
import { listAuditLogs } from './audit.service';

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25)
});

export async function listAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const { limit } = querySchema.parse(req.query);
  const data = await listAuditLogs(limit);
  res.json({ data });
}
