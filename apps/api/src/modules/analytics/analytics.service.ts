import { prisma } from '../../db/prisma';

// Analytics is now backed by REAL fleet operational data — devices, jobs, farm
// accounts and usage — not fabricated social metrics. (The old ContentMetric
// demo seed has been removed; there is no live social-network integration, so we
// surface the operational data we actually have instead of inventing numbers.)
export type AnalyticsSummary = {
  totals: {
    devices: number;
    onlineDevices: number;
    jobs: number;
    jobsCompleted: number;
    jobsFailed: number;
    successRate: number; // %
    farmAccounts: number;
    avgHealthScore: number; // 0-100
    onlineMinutes: number;
  };
  byJobType: Array<{ type: string; total: number; completed: number; failed: number; successRate: number }>;
  timeline: Array<{ date: string; jobs: number; completed: number; failed: number }>;
  farmByProvider: Array<{ provider: string; accounts: number; avgHealth: number; avgWarmupStage: number }>;
  topDevices: Array<{ deviceId: string; name: string; onlineMinutes: number; jobs: number }>;
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

export class AnalyticsService {
  async summary(workspaceId: string | undefined, days = 14): Promise<AnalyticsSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const wsJob = workspaceId ? { workspaceId } : {};
    const wsFarm = workspaceId ? { workspaceId } : {};

    const [devices, onlineDevices, jobs, farmAccounts, usage] = await Promise.all([
      prisma.device.count(workspaceId ? { where: { workspaceId } } : undefined),
      prisma.device.count({ where: { status: 'ONLINE', ...(workspaceId ? { workspaceId } : {}) } }),
      prisma.job.findMany({
        where: { createdAt: { gte: since }, ...wsJob },
        select: { type: true, status: true, createdAt: true }
      }),
      prisma.farmAccount.findMany({
        where: wsFarm,
        select: { platform: true, healthScore: true, warmupStage: true, deviceId: true }
      }),
      prisma.deviceUsage.findMany({
        where: { day: { gte: since }, ...(workspaceId ? { device: { workspaceId } } : {}) },
        select: { deviceId: true, onlineMinutes: true, device: { select: { name: true } } }
      })
    ]);

    const jobsCompleted = jobs.filter((j) => j.status === 'COMPLETED').length;
    const jobsFailed = jobs.filter((j) => j.status === 'FAILED').length;
    const onlineMinutes = usage.reduce((s, u) => s + u.onlineMinutes, 0);
    const avgHealthScore =
      farmAccounts.length > 0
        ? Math.round(farmAccounts.reduce((s, a) => s + a.healthScore, 0) / farmAccounts.length)
        : 0;

    const totals = {
      devices,
      onlineDevices,
      jobs: jobs.length,
      jobsCompleted,
      jobsFailed,
      successRate: pct(jobsCompleted, jobsCompleted + jobsFailed),
      farmAccounts: farmAccounts.length,
      avgHealthScore,
      onlineMinutes
    };

    // Per job type.
    const typeMap = new Map<string, { total: number; completed: number; failed: number }>();
    for (const j of jobs) {
      const cur = typeMap.get(j.type) ?? { total: 0, completed: 0, failed: 0 };
      cur.total += 1;
      if (j.status === 'COMPLETED') cur.completed += 1;
      if (j.status === 'FAILED') cur.failed += 1;
      typeMap.set(j.type, cur);
    }
    const byJobType = Array.from(typeMap.entries())
      .map(([type, v]) => ({ type, ...v, successRate: pct(v.completed, v.completed + v.failed) }))
      .sort((a, b) => b.total - a.total);

    // Daily timeline.
    const dayMap = new Map<string, { jobs: number; completed: number; failed: number }>();
    for (const j of jobs) {
      const key = j.createdAt.toISOString().slice(0, 10);
      const cur = dayMap.get(key) ?? { jobs: 0, completed: 0, failed: 0 };
      cur.jobs += 1;
      if (j.status === 'COMPLETED') cur.completed += 1;
      if (j.status === 'FAILED') cur.failed += 1;
      dayMap.set(key, cur);
    }
    const timeline = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Farm accounts grouped by platform (x / instagram / tiktok / ...).
    const provMap = new Map<string, { accounts: number; health: number; warmup: number }>();
    for (const a of farmAccounts) {
      const platform = a.platform ?? 'other';
      const cur = provMap.get(platform) ?? { accounts: 0, health: 0, warmup: 0 };
      cur.accounts += 1;
      cur.health += a.healthScore;
      cur.warmup += a.warmupStage;
      provMap.set(platform, cur);
    }
    const farmByProvider = Array.from(provMap.entries()).map(([provider, v]) => ({
      provider,
      accounts: v.accounts,
      avgHealth: v.accounts > 0 ? Math.round(v.health / v.accounts) : 0,
      avgWarmupStage: v.accounts > 0 ? Number((v.warmup / v.accounts).toFixed(1)) : 0
    }));

    // Top devices by online minutes + job count.
    const jobsByDevice = new Map<string, number>();
    // jobs don't carry deviceId in this lightweight select; derive activity from usage.
    const deviceAgg = new Map<string, { name: string; onlineMinutes: number }>();
    for (const u of usage) {
      const cur = deviceAgg.get(u.deviceId) ?? { name: u.device?.name ?? u.deviceId, onlineMinutes: 0 };
      cur.onlineMinutes += u.onlineMinutes;
      deviceAgg.set(u.deviceId, cur);
    }
    const topDevices = Array.from(deviceAgg.entries())
      .map(([deviceId, v]) => ({ deviceId, name: v.name, onlineMinutes: v.onlineMinutes, jobs: jobsByDevice.get(deviceId) ?? 0 }))
      .sort((a, b) => b.onlineMinutes - a.onlineMinutes)
      .slice(0, 5);

    return { totals, byJobType, timeline, farmByProvider, topDevices };
  }
}

export const analyticsService = new AnalyticsService();
