import { Prisma, type JobType, type ScheduleRepeat } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';

export type ScheduleCreateInput = {
  name: string;
  jobType: JobType;
  deviceId?: string | undefined;
  payload?: Record<string, unknown> | undefined;
  repeat?: ScheduleRepeat | undefined;
  nextRunAt: string | Date;
};

export type ScheduleUpdateInput = {
  name?: string | undefined;
  status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | undefined;
  repeat?: ScheduleRepeat | undefined;
  nextRunAt?: string | Date | undefined;
};

const REPEAT_MS: Record<ScheduleRepeat, number> = {
  ONCE: 0,
  HOURLY: 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export class SchedulerService {
  async list() {
    return prisma.scheduledTask.findMany({
      orderBy: { nextRunAt: 'asc' },
      include: { device: { select: { id: true, name: true } } }
    });
  }

  async create(input: ScheduleCreateInput) {
    if (input.deviceId) {
      const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
      if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }

    const data: Prisma.ScheduledTaskCreateInput = {
      name: input.name,
      jobType: input.jobType,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      repeat: input.repeat ?? 'ONCE',
      nextRunAt: toDate(input.nextRunAt)
    };
    if (input.deviceId) data.device = { connect: { id: input.deviceId } };

    return prisma.scheduledTask.create({ data, include: { device: { select: { id: true, name: true } } } });
  }

  async update(id: string, input: ScheduleUpdateInput) {
    await this.assertExists(id);
    const data: Prisma.ScheduledTaskUpdateInput = {};
    if (input.name) data.name = input.name;
    if (input.status) data.status = input.status;
    if (input.repeat) data.repeat = input.repeat;
    if (input.nextRunAt) data.nextRunAt = toDate(input.nextRunAt);
    return prisma.scheduledTask.update({ where: { id }, data, include: { device: { select: { id: true, name: true } } } });
  }

  async remove(id: string) {
    await this.assertExists(id);
    return prisma.scheduledTask.delete({ where: { id } });
  }

  // Fires every due ACTIVE task: records the job, advances or completes the
  // schedule based on its repeat interval. Returns how many tasks ran.
  async runDue(now: Date = new Date()): Promise<number> {
    const due = await prisma.scheduledTask.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: now } }
    });

    for (const task of due) {
      // Job.emulatorId is a FK to the Emulator table, not Device — so we carry
      // the target device id inside the payload instead of as the FK.
      const payload = { ...(task.payload as JobPayload), deviceId: task.deviceId ?? undefined };
      await createJobRecord(task.jobType, payload);

      if (task.repeat === 'ONCE') {
        await prisma.scheduledTask.update({
          where: { id: task.id },
          data: { status: 'COMPLETED', lastRunAt: now, runCount: { increment: 1 } }
        });
      } else {
        const next = new Date(now.getTime() + REPEAT_MS[task.repeat]);
        await prisma.scheduledTask.update({
          where: { id: task.id },
          data: { lastRunAt: now, nextRunAt: next, runCount: { increment: 1 } }
        });
      }
    }

    return due.length;
  }

  private async assertExists(id: string): Promise<void> {
    const task = await prisma.scheduledTask.findUnique({ where: { id } });
    if (!task) throw new AppError('Scheduled task not found', 404, 'SCHEDULE_NOT_FOUND');
  }
}

export const schedulerService = new SchedulerService();
