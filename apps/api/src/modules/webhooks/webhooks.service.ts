import type { Prisma, WebhookEvent } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { enqueueDelivery } from './webhook.queue';

// Concrete (non-ALL) events that can actually fire. ALL is a subscription filter
// on the Webhook row, never an emitted event.
export type DispatchableEvent = Exclude<WebhookEvent, 'ALL'>;

// Auto-disable a webhook after this many consecutive terminal failures so a dead
// endpoint stops generating delivery churn.
const MAX_CONSECUTIVE_FAILURES = 15;

export type WebhookInput = {
  label: string;
  url: string;
  event?: WebhookEvent | undefined;
  secret?: string | undefined;
  active?: boolean | undefined;
};

export class WebhooksService {
  async list(workspaceId?: string) {
    const hooks = await prisma.webhook.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    // Never return the signing secret to clients.
    return hooks.map(({ secret, ...rest }) => ({ ...rest, hasSecret: Boolean(secret) }));
  }

  async create(input: WebhookInput, workspaceId?: string) {
    const hook = await prisma.webhook.create({
      data: {
        label: input.label,
        url: input.url,
        ...(input.event ? { event: input.event } : {}),
        ...(input.secret ? { secret: input.secret } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(workspaceId ? { workspaceId } : {})
      }
    });
    const { secret, ...rest } = hook;
    return { ...rest, hasSecret: Boolean(secret) };
  }

  async update(
    id: string,
    input: {
      label?: string | undefined;
      url?: string | undefined;
      event?: WebhookEvent | undefined;
      secret?: string | undefined;
      active?: boolean | undefined;
    },
    workspaceId?: string
  ) {
    await this.assertExists(id, workspaceId);
    const hook = await prisma.webhook.update({
      where: { id },
      data: {
        ...(input.label ? { label: input.label } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.event ? { event: input.event } : {}),
        ...(input.secret !== undefined ? { secret: input.secret || null } : {}),
        ...(input.active !== undefined ? { active: input.active } : {})
      }
    });
    const { secret, ...rest } = hook;
    return { ...rest, hasSecret: Boolean(secret) };
  }

  async remove(id: string, workspaceId?: string) {
    await this.assertExists(id, workspaceId);
    return prisma.webhook.delete({ where: { id } });
  }

  // Fires all active webhooks matching `event`, scoped to a workspace when given.
  // Creates a delivery row per matching hook and enqueues it for the worker to
  // deliver with retry/backoff. Never throws to the caller (fire-and-forget).
  async dispatch(
    event: DispatchableEvent,
    payload: Record<string, unknown>,
    workspaceId?: string
  ): Promise<void> {
    const hooks = await prisma.webhook.findMany({
      where: {
        active: true,
        event: { in: [event, 'ALL'] },
        // Workspace-scoped events only reach that workspace's hooks. Events with
        // no workspace context (rare) reach all hooks.
        ...(workspaceId ? { workspaceId } : {})
      }
    });
    if (hooks.length === 0) return;

    const envelope = { event, firedAt: new Date().toISOString(), data: payload };

    await Promise.all(
      hooks.map(async (hook) => {
        const delivery = await prisma.webhookDelivery.create({
          data: {
            webhookId: hook.id,
            event,
            payload: envelope as unknown as Prisma.InputJsonValue
          }
        });
        await enqueueDelivery(delivery.id);
        // If this hook has been failing persistently, auto-disable it so it stops
        // accumulating dead deliveries until an admin re-enables it.
        if (hook.failCount >= MAX_CONSECUTIVE_FAILURES) {
          await prisma.webhook.update({ where: { id: hook.id }, data: { active: false } });
        }
      })
    );
  }

  // Sends a synthetic test event to a single webhook (admin "Send test" button).
  async sendTest(id: string): Promise<{ deliveryId: string }> {
    const hook = await prisma.webhook.findUnique({ where: { id } });
    if (!hook) throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event: 'ALL',
        payload: {
          event: 'webhook.test',
          firedAt: new Date().toISOString(),
          data: { message: 'This is a test delivery from VPS Fleet.', webhookId: hook.id }
        } as unknown as Prisma.InputJsonValue
      }
    });
    await enqueueDelivery(delivery.id);
    return { deliveryId: delivery.id };
  }

  // Re-queues a past delivery (admin "Redeliver" button). Resets it to pending.
  async redeliver(deliveryId: string): Promise<void> {
    const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new AppError('Delivery not found', 404, 'DELIVERY_NOT_FOUND');
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', error: null, responseCode: null }
    });
    await enqueueDelivery(deliveryId);
  }

  // Recent delivery attempts for a webhook (history UI).
  async listDeliveries(webhookId: string, limit = 25) {
    await this.assertExists(webhookId);
    return prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        responseCode: true,
        error: true,
        createdAt: true,
        deliveredAt: true
      }
    });
  }

  // Workspace-scoped existence check: a webhook in another tenant is "not found"
  // rather than mutable cross-tenant.
  private async assertExists(id: string, workspaceId?: string): Promise<void> {
    const hook = await prisma.webhook.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!hook) throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
  }
}

export const webhooksService = new WebhooksService();
