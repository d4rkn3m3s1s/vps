import type { AlertTrigger } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { deviceHub } from '../devices/device.hub';
import { webhooksService } from '../webhooks/webhooks.service';
import { sendMail } from '../mail/mail.service';
import { alertEmail } from '../mail/mail.templates';
import { dispatch as notificationsDispatch } from '../notifications/notifications.service';
import { createNotification } from '../notifications/feed.service';

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

  // ★2026-07-24: seed a sensible default AlertRule set for every workspace so proactive
  // alerts actually fire out of the box. VERIFIED LIVE: workspaces had ZERO rules, so the
  // whole alert engine was silent. Idempotent — only creates a rule for a trigger the
  // workspace doesn't already have one for, so it never duplicates or overwrites an
  // operator's own rules. Called on boot for every existing workspace.
  async seedDefaultRules(workspaceId: string): Promise<number> {
    const DEFAULTS: Array<{ name: string; trigger: AlertTrigger; threshold?: number }> = [
      { name: 'Host çevrimdışı', trigger: 'HOST_OFFLINE' },
      { name: 'Filo toplu düşüş', trigger: 'FLEET_MASS_OFFLINE' },
      { name: 'Host doygun (yük/disk)', trigger: 'HOST_SATURATED' },
      { name: 'WhatsApp hesabı banlandı', trigger: 'ACCOUNT_BANNED' },
      { name: 'Proxy sağlıksız', trigger: 'PROXY_UNHEALTHY' },
      { name: 'Cihaz çevrimdışı', trigger: 'DEVICE_OFFLINE' },
      { name: 'İş başarısız', trigger: 'JOB_FAILED' }
    ];
    const existing = await prisma.alertRule.findMany({ where: { workspaceId }, select: { trigger: true } });
    const have = new Set(existing.map((r) => r.trigger));
    let created = 0;
    for (const d of DEFAULTS) {
      if (have.has(d.trigger)) continue;
      await prisma.alertRule
        .create({ data: { workspaceId, name: d.name, trigger: d.trigger, threshold: d.threshold ?? 0, notify: true, webhook: false, email: false, active: true } })
        .then(() => { created++; })
        .catch(() => undefined); // race with a concurrent create → ignore
    }
    return created;
  }

  // Seed defaults for ALL workspaces (boot-time). Best-effort per workspace.
  async seedDefaultRulesAllWorkspaces(): Promise<void> {
    try {
      const workspaces = await prisma.workspace.findMany({ select: { id: true } });
      for (const ws of workspaces) {
        const n = await this.seedDefaultRules(ws.id).catch(() => 0);
        if (n > 0) logger.info('seeded default alert rules', { workspaceId: ws.id, created: n });
      }
    } catch (error) {
      logger.warn('seedDefaultRulesAllWorkspaces failed', { error: error instanceof Error ? error.message : String(error) });
    }
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
      // ★2026-07-24 FAIL-OPEN: if NO AlertRule matches, critical triggers still reach the
      // operator. VERIFIED LIVE: a fresh workspace has zero AlertRules, so the loop below
      // never ran and EVERY proactive alert (host-down, mass-offline, ban, proxy) was
      // silently swallowed — the whole alert engine produced nothing. A missing rule must
      // mean "not customised", NOT "muted". So for the CRITICAL triggers we push a Telegram/
      // Slack notification directly (the same channel the rule path uses) even with no rule.
      // Non-critical triggers (QUOTA_HIGH etc.) still require an explicit rule (opt-in).
      const CRITICAL_FAILOPEN = new Set<AlertTrigger>([
        'HOST_OFFLINE', 'FLEET_MASS_OFFLINE', 'HOST_SATURATED',
        'ACCOUNT_BANNED', 'PROXY_UNHEALTHY', 'PROXY_CREDIT_LOW', 'DEVICE_OFFLINE', 'JOB_FAILED'
      ]);
      if (rules.length === 0 && CRITICAL_FAILOPEN.has(trigger)) {
        void notificationsDispatch(workspaceId, { title: context.title, detail: context.detail });
      }
      // ★★★2026-09-11 SOGUMA (cooldown) — alarm gurultusu gercek alarmi gorunmez yapiyordu.
      // CANLI OLCUM (3 Eyl): 620 alarm olayi uretildi, 360ı DAKIKADA BIR tekrar eden AYNI
      // swap alarmiydi. Operator alarm saymaya alisirsa izleme fiilen korlesir.
      // AlertRule semasinda cooldown alani YOK; migration riskine girmeden mevcut
      // `lastFiredAt` okunur (zaten yaziliyordu ama HICBIR YERDE okunmuyordu).
      // ⚠️KRITIK tetikleyiciler (host down / filo coktu) SOGUTULMAZ — tekrar etmeleri
      //   bilincli: operator ilk bildirimi kacirirsa ikincisini gormeli.
      const COOLDOWN_MS = Number(process.env.FLEET_ALERT_COOLDOWN_MS || 30 * 60 * 1000);
      const NEVER_COOLDOWN = new Set<AlertTrigger>(['HOST_OFFLINE', 'FLEET_MASS_OFFLINE']);
      for (const rule of rules) {
        if (!NEVER_COOLDOWN.has(trigger) && rule.lastFiredAt) {
          const sinceMs = Date.now() - new Date(rule.lastFiredAt).getTime();
          if (sinceMs < COOLDOWN_MS) continue;   // ayni kural yakinda atesledi — tekrar etme
        }
        // Threshold rules (QUOTA_HIGH) only fire when the value MEETS the threshold.
        // FAIL-CLOSED: a threshold rule invoked with NO numeric value can't be evaluated,
        // so it must NOT fire (previously the `typeof === 'number'` short-circuit let a
        // missing value skip the gate → the rule fired unconditionally, spamming alerts).
        if (rule.threshold > 0) {
          if (typeof context.value !== 'number' || context.value < rule.threshold) continue;
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
          // ★2026-07-29: alarmı KALICI bildirim beslemesine de yaz. WS push'u yalnızca
          // o an açık olan sekmeye ulaşır; alarm gece fırlamışsa operatör sabah panelde
          // hiçbir iz bulamıyordu.
          void createNotification(workspaceId, {
            kind: 'err',
            title: context.title,
            detail: context.detail,
            refType: 'alert',
            refId: event.id
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
