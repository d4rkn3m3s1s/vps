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
  // `Job.emulatorId` is a FK to the Emulator table, but most modern flows address
  // a Device (Device.id), which is NOT an Emulator row — passing it here triggers
  // a Job_emulatorId_fkey violation. So only set emulatorId when it truly matches
  // an Emulator; otherwise fold the id into payload.deviceId (which the host agent
  // already uses to claim jobs) so the link is preserved without breaking the FK.
  let validEmulatorId: string | undefined;
  let finalPayload = payload;
  if (emulatorId) {
    const exists = await prisma.emulator.findUnique({ where: { id: emulatorId }, select: { id: true } });
    if (exists) {
      validEmulatorId = emulatorId;
    } else if (!('deviceId' in (payload as Record<string, unknown>))) {
      finalPayload = { ...(payload as Record<string, unknown>), deviceId: emulatorId } as unknown as JobPayload;
    }
  }
  const job = await prisma.job.create({
    data: {
      type,
      status: 'PENDING',
      payload: finalPayload as Prisma.InputJsonValue,
      ...(validEmulatorId ? { emulatorId: validEmulatorId } : {}),
      ...(workspaceId ? { workspaceId } : {})
    }
  });

  // Real-time push so the Jobs view + notifications update instantly.
  deviceHub.broadcast({
    type: 'job.created',
    deviceId: ((finalPayload as Record<string, unknown>).deviceId as string | undefined) ?? emulatorId ?? '',
    payload: { id: job.id, type: job.type, status: job.status },
    timestamp: new Date().toISOString(),
    workspaceId: workspaceId ?? undefined
  });

  return job;
}

// Newest jobs for a workspace. `limit` is applied in the DB (not in JS) so we
// never load an entire job history into memory — a busy workspace can accumulate
// hundreds of thousands of rows. Capped at 500 as a hard safety ceiling.
export async function listJobs(workspaceId?: string, limit = 100) {
  return prisma.job.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 500)
  });
}

export async function getJob(id: string) {
  return prisma.job.findUnique({ where: { id } });
}
