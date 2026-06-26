import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { reportsService } from './reports.service';

const rangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

// Defaults to the last 30 days when no range is given.
function resolveRange(q: { from?: string | undefined; to?: string | undefined }) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function reportSummaryHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const { from, to } = resolveRange(rangeSchema.parse(req.query));
  res.json({ data: await reportsService.summary(workspaceId, from, to) });
}

// Returns flat job rows; the dashboard turns these into a CSV download.
export async function reportJobsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const { from, to } = resolveRange(rangeSchema.parse(req.query));
  res.json({ data: await reportsService.jobRows(workspaceId, from, to) });
}
