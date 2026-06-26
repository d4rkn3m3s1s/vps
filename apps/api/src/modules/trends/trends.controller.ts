import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { getTrends } from './trends.service';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional()
});

export async function getTrendsHandler(req: Request, res: Response): Promise<void> {
  const { days } = querySchema.parse(req.query);
  const data = await getTrends(getWorkspaceId(req), days ?? 30);
  res.json({ data });
}
