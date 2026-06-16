import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { webhooksService } from './webhooks.service';

const createSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  event: z.enum(['JOB_COMPLETED', 'JOB_FAILED', 'ALL']).optional(),
  secret: z.string().optional(),
  active: z.boolean().optional()
});

const updateSchema = createSchema.partial();

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Webhook id is required', 400, 'INVALID_WEBHOOK_ID');
  return id;
}

export async function listWebhooksHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await webhooksService.list() });
}

export async function createWebhookHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const hook = await webhooksService.create(input);
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
