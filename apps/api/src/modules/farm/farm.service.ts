import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';

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
};

// Warmup ladder: how many actions/day are "safe" at each stage. New accounts
// (stage 1) act rarely; mature accounts (stage 5) act freely.
const STAGE_DAILY_CAP = [0, 5, 10, 20, 40, 80];

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
      include: { rpaFlow: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } }
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
      status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | undefined;
    }
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
    if (input.status !== undefined) data.status = input.status;
    return prisma.farmCampaign.update({ where: { id }, data });
  },

  async deleteCampaign(id: string) {
    await prisma.farmCampaign.delete({ where: { id } });
    return { deleted: true };
  },

  // ── Warmup accounts ────────────────────────────────────────────────────
  async listAccounts(workspaceId?: string) {
    const rows = await prisma.farmAccount.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { healthScore: 'asc' },
      include: { device: { select: { id: true, name: true, status: true } } }
    });
    return rows;
  },

  // Ensure a FarmAccount row exists for a device (created lazily as devices farm).
  async ensureAccount(deviceId: string, workspaceId?: string) {
    const existing = await prisma.farmAccount.findUnique({ where: { deviceId } });
    if (existing) return existing;
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
      if (!within || !c.rpaFlowId || !c.groupId) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      const flow = await prisma.rpaFlow.findUnique({ where: { id: c.rpaFlowId } });
      const devices = await prisma.device.findMany({ where: { groupId: c.groupId }, select: { id: true, status: true } });
      if (!flow || devices.length === 0) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      // Pick an eligible device: under its daily cap (and warmup-stage cap), not
      // auto-paused by ban defense, and online (offline => can't farm safely).
      const candidates: string[] = [];
      for (const d of devices) {
        const acct = await this.ensureAccount(d.id, c.workspaceId ?? undefined);
        const fresh = this.rollDayIfNeeded(acct, now);
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
        if (fresh.actionsToday < cap) candidates.push(d.id);
      }
      if (candidates.length === 0) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      // Humanized device selection: random eligible device.
      const deviceId = candidates[randInt(0, candidates.length - 1)]!;

      // Proxy rotation: assign a rotating proxy from the workspace pool before
      // running, so each session exits from a different IP (lower detection).
      if (c.rotateProxy) {
        await this.rotateProxyFor(deviceId, c.workspaceId ?? undefined, c.runCount);
      }

      await createJobRecord('RPA_RUN', { deviceId, flowId: flow.id, steps: flow.steps } as unknown as JobPayload, undefined, c.workspaceId ?? undefined);
      await this.recordAction(deviceId, now);
      dispatched += 1;

      await prisma.farmCampaign.update({
        where: { id: c.id },
        data: { lastRunAt: now, runCount: { increment: 1 } }
      });
      await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
    }

    return { dispatched, campaigns: due.length };
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
    await prisma.farmAccount.update({
      where: { deviceId },
      data: { paused: true, pausedReason: reason }
    }).catch(() => undefined);
  },

  // Admin "resume" — clears the auto-pause and gives a small health rebound so
  // the device isn't immediately re-paused.
  async resumeAccount(deviceId: string) {
    return prisma.farmAccount.update({
      where: { deviceId },
      data: { paused: false, pausedReason: null, consecutiveErrors: 0, healthScore: Math.max(50, 0) }
    });
  },

  // Called by the job pipeline when a farm RPA run finishes. A failure drops
  // health and, after repeated failures, auto-pauses (likely ban / broken flow).
  async recordOutcome(deviceId: string, success: boolean) {
    const acct = await prisma.farmAccount.findUnique({ where: { deviceId } });
    if (!acct) return;
    if (success) {
      await prisma.farmAccount.update({
        where: { deviceId },
        data: { consecutiveErrors: 0, healthScore: Math.min(100, acct.healthScore + 2) }
      });
      return;
    }
    const consecutiveErrors = acct.consecutiveErrors + 1;
    const healthScore = Math.max(0, acct.healthScore - 15);
    const shouldPause = consecutiveErrors >= 3 || healthScore <= 20;
    await prisma.farmAccount.update({
      where: { deviceId },
      data: {
        consecutiveErrors,
        healthScore,
        ...(shouldPause ? { paused: true, pausedReason: `${consecutiveErrors} ardışık hata — olası ban` } : {})
      }
    });
  },

  // ── Proxy rotation ─────────────────────────────────────────────────────
  // Round-robin a proxy from the workspace pool onto the device (records a
  // SET_PROXY job, same path bulk proxy assignment uses).
  async rotateProxyFor(deviceId: string, workspaceId: string | undefined, seed: number) {
    const proxies = await prisma.proxy.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'asc' }
    });
    if (proxies.length === 0) return;
    const proxy = proxies[seed % proxies.length]!;
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
    const [campaigns, accounts] = await Promise.all([
      prisma.farmCampaign.findMany({ where: ws }),
      prisma.farmAccount.findMany({ where: ws })
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
      stageDistribution: stages,
      topActive: [...accounts].sort((a, b) => b.totalActions - a.totalActions).slice(0, 5).map((a) => ({ deviceId: a.deviceId, totalActions: a.totalActions, healthScore: a.healthScore })),
      atRiskList: accounts.filter((a) => a.healthScore < 50).sort((a, b) => a.healthScore - b.healthScore).slice(0, 10).map((a) => ({ deviceId: a.deviceId, healthScore: a.healthScore, paused: a.paused, pausedReason: a.pausedReason }))
    };
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

  // Workspace-agnostic tick used by the in-process scheduler.
  async tickAll(): Promise<void> {
    await this.tick();
  }
};
