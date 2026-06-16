import { createHmac } from 'node:crypto';
import type { WebhookEvent } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

export type WebhookInput = {
  label: string;
  url: string;
  event?: WebhookEvent | undefined;
  secret?: string | undefined;
  active?: boolean | undefined;
};

export class WebhooksService {
  async list() {
    const hooks = await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } });
    // Never return the signing secret to clients.
    return hooks.map(({ secret, ...rest }) => ({ ...rest, hasSecret: Boolean(secret) }));
  }

  async create(input: WebhookInput) {
    const hook = await prisma.webhook.create({
      data: {
        label: input.label,
        url: input.url,
        ...(input.event ? { event: input.event } : {}),
        ...(input.secret ? { secret: input.secret } : {}),
        ...(input.active !== undefined ? { active: input.active } : {})
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
    }
  ) {
    await this.assertExists(id);
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

  async remove(id: string) {
    await this.assertExists(id);
    return prisma.webhook.delete({ where: { id } });
  }

  // Fires all active webhooks matching `event`. Best-effort: failures are logged
  // and counted, never thrown to the caller.
  async dispatch(event: 'JOB_COMPLETED' | 'JOB_FAILED', payload: Record<string, unknown>): Promise<void> {
    const hooks = await prisma.webhook.findMany({
      where: { active: true, event: { in: [event, 'ALL'] } }
    });

    await Promise.all(
      hooks.map(async (hook) => {
        try {
          const body = JSON.stringify({ event, ...payload, firedAt: new Date().toISOString() });
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (hook.secret) {
            headers['X-Fleet-Signature'] = createHmac('sha256', hook.secret).update(body).digest('hex');
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(hook.url, { method: 'POST', headers, body, signal: controller.signal });
          clearTimeout(timer);
          await prisma.webhook.update({
            where: { id: hook.id },
            data: res.ok ? { lastFiredAt: new Date(), failCount: 0 } : { failCount: { increment: 1 } }
          });
        } catch (error) {
          logger.error('Webhook dispatch failed', {
            hookId: hook.id,
            error: error instanceof Error ? error.message : String(error)
          });
          await prisma.webhook.update({ where: { id: hook.id }, data: { failCount: { increment: 1 } } });
        }
      })
    );
  }

  private async assertExists(id: string): Promise<void> {
    const hook = await prisma.webhook.findUnique({ where: { id } });
    if (!hook) throw new AppError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
  }
}

export const webhooksService = new WebhooksService();
