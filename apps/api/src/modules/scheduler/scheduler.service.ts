import { Prisma, type JobType, type ScheduleRepeat } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { deviceAgentService } from '../device-agent/device-agent.service';

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
  async list(workspaceId?: string) {
    return prisma.scheduledTask.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { nextRunAt: 'asc' },
      include: { device: { select: { id: true, name: true } } }
    });
  }

  async create(input: ScheduleCreateInput, workspaceId?: string) {
    if (input.deviceId) {
      // Scope the device to the caller's workspace so a schedule can't target
      // another tenant's device.
      const device = await prisma.device.findFirst({ where: { id: input.deviceId, ...(workspaceId ? { workspaceId } : {}) } });
      if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }
    // Same cross-tenant WRITE guard as POST /jobs: a payload.accountId is written back
    // at completion time, so verify it belongs to the caller's workspace.
    const acctId = typeof (input.payload as { accountId?: unknown } | undefined)?.accountId === 'string'
      ? (input.payload as { accountId: string }).accountId : undefined;
    if (acctId && workspaceId) {
      const ownedAcc = await prisma.generatedAccount.findFirst({ where: { id: acctId, workspaceId }, select: { id: true } });
      if (!ownedAcc) throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
    }

    const data: Prisma.ScheduledTaskCreateInput = {
      name: input.name,
      jobType: input.jobType,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      repeat: input.repeat ?? 'ONCE',
      nextRunAt: toDate(input.nextRunAt)
    };
    if (input.deviceId) data.device = { connect: { id: input.deviceId } };
    if (workspaceId) data.workspace = { connect: { id: workspaceId } };

    return prisma.scheduledTask.create({ data, include: { device: { select: { id: true, name: true } } } });
  }

  async update(id: string, input: ScheduleUpdateInput, workspaceId?: string) {
    await this.assertExists(id, workspaceId);
    const data: Prisma.ScheduledTaskUpdateInput = {};
    if (input.name) data.name = input.name;
    if (input.status) data.status = input.status;
    if (input.repeat) data.repeat = input.repeat;
    if (input.nextRunAt) data.nextRunAt = toDate(input.nextRunAt);
    return prisma.scheduledTask.update({ where: { id }, data, include: { device: { select: { id: true, name: true } } } });
  }

  async remove(id: string, workspaceId?: string) {
    await this.assertExists(id, workspaceId);
    return prisma.scheduledTask.delete({ where: { id } });
  }

  // Fires every due ACTIVE task: records the job, advances or completes the
  // schedule based on its repeat interval. Returns how many tasks ran.
  async runDue(now: Date = new Date()): Promise<number> {
    const due = await prisma.scheduledTask.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: now } },
      // Cap per-tick work: after downtime hundreds of tasks can be due at once and
      // would lock a single 60s tick. Process the oldest 200; the rest run next tick.
      orderBy: { nextRunAt: 'asc' },
      take: 200
    });

    for (const task of due) {
     // Isolate each task: a dispatch failure (e.g. createJobRecord throwing
     // DEVICE_BUSY when the target device already has an active exclusive job) must
     // NOT abort the whole tick. Without this, one busy device's failing task threw
     // out of the loop, skipped every remaining due task, AND skipped its own
     // nextRunAt advance below — so it stayed ACTIVE with a past nextRunAt and
     // re-threw first on every subsequent tick, permanently wedging the scheduler.
     try {
      // Job.emulatorId is a FK to the Emulator table, not Device — so we carry
      // the target device id inside the payload instead of as the FK.
      const payload = { ...(task.payload as JobPayload), deviceId: task.deviceId ?? undefined };

      // AGENT_RUN is an API-side AI loop (over WS), not a host-agent job — start
      // it directly instead of enqueuing a Job. Failures (e.g. agent offline) are
      // swallowed so they don't block other due tasks; startRun records the error.
      if (task.jobType === 'AGENT_RUN') {
        const p = task.payload as { goal?: unknown; stealth?: unknown; useVision?: unknown; maxTurns?: unknown };
        if (task.deviceId && typeof p.goal === 'string' && p.goal.trim()) {
          await deviceAgentService
            .startRun({
              deviceId: task.deviceId,
              goal: p.goal,
              ...(task.workspaceId ? { workspaceId: task.workspaceId } : {}),
              ...(typeof p.stealth === 'boolean' ? { stealth: p.stealth } : {}),
              ...(typeof p.useVision === 'boolean' ? { useVision: p.useVision } : {}),
              ...(typeof p.maxTurns === 'number' ? { maxTurns: p.maxTurns } : {})
            })
            .catch(() => undefined);
        }
      } else {
        // Pass the task's workspaceId so the agent's cross-tenant claim guard applies
        // and the job shows up in that workspace's Jobs list (the AGENT_RUN branch above
        // already threads it; this non-agent path silently dropped it).
        await createJobRecord(task.jobType, payload, undefined, task.workspaceId ?? undefined);
      }

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
     } catch (err) {
       // Dispatch failed for THIS task. Advance/complete it anyway so it can't wedge
       // the batch by staying overdue and re-throwing first on every tick. A ONCE
       // task is marked COMPLETED (its single run is spent); a repeating task rolls
       // to its next slot. Best-effort: if even this update throws, swallow so the
       // loop continues to the next task.
       await prisma.scheduledTask
         .update({
           where: { id: task.id },
           data: task.repeat === 'ONCE'
             ? { status: 'COMPLETED', lastRunAt: now, runCount: { increment: 1 } }
             : { lastRunAt: now, nextRunAt: new Date(now.getTime() + REPEAT_MS[task.repeat]), runCount: { increment: 1 } }
         })
         .catch(() => undefined);
       logger.warn('Scheduled task dispatch failed', { taskId: task.id, jobType: task.jobType, error: err instanceof Error ? err.message : String(err) });
     }
    }

    return due.length;
  }

  private async assertExists(id: string, workspaceId?: string): Promise<void> {
    const task = await prisma.scheduledTask.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!task) throw new AppError('Scheduled task not found', 404, 'SCHEDULE_NOT_FOUND');
  }
}

export const schedulerService = new SchedulerService();
