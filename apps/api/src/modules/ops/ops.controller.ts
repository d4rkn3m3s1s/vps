import type { Request, Response } from 'express';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { opsService } from './ops.service';

// Canli operasyon ekraninin ILK DOLUMU. Sonraki kayitlar WS ile ('ops.request') gelir,
// bu uc yalnizca sayfa acilirken bir kez cagrilir.
export async function listRequestsHandler(req: Request, res: Response): Promise<void> {
  const limit = Number(req.query.limit ?? 200);
  const ws = getWorkspaceId(req);
  res.json({ data: opsService.listRequests(Number.isFinite(limit) ? limit : 200, ws ?? undefined) });
}
