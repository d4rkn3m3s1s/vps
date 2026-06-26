import { prisma } from '../../db/prisma';

// ── Trend analytics ─────────────────────────────────────────────────────────
//
// Daily time-series rollup of fleet metrics. A ticker calls rollupMetrics() once
// per cycle to (re)compute *today's* snapshot and upsert it into MetricSnapshot,
// one row per workspace per UTC day. The dashboard reads getTrends() to chart the
// last N days. Day buckets use UTC midnight (same convention as DeviceUsage).

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Compute today's metrics for a workspace (or fleet-wide when workspaceId is
// undefined) and upsert into the {workspaceId, day} row, overwriting today's
// values so re-running the ticker keeps the row fresh.
export async function rollupMetrics(workspaceId?: string): Promise<void> {
  const now = new Date();
  const day = utcDay(now);
  const wsFilter = workspaceId ? { workspaceId } : {};

  const [devices, onlineDevices, jobs, jobsCompleted, jobsFailed, farm, usageAgg] = await Promise.all([
    prisma.device.count({ where: { ...wsFilter } }),
    prisma.device.count({ where: { ...wsFilter, status: 'ONLINE' } }),
    prisma.job.count({ where: { ...wsFilter } }),
    prisma.job.count({ where: { ...wsFilter, status: 'COMPLETED' } }),
    prisma.job.count({ where: { ...wsFilter, status: 'FAILED' } }),
    prisma.farmAccount.aggregate({ where: { ...wsFilter }, _count: { _all: true }, _avg: { healthScore: true } }),
    prisma.deviceUsage.aggregate({ where: { ...wsFilter, day }, _sum: { onlineMinutes: true } })
  ]);

  const farmAccounts = farm._count._all;
  const avgHealthScore = Math.round(farm._avg.healthScore ?? 0);
  const onlineMinutes = usageAgg._sum.onlineMinutes ?? 0;

  const data = {
    devices,
    onlineDevices,
    jobs,
    jobsCompleted,
    jobsFailed,
    farmAccounts,
    avgHealthScore,
    onlineMinutes
  };

  try {
    if (workspaceId) {
      await prisma.metricSnapshot.upsert({
        where: { workspaceId_day: { workspaceId, day } },
        create: { day, workspaceId, ...data },
        update: { ...data }
      });
    } else {
      // Fleet-wide row has workspaceId = null, which Prisma's compound-unique
      // input doesn't accept — fall back to find + update/create.
      const existing = await prisma.metricSnapshot.findFirst({ where: { workspaceId: null, day } });
      if (existing) {
        await prisma.metricSnapshot.update({ where: { id: existing.id }, data: { ...data } });
      } else {
        await prisma.metricSnapshot.create({ data: { day, ...data } });
      }
    }
  } catch {
    // best-effort rollup; never throw
  }
}

// Read the daily series for the last `days` days plus the latest totals.
export async function getTrends(workspaceId: string | undefined, days = 30) {
  const clamped = Math.max(1, Math.min(365, days));
  const since = utcDay(new Date(Date.now() - clamped * 86_400_000));
  const rows = await prisma.metricSnapshot.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}), day: { gte: since } },
    orderBy: { day: 'asc' }
  });

  const series = rows.map((r) => ({
    date: r.day.toISOString().slice(0, 10),
    devices: r.devices,
    onlineDevices: r.onlineDevices,
    jobs: r.jobs,
    jobsCompleted: r.jobsCompleted,
    jobsFailed: r.jobsFailed,
    farmAccounts: r.farmAccounts,
    avgHealthScore: r.avgHealthScore,
    onlineMinutes: r.onlineMinutes
  }));

  const latest = series.length ? series[series.length - 1] : null;
  const totals = latest
    ? {
        devices: latest.devices,
        onlineDevices: latest.onlineDevices,
        jobs: latest.jobs,
        jobsCompleted: latest.jobsCompleted,
        jobsFailed: latest.jobsFailed,
        farmAccounts: latest.farmAccounts,
        avgHealthScore: latest.avgHealthScore,
        onlineMinutes: latest.onlineMinutes
      }
    : {
        devices: 0,
        onlineDevices: 0,
        jobs: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        farmAccounts: 0,
        avgHealthScore: 0,
        onlineMinutes: 0
      };

  return { days: clamped, series, totals };
}

// Wired into the in-process ticker by the orchestrator (index.ts). Safe to call
// unconditionally — swallows errors so a rollup failure never crashes the tick.
export async function tickTrendsRollup(): Promise<void> {
  try {
    await rollupMetrics(undefined);
  } catch {
    // best-effort; never throw from the ticker
  }
}
