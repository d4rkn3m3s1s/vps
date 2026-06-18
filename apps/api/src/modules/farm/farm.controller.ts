import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { farmService } from './farm.service';

const campaignSchema = z.object({
  name: z.string().min(1).max(80),
  rpaFlowId: z.string().optional(),
  groupId: z.string().optional(),
  minIntervalMin: z.coerce.number().int().optional(),
  maxIntervalMin: z.coerce.number().int().optional(),
  maxActionsPerDay: z.coerce.number().int().optional(),
  activeFromHour: z.coerce.number().int().optional(),
  activeToHour: z.coerce.number().int().optional(),
  jitterPct: z.coerce.number().int().optional()
});

const updateSchema = campaignSchema.partial().extend({
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional()
});

export async function listCampaignsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await farmService.listCampaigns(getWorkspaceId(req)) });
}

export async function createCampaignHandler(req: Request, res: Response): Promise<void> {
  const input = campaignSchema.parse(req.body);
  const data = await farmService.createCampaign(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'farm.campaign.create',
    resourceType: 'farm_campaign',
    resourceId: data.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { name: data.name }
  });
  res.status(201).json({ data });
}

export async function updateCampaignHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const input = updateSchema.parse(req.body);
  const data = await farmService.updateCampaign(id, input);
  res.json({ data });
}

export async function deleteCampaignHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  res.json({ data: await farmService.deleteCampaign(id) });
}

export async function listAccountsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await farmService.listAccounts(getWorkspaceId(req)) });
}

// Manual engine kick (admin "run now") — useful for testing without waiting.
export async function tickHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await farmService.tick() });
}
