import type { Request, Response } from 'express';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { getCostSummary } from './costs.service';

export async function getCostsHandler(req: Request, res: Response): Promise<void> {
  const days = req.query.days ? Number(req.query.days) : 30;
  const data = await getCostSummary(getWorkspaceId(req), Number.isFinite(days) ? days : 30);
  res.json({ data });
}
