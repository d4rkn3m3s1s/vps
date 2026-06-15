import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { jobQueue } from './queue';
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

export async function listJobs() {
  return prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function getJob(id: string) {
  return prisma.job.findUnique({ where: { id } });
}
