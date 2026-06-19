import type { Request, Response } from 'express';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { usageService } from './usage.service';

export async function usageSummaryHandler(req: Request, res: Response): Promise<void> {
  const days = req.query.days ? Number(req.query.days) : 30;
  res.json({ data: await usageService.getSummary(getWorkspaceId(req), Number.isFinite(days) ? days : 30) });
}
