import type { Request, Response } from 'express';
import { z } from 'zod';
import { analyticsService } from './analytics.service';

const querySchema = z.object({
  days: z.coerce.number().int().positive().max(90).default(14)
});

export async function analyticsSummaryHandler(req: Request, res: Response): Promise<void> {
  const { days } = querySchema.parse(req.query);
  // Ensure the dashboard has data to show on a fresh install.
  await analyticsService.seedIfEmpty();
  const data = await analyticsService.summary(days);
  res.json({ data });
}
