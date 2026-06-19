import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId, requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { alertsService } from './alerts.service';

const createSchema = z.object({
  name: z.string().min(1),
  trigger: z.enum(['JOB_FAILED', 'DEVICE_OFFLINE', 'QUOTA_HIGH', 'HOST_OFFLINE', 'FARM_BAN_RISK']),
  threshold: z.coerce.number().int().min(0).max(100).optional(),
  notify: z.boolean().optional(),
  webhook: z.boolean().optional(),
  email: z.boolean().optional(),
  active: z.boolean().optional()
});

const updateSchema = createSchema.partial().omit({ trigger: true });

export async function listRulesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await alertsService.listRules(workspaceId) });
}

export async function listEventsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await alertsService.listEvents(workspaceId) });
}

export async function createRuleHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const input = createSchema.parse(req.body);
  const rule = await alertsService.createRule(workspaceId, input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'alert.rule.create',
    resourceType: 'alert_rule',
    resourceId: rule.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { trigger: input.trigger },
    workspaceId
  });
  res.status(201).json({ data: rule });
}

export async function updateRuleHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Rule id required', 400, 'INVALID_ID');
  const input = updateSchema.parse(req.body);
  res.json({ data: await alertsService.updateRule(workspaceId, id, input) });
}

export async function deleteRuleHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Rule id required', 400, 'INVALID_ID');
  await alertsService.deleteRule(workspaceId, id);
  res.json({ data: { id } });
}

export async function acknowledgeEventHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Event id required', 400, 'INVALID_ID');
  res.json({ data: await alertsService.acknowledge(workspaceId, id) });
}

// Exposed so the dashboard can show available trigger types without hardcoding.
export function listTriggersHandler(_req: Request, res: Response): void {
  void getWorkspaceId; // keep import used if tree-shaken
  res.json({
    data: [
      { key: 'JOB_FAILED', label: 'Job fails', hasThreshold: false },
      { key: 'DEVICE_OFFLINE', label: 'Device goes offline', hasThreshold: false },
      { key: 'QUOTA_HIGH', label: 'Device quota high', hasThreshold: true },
      { key: 'HOST_OFFLINE', label: 'Host goes offline', hasThreshold: false },
      { key: 'FARM_BAN_RISK', label: 'Farm account ban risk', hasThreshold: true }
    ]
  });
}
