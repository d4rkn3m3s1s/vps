import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { webhooksService } from './webhooks.service';

const WEBHOOK_EVENTS = [
  'JOB_COMPLETED',
  'JOB_FAILED',
  'DEVICE_ONLINE',
  'DEVICE_OFFLINE',
  'QUOTA_HIGH',
  'ALERT_FIRED',
  'ALL'
] as const;

const createSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  event: z.enum(WEBHOOK_EVENTS).optional(),
  secret: z.string().optional(),
  active: z.boolean().optional()
});

const updateSchema = createSchema.partial();

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Webhook id is required', 400, 'INVALID_WEBHOOK_ID');
  return id;
}

export async function listWebhooksHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await webhooksService.list(getWorkspaceId(req)) });
}

export async function createWebhookHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const hook = await webhooksService.create(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'webhook.create',
    resourceType: 'webhook',
    resourceId: hook.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { url: input.url, event: input.event ?? 'ALL' }
  });
  res.status(201).json({ data: hook });
}

export async function updateWebhookHandler(req: Request, res: Response): Promise<void> {
  const input = updateSchema.parse(req.body);
  res.json({ data: await webhooksService.update(requireId(req), input) });
}

export async function listDeliveriesHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await webhooksService.listDeliveries(requireId(req)) });
}

export async function sendTestHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const result = await webhooksService.sendTest(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'webhook.test',
    resourceType: 'webhook',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: result });
}

export async function redeliverHandler(req: Request, res: Response): Promise<void> {
  const deliveryId = req.params.deliveryId;
  if (typeof deliveryId !== 'string') throw new AppError('Delivery id is required', 400, 'INVALID_DELIVERY_ID');
  await webhooksService.redeliver(deliveryId);
  res.json({ data: { id: deliveryId, status: 'PENDING' } });
}

export async function deleteWebhookHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await webhooksService.remove(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'webhook.delete',
    resourceType: 'webhook',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}
