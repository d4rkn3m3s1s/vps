import type { Request, Response } from 'express';
import { getSystemOverview } from './system.service';

export async function getSystemOverviewHandler(_req: Request, res: Response): Promise<void> {
  const data = await getSystemOverview();
  res.json({ data });
}
