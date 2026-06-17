import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { jobQueue } from './queue';
import { deviceHub } from '../devices/device.hub';
import type { JobPayload, JobType } from './job.types';

export async function createJob(type: JobType, payload: JobPayload, emulatorId?: string): Promise<{ id: string }> {
  const job = await prisma.job.create({
    data: {
      type,
      status: 'PENDING',
        payload: payload as Prisma.InputJsonValue,
        ...(emulatorId ? { emulatorId } : {})
    }
  });

  await jobQueue.add(type, payload, {
    jobId: job.id,
    removeOnComplete: 100,
    removeOnFail: 100
  });

  return { id: job.id };
}

// Creates a persisted job record WITHOUT enqueuing to BullMQ. Used by dashboard
// actions (app install, automation task) so they appear in the Jobs list even
// when no worker is attached to execute emulator side-effects.
export async function createJobRecord(type: JobType, payload: JobPayload, emulatorId?: string, workspaceId?: string) {
  const job = await prisma.job.create({
    data: {
      type,
      status: 'PENDING',
      payload: payload as Prisma.InputJsonValue,
      ...(emulatorId ? { emulatorId } : {}),
      ...(workspaceId ? { workspaceId } : {})
    }
  });

  // Real-time push so the Jobs view + notifications update instantly.
  deviceHub.broadcast({
    type: 'job.created',
    deviceId: (payload.deviceId as string | undefined) ?? emulatorId ?? '',
    payload: { id: job.id, type: job.type, status: job.status },
    timestamp: new Date().toISOString(),
    workspaceId: workspaceId ?? undefined
  });

  return job;
}

export async function listJobs(workspaceId?: string) {
  return prisma.job.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getJob(id: string) {
  return prisma.job.findUnique({ where: { id } });
}
