import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';

// A single RPA step. `type` drives what the runner does; other fields are
// step-specific (e.g. tap has x/y, type has text, wait has ms).
export type RpaStep = {
  type:
    | 'tap' | 'type' | 'wait' | 'swipe' | 'openApp' | 'shell' | 'keyevent'
    | 'uiDump' | 'tapText' | 'tapDesc' | 'tapId' | 'waitText' | 'readMessages';
  x?: number | undefined;
  y?: number | undefined;
  x2?: number | undefined;
  y2?: number | undefined;
  text?: string | undefined;
  ms?: number | undefined;
  packageName?: string | undefined;
  command?: string | undefined;
  keycode?: number | undefined;
  query?: string | undefined;
  timeoutMs?: number | undefined;
};

export type RpaFlowInput = {
  name: string;
  description?: string | undefined;
  steps: RpaStep[];
};

export class RpaService {
  async list(workspaceId?: string) {
    return prisma.rpaFlow.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async get(id: string) {
    const flow = await prisma.rpaFlow.findUnique({ where: { id } });
    if (!flow) throw new AppError('Flow not found', 404, 'FLOW_NOT_FOUND');
    return flow;
  }

  async create(input: RpaFlowInput, workspaceId?: string) {
    return prisma.rpaFlow.create({
      data: {
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        steps: input.steps as unknown as Prisma.InputJsonValue,
        ...(workspaceId ? { workspaceId } : {})
      }
    });
  }

  async update(id: string, input: { name?: string | undefined; description?: string | undefined; steps?: RpaStep[] | undefined }) {
    await this.get(id);
    const data: Prisma.RpaFlowUpdateInput = {};
    if (input.name) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.steps) data.steps = input.steps as unknown as Prisma.InputJsonValue;
    return prisma.rpaFlow.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.get(id);
    return prisma.rpaFlow.delete({ where: { id } });
  }

  // Dispatches the flow to one or more devices: one RPA_RUN job per device,
  // carrying the full step list in the payload for the runner to execute.
  async run(id: string, deviceIds: string[]) {
    const flow = await this.get(id);
    if (deviceIds.length === 0) throw new AppError('At least one device is required', 400, 'NO_DEVICES');

    const jobs = await Promise.all(
      deviceIds.map((deviceId) =>
        createJobRecord('RPA_RUN', {
          deviceId,
          flowId: flow.id,
          flowName: flow.name,
          steps: flow.steps
        })
      )
    );

    await prisma.rpaFlow.update({
      where: { id },
      data: { runCount: { increment: deviceIds.length }, lastRunAt: new Date() }
    });

    return { dispatched: jobs.length, jobIds: jobs.map((j) => j.id) };
  }
}

export const rpaService = new RpaService();
