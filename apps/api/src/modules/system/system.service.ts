import os from 'node:os';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { jobQueue } from '../jobs/queue';
import { pluginRegistry } from '../plugins/registry';
import { DockerService } from '../emulators/docker.service';

const dockerService = new DockerService();

export type SystemOverview = {
  service: {
    name: string;
    nodeEnv: string;
    uptimeSeconds: number;
  };
  database: {
    status: 'healthy' | 'degraded';
    emulators: number;
    jobs: number;
    auditLogs: number;
  };
  queue: {
    status: 'healthy' | 'degraded';
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  };
  docker: {
    status: 'healthy' | 'degraded';
    totalContainers: number;
    runningContainers: number;
  };
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usagePercent: number;
  };
  plugins: Array<{
    id: string;
    displayName: string;
    packageName: string;
    activity: string | null;
    canInstallFromApk: boolean;
  }>;
};

function toMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

export async function getSystemOverview(): Promise<SystemOverview> {
  const [emulatorsResult, jobsResult, auditResult, queueCountsResult, containersResult] = await Promise.allSettled([
    prisma.emulator.count(),
    prisma.job.count(),
    prisma.auditLog.count(),
    jobQueue.getJobCounts(),
    dockerService.listContainers()
  ]);

  const databaseHealthy = emulatorsResult.status === 'fulfilled' && jobsResult.status === 'fulfilled' && auditResult.status === 'fulfilled';
  const queueHealthy = queueCountsResult.status === 'fulfilled';
  const dockerHealthy = containersResult.status === 'fulfilled';
  const queueCounts = queueCountsResult.status === 'fulfilled' ? queueCountsResult.value : { waiting: 0, active: 0, completed: 0, failed: 0 };
  const containers = containersResult.status === 'fulfilled' ? containersResult.value : [];
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  return {
    service: {
      name: env.appName,
      nodeEnv: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime())
    },
    database: {
      status: databaseHealthy ? 'healthy' : 'degraded',
      emulators: emulatorsResult.status === 'fulfilled' ? emulatorsResult.value : 0,
      jobs: jobsResult.status === 'fulfilled' ? jobsResult.value : 0,
      auditLogs: auditResult.status === 'fulfilled' ? auditResult.value : 0
    },
    queue: {
      status: queueHealthy ? 'healthy' : 'degraded',
      waiting: queueCounts.waiting ?? 0,
      active: queueCounts.active ?? 0,
      completed: queueCounts.completed ?? 0,
      failed: queueCounts.failed ?? 0
    },
    docker: {
      status: dockerHealthy ? 'healthy' : 'degraded',
      totalContainers: containers.length,
      runningContainers: containers.filter((container) => container.state === 'running').length
    },
    memory: {
      totalMb: toMb(totalMemory),
      freeMb: toMb(freeMemory),
      usedMb: toMb(usedMemory),
      usagePercent: Math.round((usedMemory / totalMemory) * 100)
    },
    plugins: pluginRegistry.list().map((plugin) => ({
      id: plugin.id,
      displayName: plugin.displayName,
      packageName: plugin.packageName,
      activity: plugin.activity ?? null,
      canInstallFromApk: plugin.canInstallFromApk
    }))
  };
}
