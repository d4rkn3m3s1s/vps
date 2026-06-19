import { prisma } from '../../db/prisma';

// Workspace-scoped operational summary over a date range. Powers the Reports
// page + CSV/JSON export. All counts are restricted to the active workspace.
export class ReportsService {
  async summary(workspaceId: string, from: Date, to: Date) {
    const range = { gte: from, lte: to };
    const ws = { workspaceId };

    const [
      deviceTotal,
      deviceOnline,
      jobsTotal,
      jobsCompleted,
      jobsFailed,
      jobsPending,
      jobsInRange,
      proxies,
      members,
      alertEvents,
      byType
    ] = await Promise.all([
      prisma.device.count({ where: ws }),
      prisma.device.count({ where: { ...ws, status: 'ONLINE' } }),
      prisma.job.count({ where: ws }),
      prisma.job.count({ where: { ...ws, status: 'COMPLETED' } }),
      prisma.job.count({ where: { ...ws, status: 'FAILED' } }),
      prisma.job.count({ where: { ...ws, status: { in: ['PENDING', 'RUNNING'] } } }),
      prisma.job.count({ where: { ...ws, createdAt: range } }),
      prisma.proxy.count({ where: ws }),
      prisma.workspaceMember.count({ where: ws }),
      prisma.alertEvent.count({ where: { ...ws, createdAt: range } }),
      prisma.job.groupBy({ by: ['type'], where: { ...ws, createdAt: range }, _count: { _all: true } })
    ]);

    const total = jobsCompleted + jobsFailed;
    const successRate = total > 0 ? Math.round((jobsCompleted / total) * 100) : 0;

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      devices: { total: deviceTotal, online: deviceOnline },
      jobs: {
        total: jobsTotal,
        completed: jobsCompleted,
        failed: jobsFailed,
        pending: jobsPending,
        inRange: jobsInRange,
        successRate
      },
      proxies,
      members,
      alertEvents,
      jobsByType: byType.map((b) => ({ type: b.type, count: b._count._all })).sort((a, b) => b.count - a.count)
    };
  }

  // Flat rows for CSV export: one row per job in range.
  async jobRows(workspaceId: string, from: Date, to: Date) {
    const jobs = await prisma.job.findMany({
      where: { workspaceId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      take: 5000
    });
    return jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      deviceId: (j.payload as { deviceId?: string } | null)?.deviceId ?? j.emulatorId ?? '',
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? '',
      error: j.error ?? ''
    }));
  }
}

export const reportsService = new ReportsService();
