import type { AlertTrigger } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { deviceHub } from '../devices/device.hub';
import { webhooksService } from '../webhooks/webhooks.service';
import { sendMail } from '../mail/mail.service';
import { alertEmail } from '../mail/mail.templates';
import { dispatch as notificationsDispatch } from '../notifications/notifications.service';

export type AlertRuleInput = {
  name: string;
  trigger: AlertTrigger;
  threshold?: number | undefined;
  notify?: boolean | undefined;
  webhook?: boolean | undefined;
  email?: boolean | undefined;
  active?: boolean | undefined;
};

export class AlertsService {
  async listRules(workspaceId: string) {
    return prisma.alertRule.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  }

  async listEvents(workspaceId: string, limit = 50) {
    return prisma.alertEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { rule: { select: { name: true, trigger: true } } }
    });
  }

  async createRule(workspaceId: string, input: AlertRuleInput) {
    return prisma.alertRule.create({
      data: {
        workspaceId,
        name: input.name,
        trigger: input.trigger,
        threshold: input.threshold ?? 0,
        notify: input.notify ?? true,
        webhook: input.webhook ?? false,
        email: input.email ?? false,
        active: input.active ?? true
      }
    });
  }

  async updateRule(
    workspaceId: string,
    id: string,
    input: {
      name?: string | undefined;
      threshold?: number | undefined;
      notify?: boolean | undefined;
      webhook?: boolean | undefined;
      email?: boolean | undefined;
      active?: boolean | undefined;
    }
  ) {
    const rule = await prisma.alertRule.findFirst({ where: { id, workspaceId } });
    if (!rule) throw new AppError('Alert rule not found', 404, 'ALERT_RULE_NOT_FOUND');
    return prisma.alertRule.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
        ...(input.notify !== undefined ? { notify: input.notify } : {}),
        ...(input.webhook !== undefined ? { webhook: input.webhook } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.active !== undefined ? { active: input.active } : {})
      }
    });
  }

  async deleteRule(workspaceId: string, id: string) {
    const rule = await prisma.alertRule.findFirst({ where: { id, workspaceId } });
    if (!rule) throw new AppError('Alert rule not found', 404, 'ALERT_RULE_NOT_FOUND');
    await prisma.alertRule.delete({ where: { id } });
  }

  async acknowledge(workspaceId: string, eventId: string) {
    const event = await prisma.alertEvent.findFirst({ where: { id: eventId, workspaceId } });
    if (!event) throw new AppError('Alert event not found', 404, 'ALERT_EVENT_NOT_FOUND');
    return prisma.alertEvent.update({ where: { id: eventId }, data: { acknowledged: true } });
  }

  // Core engine: called when an event occurs. Finds matching active rules for the
  // workspace, records an AlertEvent, pushes a real-time notification, and
  // (optionally) fires webhooks. Best-effort — never throws into the caller.
  async evaluate(
    workspaceId: string | undefined,
    trigger: AlertTrigger,
    context: { title: string; detail: string; value?: number }
  ): Promise<void> {
    if (!workspaceId) return;
    try {
      const rules = await prisma.alertRule.findMany({ where: { workspaceId, trigger, active: true } });
      for (const rule of rules) {
        // Threshold rules (QUOTA_HIGH) only fire when the value meets it.
        if (rule.threshold > 0 && typeof context.value === 'number' && context.value < rule.threshold) {
          continue;
        }

        const event = await prisma.alertEvent.create({
          data: { ruleId: rule.id, workspaceId, title: context.title, detail: context.detail }
        });
        await prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastFiredAt: new Date(), fireCount: { increment: 1 } }
        });

        if (rule.notify) {
          deviceHub.broadcast({
            type: 'alert.fired',
            deviceId: '',
            payload: { id: event.id, title: context.title, detail: context.detail, rule: rule.name },
            timestamp: new Date().toISOString(),
            workspaceId
          });
        }
        if (rule.webhook) {
          void webhooksService.dispatch(
            'ALERT_FIRED',
            {
              alert: rule.name,
              trigger: rule.trigger,
              title: context.title,
              detail: context.detail
            },
            workspaceId
          );
        }
        if (rule.email) {
          void this.emailAdmins(workspaceId, rule.name, context.title, context.detail);
        }
        // Fan out to any configured Telegram/Slack/Discord channels (best-effort).
        void notificationsDispatch(workspaceId, { title: context.title, detail: context.detail });
      }
    } catch {
      /* alerting must never break the main flow */
    }
  }

  // Emails all admins of a workspace about a fired alert. Best-effort.
  private async emailAdmins(workspaceId: string, ruleName: string, title: string, detail: string): Promise<void> {
    try {
      const admins = await prisma.workspaceMember.findMany({
        where: { workspaceId, role: 'admin' },
        include: { user: { select: { email: true } } }
      });
      await Promise.all(
        admins.map((a) => sendMail(alertEmail({ to: a.user.email, title, detail, ruleName })))
      );
    } catch (error) {
      logger.error('Alert email failed', { workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export const alertsService = new AlertsService();
