import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { analyticsService } from './analytics.service';

const querySchema = z.object({
  days: z.coerce.number().int().positive().max(90).default(14)
});

export async function analyticsSummaryHandler(req: Request, res: Response): Promise<void> {
  const { days } = querySchema.parse(req.query);
  // Real fleet data — scoped to the caller's workspace when available.
  const data = await analyticsService.summary(getWorkspaceId(req), days);
  res.json({ data });
}
