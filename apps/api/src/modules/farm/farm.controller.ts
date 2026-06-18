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
  jitterPct: z.coerce.number().int().optional(),
  rotateProxy: z.coerce.boolean().optional(),
  autoPauseThreshold: z.coerce.number().int().min(0).max(100).optional()
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

// Fleet farm analytics (health distribution, action trends, at-risk devices).
export async function summaryHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await farmService.getSummary(getWorkspaceId(req)) });
}

// Clear an auto-paused device so it resumes farming.
export async function resumeHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  res.json({ data: await farmService.resumeAccount(deviceId) });
}

const importSchema = z.object({
  rows: z.array(z.object({
    name: z.string().min(1),
    countryCode: z.string().optional(),
    groupName: z.string().optional()
  })).min(1).max(2000)
});

// Bulk-create devices + warmup rows from parsed CSV rows.
export async function importHandler(req: Request, res: Response): Promise<void> {
  const { rows } = importSchema.parse(req.body);
  const result = await farmService.importAccounts(rows, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'farm.import',
    resourceType: 'farm_account',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { ...result }
  });
  res.status(201).json({ data: result });
}
