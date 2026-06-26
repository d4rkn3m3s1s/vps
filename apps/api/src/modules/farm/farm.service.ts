import { generateSync } from 'otplib';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, decryptString } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { alertsService } from '../alerts/alerts.service';

export type CampaignInput = {
  name: string;
  rpaFlowId?: string | undefined;
  groupId?: string | undefined;
  minIntervalMin?: number | undefined;
  maxIntervalMin?: number | undefined;
  maxActionsPerDay?: number | undefined;
  activeFromHour?: number | undefined;
  activeToHour?: number | undefined;
  jitterPct?: number | undefined;
  rotateProxy?: boolean | undefined;
  autoPauseThreshold?: number | undefined;
  earlyFlowId?: string | undefined;
  midFlowId?: string | undefined;
  matureFlowId?: string | undefined;
};

// Warmup ladder: how many actions/day are "safe" at each stage. New accounts
// (stage 1) act rarely; mature accounts (stage 5) act freely.
const STAGE_DAILY_CAP = [0, 5, 10, 20, 40, 80];

// Ban-risk scoring. Health is a *lagging* signal (only drops after a flow fails);
// the risk score is a *leading* one — it rises from behaviour that tends to
// precede a ban (failure streaks, acting faster than a stage should, exiting
// through a dead proxy) so an operator can intervene before health collapses.
const RISK_ALERT_THRESHOLD = 60; // fire an alert at/above this
// Don't re-alert the same rising device more than once per this window.
const RISK_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

export type RiskFactor = { code: string; label: string; weight: number };

// A single risk verdict for one account: the 0-100 score, a coarse band, and
// the human-readable factors that produced it (shown in the UI / alert detail).
export type RiskVerdict = { score: number; band: 'low' | 'medium' | 'high'; factors: RiskFactor[] };

// Pure scoring: combine leading indicators into a 0-100 risk score. Inputs are
// the account's current state plus contextual signals (does it have a dead
// proxy assigned? how does today's volume compare to its stage cap?). Kept
// side-effect free so it can be unit-tested and reused by the API + engine.
function scoreRisk(input: {
  healthScore: number;
  consecutiveErrors: number;
  warmupStage: number;
  actionsToday: number;
  paused: boolean;
  hasDeadProxy: boolean;
}): RiskVerdict {
  const factors: RiskFactor[] = [];

  // 1) Consecutive failures — the strongest precursor to a ban. The engine
  //    hard-pauses at 3; the score climbs steeply before that so the operator
  //    sees it coming.
  if (input.consecutiveErrors >= 1) {
    const w = Math.min(45, input.consecutiveErrors * 18);
    factors.push({ code: 'errors', label: `${input.consecutiveErrors} ardışık hata`, weight: w });
  }

  // 2) Low health. Below 50 is "at risk" in the dashboard; translate the gap
  //    into risk weight (health 0 → +40, health 50 → 0).
  if (input.healthScore < 50) {
    const w = Math.min(40, Math.round((50 - input.healthScore) * 0.8));
    factors.push({ code: 'health', label: `Düşük sağlık (${input.healthScore})`, weight: w });
  }

  // 3) Velocity vs. stage. Acting near/over the stage's safe daily cap is the
  //    classic "too much, too soon" pattern for a young account.
  const cap = STAGE_DAILY_CAP[Math.min(input.warmupStage, STAGE_DAILY_CAP.length - 1)] ?? 20;
  if (cap > 0) {
    const ratio = input.actionsToday / cap;
    if (ratio >= 0.8) {
      const w = ratio >= 1 ? 30 : 18;
      const pct = Math.round(ratio * 100);
      factors.push({ code: 'velocity', label: `Aşama limitine yakın (%${pct})`, weight: w });
    }
  } else if (input.actionsToday > 0) {
    // Stage 0 has a zero cap — any action at all is off-script.
    factors.push({ code: 'velocity', label: 'Isınmamış hesapta erken aktivite', weight: 25 });
  }

  // 4) Dead proxy. Running through a FAILED egress can leak the real IP or
  //    route through a flagged exit — a meaningful, fixable risk.
  if (input.hasDeadProxy) {
    factors.push({ code: 'proxy', label: 'Atanmış proxy ÖLÜ (FAILED)', weight: 20 });
  }

  const score = Math.min(100, factors.reduce((s, f) => s + f.weight, 0));
  const band: RiskVerdict['band'] = score >= RISK_ALERT_THRESHOLD ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, band, factors };
}

function clampInt(n: number | undefined, min: number, max: number, dflt: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Random integer in [min, max].
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const farmService = {
  // ── Campaigns ──────────────────────────────────────────────────────────
  async listCampaigns(workspaceId?: string) {
    const rows = await prisma.farmCampaign.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        rpaFlow: { select: { id: true, name: true } },
        earlyFlow: { select: { id: true, name: true } },
        midFlow: { select: { id: true, name: true } },
        matureFlow: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } }
      }
    });
    // Attach device count per campaign group for the UI.
    return Promise.all(
      rows.map(async (c) => ({
        ...c,
        deviceCount: c.groupId ? await prisma.device.count({ where: { groupId: c.groupId } }) : 0
      }))
    );
  },

  async createCampaign(input: CampaignInput, workspaceId?: string) {
    if (!input.name?.trim()) throw new AppError('Campaign name is required', 400, 'INVALID_NAME');
    const minI = clampInt(input.minIntervalMin, 1, 1440, 45);
    const maxI = clampInt(input.maxIntervalMin, minI, 1440, Math.max(minI, 180));
    return prisma.farmCampaign.create({
      data: {
        name: input.name.trim(),
        ...(input.rpaFlowId ? { rpaFlowId: input.rpaFlowId } : {}),
        ...(input.groupId ? { groupId: input.groupId } : {}),
        minIntervalMin: minI,
        maxIntervalMin: maxI,
        maxActionsPerDay: clampInt(input.maxActionsPerDay, 1, 500, 20),
        activeFromHour: clampInt(input.activeFromHour, 0, 23, 8),
        activeToHour: clampInt(input.activeToHour, 1, 24, 23),
        jitterPct: clampInt(input.jitterPct, 0, 90, 25),
        rotateProxy: Boolean(input.rotateProxy),
        autoPauseThreshold: clampInt(input.autoPauseThreshold, 0, 100, 40),
        ...(input.earlyFlowId ? { earlyFlowId: input.earlyFlowId } : {}),
        ...(input.midFlowId ? { midFlowId: input.midFlowId } : {}),
        ...(input.matureFlowId ? { matureFlowId: input.matureFlowId } : {}),
        nextRunAt: new Date(),
        ...(workspaceId ? { workspaceId } : {})
      }
    });
  },

  async updateCampaign(
    id: string,
    input: {
      name?: string | undefined;
      rpaFlowId?: string | undefined;
      groupId?: string | undefined;
      minIntervalMin?: number | undefined;
      maxIntervalMin?: number | undefined;
      maxActionsPerDay?: number | undefined;
      activeFromHour?: number | undefined;
      activeToHour?: number | undefined;
      jitterPct?: number | undefined;
      rotateProxy?: boolean | undefined;
      autoPauseThreshold?: number | undefined;
      earlyFlowId?: string | undefined;
      midFlowId?: string | undefined;
      matureFlowId?: string | undefined;
      status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | undefined;
    },
    workspaceId?: string
  ) {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.rpaFlowId !== undefined) data.rpaFlowId = input.rpaFlowId || null;
    if (input.groupId !== undefined) data.groupId = input.groupId || null;
    if (input.minIntervalMin !== undefined) data.minIntervalMin = clampInt(input.minIntervalMin, 1, 1440, 45);
    if (input.maxIntervalMin !== undefined) data.maxIntervalMin = clampInt(input.maxIntervalMin, 1, 1440, 180);
    if (input.maxActionsPerDay !== undefined) data.maxActionsPerDay = clampInt(input.maxActionsPerDay, 1, 500, 20);
    if (input.activeFromHour !== undefined) data.activeFromHour = clampInt(input.activeFromHour, 0, 23, 8);
    if (input.activeToHour !== undefined) data.activeToHour = clampInt(input.activeToHour, 1, 24, 23);
    if (input.jitterPct !== undefined) data.jitterPct = clampInt(input.jitterPct, 0, 90, 25);
    if (input.rotateProxy !== undefined) data.rotateProxy = Boolean(input.rotateProxy);
    if (input.autoPauseThreshold !== undefined) data.autoPauseThreshold = clampInt(input.autoPauseThreshold, 0, 100, 40);
    if (input.earlyFlowId !== undefined) data.earlyFlowId = input.earlyFlowId || null;
    if (input.midFlowId !== undefined) data.midFlowId = input.midFlowId || null;
    if (input.matureFlowId !== undefined) data.matureFlowId = input.matureFlowId || null;
    if (input.status !== undefined) data.status = input.status;
    // Workspace-scope the write so a tenant can't modify another tenant's
    // campaign by id (updateMany with a workspace filter, then return the row).
    const { count } = await prisma.farmCampaign.updateMany({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      data
    });
    if (count === 0) throw new AppError('Kampanya bulunamadı', 404, 'FARM_CAMPAIGN_NOT_FOUND');
    return prisma.farmCampaign.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
  },

  async deleteCampaign(id: string, workspaceId?: string) {
    const { count } = await prisma.farmCampaign.deleteMany({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (count === 0) throw new AppError('Kampanya bulunamadı', 404, 'FARM_CAMPAIGN_NOT_FOUND');
    return { deleted: true };
  },

  // ── Warmup accounts ────────────────────────────────────────────────────
  async listAccounts(workspaceId?: string) {
    const rows = await prisma.farmAccount.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { healthScore: 'asc' },
      include: { device: { select: { id: true, name: true, status: true } } }
    });
    // Never leak encrypted secrets to the client. Expose only whether a secret
    // is set (so the UI can show a "credentials saved" badge) plus public fields.
    return rows.map((r) => {
      const { passwordEnc, emailPasswordEnc, totpSecretEnc, ...rest } = r;
      return {
        ...rest,
        hasPassword: Boolean(passwordEnc),
        hasEmailPassword: Boolean(emailPasswordEnc),
        hasTotp: Boolean(totpSecretEnc)
      };
    });
  },

  // ── Account credentials (encrypted vault) ───────────────────────────────
  // Update the identity/credentials of a farm account. Secrets are encrypted at
  // rest; an empty string clears a field, undefined leaves it unchanged.
  async updateCredentials(
    deviceId: string,
    input: {
      platform?: string | undefined;
      username?: string | undefined;
      emailAddress?: string | undefined;
      password?: string | undefined;
      emailPassword?: string | undefined;
      totpSecret?: string | undefined;
      notes?: string | undefined;
      tags?: string[] | undefined;
    },
    workspaceId?: string
  ) {
    await this.ensureAccount(deviceId, workspaceId);
    const data: Record<string, unknown> = {};
    if (input.platform !== undefined) data.platform = input.platform.trim() || null;
    if (input.username !== undefined) data.username = input.username.trim() || null;
    if (input.emailAddress !== undefined) data.emailAddress = input.emailAddress.trim() || null;
    if (input.notes !== undefined) data.notes = input.notes.trim() || null;
    if (input.tags !== undefined) data.tags = input.tags.map((t) => t.trim()).filter(Boolean);
    if (input.password !== undefined) data.passwordEnc = input.password ? encryptString(input.password) : null;
    if (input.emailPassword !== undefined) data.emailPasswordEnc = input.emailPassword ? encryptString(input.emailPassword) : null;
    if (input.totpSecret !== undefined) data.totpSecretEnc = input.totpSecret ? encryptString(input.totpSecret.replace(/\s+/g, '')) : null;
    const updated = await prisma.farmAccount.update({ where: { deviceId }, data });
    await this.logAction({ deviceId, kind: 'manual', detail: 'Hesap kimlik bilgileri güncellendi', warmupStage: updated.warmupStage, workspaceId: updated.workspaceId ?? undefined });
    const { passwordEnc, emailPasswordEnc, totpSecretEnc, ...rest } = updated;
    return { ...rest, hasPassword: Boolean(passwordEnc), hasEmailPassword: Boolean(emailPasswordEnc), hasTotp: Boolean(totpSecretEnc) };
  },

  // ── Live 2FA code generation ────────────────────────────────────────────
  // Decrypt the stored TOTP seed and produce the current 6-digit code. The seed
  // never leaves the server; only the short-lived code is returned (so it can be
  // typed into a login flow or fed to an RPA step). Includes seconds remaining
  // in the current 30s window so the UI can show a countdown.
  async getTotpCode(deviceId: string, workspaceId?: string): Promise<{ code: string; secondsRemaining: number }> {
    // Workspace-scoped: never mint another tenant's live 2FA code by deviceId.
    const acct = await prisma.farmAccount.findFirst({ where: { deviceId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!acct?.totpSecretEnc) throw new AppError('Bu hesapta kayıtlı 2FA anahtarı yok', 400, 'NO_TOTP_SECRET');
    let secret: string;
    try {
      secret = decryptString(acct.totpSecretEnc);
    } catch {
      throw new AppError('2FA anahtarı çözülemedi', 500, 'TOTP_DECRYPT_FAILED');
    }
    let code: string;
    try {
      const r = generateSync({ secret, strategy: 'totp' }) as unknown;
      code = typeof r === 'string' ? r : String((r as { token?: string })?.token ?? '');
    } catch {
      throw new AppError('Geçersiz 2FA anahtarı', 400, 'INVALID_TOTP_SECRET');
    }
    if (!/^\d{6}$/.test(code)) throw new AppError('2FA kodu üretilemedi', 500, 'TOTP_GENERATE_FAILED');
    const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    return { code, secondsRemaining };
  },

  // ── Health trend ────────────────────────────────────────────────────────
  // Build a chronological health series from the action log's healthAfter
  // snapshots, so the UI can chart how an account's health moved over time.
  async getHealthTrend(deviceId: string, limit = 50, workspaceId?: string): Promise<{ at: string; health: number; kind: string }[]> {
    const rows = await prisma.farmActionLog.findMany({
      where: { deviceId, healthAfter: { not: null }, ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: Math.min(500, Math.max(1, limit)),
      select: { createdAt: true, healthAfter: true, kind: true }
    });
    return rows.map((r) => ({ at: r.createdAt.toISOString(), health: r.healthAfter ?? 0, kind: r.kind }));
  },

  // ── Bulk operations on selected accounts ────────────────────────────────
  // Apply an action to many devices at once: add/remove tags, pause, resume,
  // or move to a group. Returns how many were affected.
  async bulkAction(
    deviceIds: string[],
    action: 'addTags' | 'removeTags' | 'pause' | 'resume' | 'setGroup',
    payload: { tags?: string[] | undefined; groupId?: string | undefined } = {},
    workspaceId?: string
  ): Promise<{ affected: number }> {
    if (deviceIds.length === 0) return { affected: 0 };
    // Only act on accounts the caller owns — prevents cross-tenant bulk mutation.
    const owned = new Set(
      (await prisma.farmAccount.findMany({
        where: { deviceId: { in: deviceIds }, ...(workspaceId ? { workspaceId } : {}) },
        select: { deviceId: true }
      })).map((a) => a.deviceId)
    );
    let affected = 0;
    for (const deviceId of deviceIds) {
      if (!owned.has(deviceId)) continue;
      const acct = await prisma.farmAccount.findUnique({ where: { deviceId } });
      if (!acct) continue;
      if (action === 'addTags' && payload.tags?.length) {
        const next = Array.from(new Set([...(acct.tags ?? []), ...payload.tags.map((t) => t.trim()).filter(Boolean)]));
        await prisma.farmAccount.update({ where: { deviceId }, data: { tags: next } });
      } else if (action === 'removeTags' && payload.tags?.length) {
        const remove = new Set(payload.tags.map((t) => t.trim()));
        await prisma.farmAccount.update({ where: { deviceId }, data: { tags: (acct.tags ?? []).filter((t) => !remove.has(t)) } });
      } else if (action === 'pause') {
        await this.autoPause(deviceId, 'Operatör tarafından toplu duraklatıldı');
      } else if (action === 'resume') {
        await this.resumeAccount(deviceId);
      } else if (action === 'setGroup') {
        await prisma.device.update({ where: { id: deviceId }, data: { groupId: payload.groupId || null } }).catch(() => undefined);
      } else {
        continue;
      }
      affected += 1;
    }
    return { affected };
  },

  // Ensure a FarmAccount row exists for a device (created lazily as devices farm).
  async ensureAccount(deviceId: string, workspaceId?: string) {
    const existing = await prisma.farmAccount.findUnique({ where: { deviceId } });
    if (existing) {
      // If the caller is workspace-scoped, the existing row must belong to it —
      // otherwise this is a cross-tenant access attempt.
      if (workspaceId && existing.workspaceId && existing.workspaceId !== workspaceId) {
        throw new AppError('Hesap bulunamadı', 404, 'FARM_ACCOUNT_NOT_FOUND');
      }
      return existing;
    }
    return prisma.farmAccount.create({
      data: { deviceId, ...(workspaceId ? { workspaceId } : {}) }
    });
  },

  // ── Engine ─────────────────────────────────────────────────────────────
  // Ticked on an interval. For each ACTIVE campaign whose nextRunAt has passed
  // and is within active hours, dispatch the flow to ONE eligible device that
  // hasn't hit its daily cap, then schedule the next humanized run.
  async tick(now: Date = new Date()): Promise<{ dispatched: number; campaigns: number }> {
    const due = await prisma.farmCampaign.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: now } }
    });

    let dispatched = 0;
    const hour = now.getHours();

    for (const c of due) {
      // Respect the campaign's active hours (the farm "sleeps" at night).
      const within =
        c.activeFromHour <= c.activeToHour
          ? hour >= c.activeFromHour && hour < c.activeToHour
          : hour >= c.activeFromHour || hour < c.activeToHour;
      // A campaign is runnable if it targets a group and has at least one flow
      // configured (default OR any stage-specific flow).
      const hasAnyFlow = Boolean(c.rpaFlowId || c.earlyFlowId || c.midFlowId || c.matureFlowId);
      if (!within || !hasAnyFlow || !c.groupId) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      const devices = await prisma.device.findMany({ where: { groupId: c.groupId }, select: { id: true, status: true } });
      if (devices.length === 0) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      // Proxy-risk context for this campaign: rotation requested but no healthy
      // egress in the pool means every rotated session risks a bad/leaky exit.
      let hasDeadProxy = false;
      if (c.rotateProxy) {
        const healthy = await prisma.proxy.count({ where: { ...(c.workspaceId ? { workspaceId: c.workspaceId } : {}), status: { not: 'FAILED' } } });
        hasDeadProxy = healthy === 0;
      }

      // Pick an eligible device: under its daily cap (and warmup-stage cap), not
      // auto-paused by ban defense, and online (offline => can't farm safely).
      // We carry each candidate's warmup stage so stage-aware flow selection can
      // pick the right behavior (gentle for new accounts, richer for mature).
      const candidates: { deviceId: string; stage: number }[] = [];
      for (const d of devices) {
        const acct = await this.ensureAccount(d.id, c.workspaceId ?? undefined);
        const fresh = this.rollDayIfNeeded(acct, now);
        // Proactive ban-risk: recompute + persist each device's leading-indicator
        // risk score every tick, and alert once per cooldown when it spikes. This
        // catches a device drifting toward a ban *before* its health collapses.
        await this.evaluateRisk(d.id, now, { hasDeadProxy }).catch(() => undefined);
        // Ban defense: skip a device the engine has already auto-paused, and
        // auto-pause one whose health just fell below the campaign threshold.
        if (fresh.paused) continue;
        if (fresh.healthScore < c.autoPauseThreshold) {
          await this.autoPause(d.id, `Sağlık skoru ${fresh.healthScore} eşiğin (${c.autoPauseThreshold}) altına düştü`);
          continue;
        }
        if (d.status === 'OFFLINE' || d.status === 'ERROR') continue;
        const stageCap = STAGE_DAILY_CAP[Math.min(fresh.warmupStage, STAGE_DAILY_CAP.length - 1)] ?? 20;
        const cap = Math.min(c.maxActionsPerDay, stageCap);
        if (fresh.actionsToday < cap) candidates.push({ deviceId: d.id, stage: fresh.warmupStage });
      }
      if (candidates.length === 0) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      // Humanized device selection: random eligible device.
      const pick = candidates[randInt(0, candidates.length - 1)]!;
      const deviceId = pick.deviceId;

      // Stage-aware warmup: pick the flow that matches this device's maturity.
      const flowId = this.flowForStage(c, pick.stage);
      const flow = flowId ? await prisma.rpaFlow.findUnique({ where: { id: flowId } }) : null;
      if (!flow) {
        // No usable flow for this stage — skip this device, reschedule campaign.
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      // Proxy rotation: assign a rotating proxy from the workspace pool before
      // running, so each session exits from a different IP (lower detection).
      if (c.rotateProxy) {
        await this.rotateProxyFor(deviceId, c.workspaceId ?? undefined, c.runCount);
        await this.logAction({ deviceId, campaignId: c.id, kind: 'proxy_rotated', warmupStage: pick.stage, workspaceId: c.workspaceId ?? undefined });
      }

      await createJobRecord('RPA_RUN', { deviceId, flowId: flow.id, steps: flow.steps } as unknown as JobPayload, undefined, c.workspaceId ?? undefined);
      await this.recordAction(deviceId, now);
      await this.logAction({
        deviceId,
        campaignId: c.id,
        flowId: flow.id,
        flowName: flow.name,
        kind: 'dispatch',
        detail: `"${flow.name}" akışı çalıştırıldı`,
        warmupStage: pick.stage,
        workspaceId: c.workspaceId ?? undefined
      });
      dispatched += 1;

      await prisma.farmCampaign.update({
        where: { id: c.id },
        data: { lastRunAt: now, runCount: { increment: 1 } }
      });
      await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
    }

    return { dispatched, campaigns: due.length };
  },

  // Stage-aware flow selection. A campaign may define gentle (early), mid and
  // mature flows; each device runs the one matching its warmup stage. Falls back
  // to the default rpaFlow when a stage-specific flow isn't configured.
  flowForStage(
    c: { rpaFlowId: string | null; earlyFlowId: string | null; midFlowId: string | null; matureFlowId: string | null },
    stage: number
  ): string | null {
    let picked: string | null = null;
    if (stage <= 2) picked = c.earlyFlowId ?? null;
    else if (stage === 3) picked = c.midFlowId ?? null;
    else picked = c.matureFlowId ?? null;
    return picked ?? c.rpaFlowId ?? null;
  },

  // Append an entry to a farm account's timeline. Best-effort (never throws into
  // the engine loop).
  async logAction(entry: {
    deviceId: string;
    campaignId?: string | undefined;
    flowId?: string | undefined;
    flowName?: string | undefined;
    kind: string;
    detail?: string | undefined;
    warmupStage?: number | undefined;
    healthAfter?: number | undefined;
    workspaceId?: string | undefined;
  }) {
    await prisma.farmActionLog
      .create({
        data: {
          deviceId: entry.deviceId,
          ...(entry.campaignId ? { campaignId: entry.campaignId } : {}),
          ...(entry.flowId ? { flowId: entry.flowId } : {}),
          ...(entry.flowName ? { flowName: entry.flowName } : {}),
          kind: entry.kind,
          ...(entry.detail ? { detail: entry.detail } : {}),
          warmupStage: entry.warmupStage ?? 0,
          ...(typeof entry.healthAfter === 'number' ? { healthAfter: entry.healthAfter } : {}),
          ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {})
        }
      })
      .catch(() => undefined);
  },

  // Per-account timeline (most recent first).
  async listActionLog(deviceId: string, limit = 100, workspaceId?: string) {
    return prisma.farmActionLog.findMany({
      where: { deviceId, ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit))
    });
  },

  // Schedule the next run with humanized jitter so cadence is never robotic.
  async scheduleNext(id: string, minMin: number, maxMin: number, jitterPct: number, now: Date) {
    const base = randInt(minMin, Math.max(minMin, maxMin));
    const jitter = base * (jitterPct / 100) * (Math.random() * 2 - 1);
    const minutes = Math.max(1, Math.round(base + jitter));
    await prisma.farmCampaign.update({
      where: { id },
      data: { nextRunAt: new Date(now.getTime() + minutes * 60_000) }
    });
  },

  // Reset the daily counter at a new calendar day and bump maturity.
  rollDayIfNeeded<T extends { id: string; actionsToday: number; daysActive: number; warmupStage: number; dayAnchor: Date }>(acct: T, now: Date): T {
    const sameDay = acct.dayAnchor.toDateString() === now.toDateString();
    if (sameDay) return acct;
    // New day: reset today's counter, age the account, advance warmup stage
    // every 3 active days (cap at 5).
    const daysActive = acct.daysActive + 1;
    const warmupStage = Math.min(5, 1 + Math.floor(daysActive / 3));
    void prisma.farmAccount
      .update({ where: { id: acct.id }, data: { actionsToday: 0, daysActive, warmupStage, dayAnchor: now } })
      .catch(() => undefined);
    return { ...acct, actionsToday: 0, daysActive, warmupStage, dayAnchor: now };
  },

  async recordAction(deviceId: string, now: Date) {
    await prisma.farmAccount.update({
      where: { deviceId },
      data: { actionsToday: { increment: 1 }, totalActions: { increment: 1 }, lastActionAt: now }
    }).catch(() => undefined);
  },

  // ── Ban defense ────────────────────────────────────────────────────────
  // Auto-pause a device's farming and record why (shown in the UI).
  async autoPause(deviceId: string, reason: string) {
    const acct = await prisma.farmAccount.update({
      where: { deviceId },
      data: { paused: true, pausedReason: reason }
    }).catch(() => undefined);
    await this.logAction({ deviceId, kind: 'paused', detail: reason, warmupStage: acct?.warmupStage ?? 0, healthAfter: acct?.healthScore ?? undefined, workspaceId: acct?.workspaceId ?? undefined });
  },

  // Admin "resume" — clears the auto-pause and gives a small health rebound so
  // the device isn't immediately re-paused.
  async resumeAccount(deviceId: string, workspaceId?: string) {
    // Verify ownership before unpausing — no cross-tenant resume by deviceId.
    const owned = await prisma.farmAccount.findFirst({ where: { deviceId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!owned) throw new AppError('Hesap bulunamadı', 404, 'FARM_ACCOUNT_NOT_FOUND');
    const acct = await prisma.farmAccount.update({
      where: { deviceId },
      data: { paused: false, pausedReason: null, consecutiveErrors: 0, healthScore: 50 }
    });
    await this.logAction({ deviceId, kind: 'resumed', detail: 'Operatör tarafından devam ettirildi (sağlık 50\'ye sıfırlandı)', warmupStage: acct.warmupStage, healthAfter: acct.healthScore, workspaceId: acct.workspaceId ?? undefined });
    return acct;
  },

  // Called by the job pipeline when a farm RPA run finishes. A failure drops
  // health and, after repeated failures, auto-pauses (likely ban / broken flow).
  async recordOutcome(deviceId: string, success: boolean) {
    const acct = await prisma.farmAccount.findUnique({ where: { deviceId } });
    if (!acct) return;
    if (success) {
      const healthAfter = Math.min(100, acct.healthScore + 2);
      await prisma.farmAccount.update({
        where: { deviceId },
        data: { consecutiveErrors: 0, healthScore: healthAfter }
      });
      await this.logAction({ deviceId, kind: 'success', detail: 'Akış başarıyla tamamlandı', warmupStage: acct.warmupStage, healthAfter, workspaceId: acct.workspaceId ?? undefined });
      return;
    }
    const consecutiveErrors = acct.consecutiveErrors + 1;
    const healthScore = Math.max(0, acct.healthScore - 15);
    const shouldPause = consecutiveErrors >= 3 || healthScore <= 20;
    const pausedReason = `${consecutiveErrors} ardışık hata — olası ban`;
    await prisma.farmAccount.update({
      where: { deviceId },
      data: {
        consecutiveErrors,
        healthScore,
        ...(shouldPause ? { paused: true, pausedReason } : {})
      }
    });
    await this.logAction({ deviceId, kind: 'failure', detail: `Akış başarısız (${consecutiveErrors}. ardışık hata)`, warmupStage: acct.warmupStage, healthAfter: healthScore, workspaceId: acct.workspaceId ?? undefined });
    if (shouldPause) {
      await this.logAction({ deviceId, kind: 'paused', detail: pausedReason, warmupStage: acct.warmupStage, healthAfter: healthScore, workspaceId: acct.workspaceId ?? undefined });
    }
    // Re-score risk immediately after a failure so an operator is alerted the
    // moment a streak spikes the score, not only on the next engine tick.
    await this.evaluateRisk(deviceId, new Date(), { hasDeadProxy: false }).catch(() => undefined);
  },

  // ── Proxy rotation ─────────────────────────────────────────────────────
  // Round-robin a proxy from the workspace pool onto the device (records a
  // SET_PROXY job, same path bulk proxy assignment uses).
  async rotateProxyFor(deviceId: string, workspaceId: string | undefined, seed: number) {
    const all = await prisma.proxy.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'asc' }
    });
    if (all.length === 0) return;
    // Proxy health: prefer proxies that aren't known-dead. A FAILED proxy would
    // route the session through a broken egress (or worse, leak the real IP), so
    // we only fall back to the full pool if none are healthy yet.
    const healthy = all.filter((p) => p.status !== 'FAILED');
    const pool = healthy.length > 0 ? healthy : all;
    const proxy = pool[seed % pool.length]!;
    await createJobRecord(
      'EMULATOR_SET_PROXY',
      { deviceId, proxyId: proxy.id, host: proxy.host, port: proxy.port, type: proxy.type } as unknown as JobPayload,
      undefined,
      workspaceId
    );
  },

  // ── Analytics ──────────────────────────────────────────────────────────
  async getSummary(workspaceId?: string) {
    const ws = workspaceId ? { workspaceId } : {};
    const [campaigns, accounts, proxies] = await Promise.all([
      prisma.farmCampaign.findMany({ where: ws }),
      prisma.farmAccount.findMany({ where: ws }),
      prisma.proxy.findMany({ where: ws, select: { status: true } })
    ]);
    const total = accounts.length;
    const avgHealth = total ? Math.round(accounts.reduce((s, a) => s + a.healthScore, 0) / total) : 0;
    const actionsToday = accounts.reduce((s, a) => s + a.actionsToday, 0);
    const totalActions = accounts.reduce((s, a) => s + a.totalActions, 0);
    const paused = accounts.filter((a) => a.paused).length;
    const atRisk = accounts.filter((a) => a.healthScore < 50 && !a.paused).length;
    // Warmup-stage distribution (1..5).
    const stages = [0, 0, 0, 0, 0];
    for (const a of accounts) {
      const idx = Math.min(5, Math.max(1, a.warmupStage)) - 1;
      stages[idx] = (stages[idx] ?? 0) + 1;
    }
    return {
      campaigns: { total: campaigns.length, active: campaigns.filter((c) => c.status === 'ACTIVE').length },
      accounts: { total, paused, atRisk, avgHealth },
      actions: { today: actionsToday, total: totalActions },
      proxies: {
        total: proxies.length,
        healthy: proxies.filter((p) => p.status === 'OK').length,
        failed: proxies.filter((p) => p.status === 'FAILED').length,
        unknown: proxies.filter((p) => p.status === 'UNKNOWN').length
      },
      stageDistribution: stages,
      // Proactive ban-risk: how many accounts sit in the medium/high bands right
      // now (uses the persisted score the engine maintains each tick).
      risk: {
        high: accounts.filter((a) => a.riskScore >= RISK_ALERT_THRESHOLD).length,
        medium: accounts.filter((a) => a.riskScore >= 30 && a.riskScore < RISK_ALERT_THRESHOLD).length
      },
      topActive: [...accounts].sort((a, b) => b.totalActions - a.totalActions).slice(0, 5).map((a) => ({ deviceId: a.deviceId, totalActions: a.totalActions, healthScore: a.healthScore })),
      atRiskList: accounts.filter((a) => a.healthScore < 50).sort((a, b) => a.healthScore - b.healthScore).slice(0, 10).map((a) => ({ deviceId: a.deviceId, healthScore: a.healthScore, paused: a.paused, pausedReason: a.pausedReason }))
    };
  },

  // ── Ban-risk scoring (proactive defense) ────────────────────────────────
  // Compute the current ban-risk verdict for every account in a workspace,
  // ranked highest-first. Pure read — does not persist or alert (the engine
  // does that on tick). The dashboard calls this to render risk badges/reasons.
  async getRiskScores(workspaceId?: string): Promise<
    Array<{
      deviceId: string;
      deviceName: string | null;
      score: number;
      band: RiskVerdict['band'];
      factors: RiskFactor[];
      paused: boolean;
      healthScore: number;
      warmupStage: number;
    }>
  > {
    const ws = workspaceId ? { workspaceId } : {};
    const [accounts, hasHealthyProxy, anyRotates] = await Promise.all([
      prisma.farmAccount.findMany({ where: ws, include: { device: { select: { name: true } } } }),
      prisma.proxy.count({ where: { ...ws, status: { not: 'FAILED' } } }).then((n) => n > 0),
      prisma.farmCampaign.count({ where: { ...ws, status: 'ACTIVE', rotateProxy: true } }).then((n) => n > 0)
    ]);
    // Proxy risk applies only when rotation is in play but the pool has no
    // healthy egress to rotate to — then every rotated session risks a bad exit.
    const hasDeadProxy = anyRotates && !hasHealthyProxy;
    return accounts
      .map((a) => {
        const v = scoreRisk({
          healthScore: a.healthScore,
          consecutiveErrors: a.consecutiveErrors,
          warmupStage: a.warmupStage,
          actionsToday: a.actionsToday,
          paused: a.paused,
          hasDeadProxy
        });
        return {
          deviceId: a.deviceId,
          deviceName: a.device?.name ?? null,
          score: v.score,
          band: v.band,
          factors: v.factors,
          paused: a.paused,
          healthScore: a.healthScore,
          warmupStage: a.warmupStage
        };
      })
      .sort((x, y) => y.score - x.score);
  },

  // Recompute a single account's risk, persist it, and fire a FARM_BAN_RISK
  // alert when it crosses the threshold (rate-limited per account by a cooldown
  // so a device that stays risky alerts once, not every tick). Best-effort.
  async evaluateRisk(
    deviceId: string,
    now: Date,
    ctx: { hasDeadProxy: boolean }
  ): Promise<RiskVerdict | null> {
    const acct = await prisma.farmAccount.findUnique({ where: { deviceId }, include: { device: { select: { name: true } } } });
    if (!acct) return null;
    const verdict = scoreRisk({
      healthScore: acct.healthScore,
      consecutiveErrors: acct.consecutiveErrors,
      warmupStage: acct.warmupStage,
      actionsToday: acct.actionsToday,
      paused: acct.paused,
      hasDeadProxy: ctx.hasDeadProxy
    });

    // Fire only when crossing into the high band, and only if we haven't already
    // alerted within the cooldown window.
    const crossed = verdict.score >= RISK_ALERT_THRESHOLD;
    const cooled = !acct.riskAlertedAt || now.getTime() - acct.riskAlertedAt.getTime() >= RISK_ALERT_COOLDOWN_MS;
    const shouldAlert = crossed && cooled;

    await prisma.farmAccount
      .update({
        where: { deviceId },
        data: { riskScore: verdict.score, ...(shouldAlert ? { riskAlertedAt: now } : {}) }
      })
      .catch(() => undefined);

    if (shouldAlert) {
      const name = acct.device?.name ?? deviceId.slice(0, 10);
      const reasons = verdict.factors.map((f) => f.label).join('; ');
      await alertsService
        .evaluate(acct.workspaceId ?? undefined, 'FARM_BAN_RISK', {
          title: `Ban riski yüksek: ${name} (${verdict.score})`,
          detail: reasons || 'Yüksek ban-risk skoru',
          value: verdict.score
        })
        .catch(() => undefined);
      await this.logAction({
        deviceId,
        kind: 'risk_alert',
        detail: `Ban-risk skoru ${verdict.score} — ${reasons}`,
        warmupStage: acct.warmupStage,
        healthAfter: acct.healthScore,
        workspaceId: acct.workspaceId ?? undefined
      });
    }
    return verdict;
  },

  // ── CSV import: create devices (and warmup rows) in bulk ───────────────
  // Each row: name[,countryCode][,groupName]. Returns created/skipped counts.
  async importAccounts(rows: { name: string; countryCode?: string | undefined; groupName?: string | undefined }[], workspaceId?: string) {
    let created = 0;
    let skipped = 0;
    const groupCache = new Map<string, string>();
    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) { skipped += 1; continue; }
      // Resolve/create the group by name if provided.
      let groupId: string | undefined;
      if (row.groupName?.trim()) {
        const key = row.groupName.trim();
        if (groupCache.has(key)) groupId = groupCache.get(key);
        else {
          const existing = await prisma.deviceGroup.findFirst({ where: { name: key, ...(workspaceId ? { workspaceId } : {}) } });
          const grp = existing ?? await prisma.deviceGroup.create({ data: { name: key, ...(workspaceId ? { workspaceId } : {}) } });
          groupId = grp.id;
          groupCache.set(key, grp.id);
        }
      }
      const device = await prisma.device.create({
        data: {
          name,
          ...(groupId ? { group: { connect: { id: groupId } } } : {}),
          ...(workspaceId ? { workspace: { connect: { id: workspaceId } } } : {})
        }
      });
      await this.ensureAccount(device.id, workspaceId);
      created += 1;
    }
    return { created, skipped };
  },

  // ── CSV export: account roster + warmup state as a downloadable report ──
  // Public fields only (no secrets — just whether each secret is set).
  async exportAccountsCsv(workspaceId?: string): Promise<string> {
    const rows = await prisma.farmAccount.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { device: { select: { name: true, status: true } } }
    });
    const header = [
      'device', 'status', 'platform', 'username', 'email', 'warmupStage',
      'healthScore', 'daysActive', 'actionsToday', 'totalActions',
      'paused', 'pausedReason', 'hasPassword', 'hasTotp', 'tags', 'lastActionAt'
    ];
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.device?.name ?? r.deviceId,
        r.device?.status ?? '',
        r.platform ?? '',
        r.username ?? '',
        r.emailAddress ?? '',
        r.warmupStage,
        r.healthScore,
        r.daysActive,
        r.actionsToday,
        r.totalActions,
        r.paused ? 'yes' : 'no',
        r.pausedReason ?? '',
        r.passwordEnc ? 'yes' : 'no',
        r.totpSecretEnc ? 'yes' : 'no',
        (r.tags ?? []).join('|'),
        r.lastActionAt ? r.lastActionAt.toISOString() : ''
      ].map(esc).join(',')
    );
    return [header.join(','), ...lines].join('\n');
  },

  // Workspace-agnostic tick used by the in-process scheduler.
  async tickAll(): Promise<void> {
    await this.tick();
  }
};
