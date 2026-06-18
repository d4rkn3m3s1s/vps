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
  autoPauseThreshold: z.coerce.number().int().min(0).max(100).optional(),
  earlyFlowId: z.string().optional(),
  midFlowId: z.string().optional(),
  matureFlowId: z.string().optional()
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

// ── Account credentials (encrypted vault) ────────────────────────────────
const credentialSchema = z.object({
  platform: z.string().max(40).optional(),
  username: z.string().max(120).optional(),
  emailAddress: z.string().max(160).optional(),
  password: z.string().max(200).optional(),
  emailPassword: z.string().max(200).optional(),
  totpSecret: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional()
});

export async function updateCredentialsHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const input = credentialSchema.parse(req.body);
  const data = await farmService.updateCredentials(deviceId, input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'farm.credentials.update',
    resourceType: 'farm_account',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    // Never log the secrets themselves — only which fields were touched.
    metadata: { fields: Object.keys(input) }
  });
  res.json({ data });
}

// Per-account action timeline.
export async function actionLogHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  res.json({ data: await farmService.listActionLog(deviceId, limit) });
}

// Download the account roster + warmup state as CSV.
export async function exportHandler(req: Request, res: Response): Promise<void> {
  const csv = await farmService.exportAccountsCsv(getWorkspaceId(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="farm-accounts.csv"');
  res.send(csv);
}

// Generate the current 6-digit TOTP code from the account's encrypted 2FA seed.
export async function totpHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const data = await farmService.getTotpCode(deviceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'farm.totp.generate',
    resourceType: 'farm_account',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
    // Never log the code itself.
  });
  res.json({ data });
}

// Health-over-time series for one account (charted in the UI).
export async function healthTrendHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json({ data: await farmService.getHealthTrend(deviceId, limit) });
}

// Bulk actions on selected accounts (tags / pause / resume / group).
const bulkSchema = z.object({
  deviceIds: z.array(z.string()).min(1).max(2000),
  action: z.enum(['addTags', 'removeTags', 'pause', 'resume', 'setGroup']),
  tags: z.array(z.string().max(40)).max(20).optional(),
  groupId: z.string().optional()
});

export async function bulkHandler(req: Request, res: Response): Promise<void> {
  const { deviceIds, action, tags, groupId } = bulkSchema.parse(req.body);
  const result = await farmService.bulkAction(deviceIds, action, { tags, groupId });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'farm.bulk',
    resourceType: 'farm_account',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { action, count: deviceIds.length, affected: result.affected }
  });
  res.json({ data: result });
}
