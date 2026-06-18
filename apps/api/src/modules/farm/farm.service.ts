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
      const devices = await prisma.device.findMany({ where: { groupId: c.groupId }, select: { id: true } });
      if (!flow || devices.length === 0) {
        await this.scheduleNext(c.id, c.minIntervalMin, c.maxIntervalMin, c.jitterPct, now);
        continue;
      }

      // Pick an eligible device: one under its daily cap (and the warmup-stage cap).
      const candidates: string[] = [];
      for (const d of devices) {
        const acct = await this.ensureAccount(d.id, c.workspaceId ?? undefined);
        const fresh = this.rollDayIfNeeded(acct, now);
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
  rollDayIfNeeded(acct: { id: string; actionsToday: number; daysActive: number; warmupStage: number; dayAnchor: Date }, now: Date) {
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

  // Workspace-agnostic tick used by the in-process scheduler.
  async tickAll(): Promise<void> {
    await this.tick();
  }
};
