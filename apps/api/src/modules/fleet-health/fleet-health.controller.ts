import type { Request, Response } from 'express';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { fleetHealthService } from './fleet-health.service';

// At-a-glance fleet health: device status + WhatsApp account health + today's
// registration outcomes + host resource averages.
export async function fleetHealthHandler(req: Request, res: Response): Promise<void> {
  const data = await fleetHealthService.health(getWorkspaceId(req));
  res.json({ data });
}

// Registration success analytics — which country / proxy / model registers best.
export async function registerAnalyticsHandler(req: Request, res: Response): Promise<void> {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const data = await fleetHealthService.registerAnalytics(getWorkspaceId(req), days);
  res.json({ data });
}
