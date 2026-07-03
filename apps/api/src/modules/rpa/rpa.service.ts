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

  // Workspace-scoped fetch: a flow in another tenant reads as "not found" rather
  // than being readable/executable/deletable cross-tenant.
  async get(id: string, workspaceId?: string) {
    const flow = await prisma.rpaFlow.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
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

  async update(
    id: string,
    input: { name?: string | undefined; description?: string | undefined; steps?: RpaStep[] | undefined },
    workspaceId?: string
  ) {
    await this.get(id, workspaceId);
    const data: Prisma.RpaFlowUpdateInput = {};
    if (input.name) data.name = input.name;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.steps) data.steps = input.steps as unknown as Prisma.InputJsonValue;
    return prisma.rpaFlow.update({ where: { id }, data });
  }

  async remove(id: string, workspaceId?: string) {
    await this.get(id, workspaceId);
    return prisma.rpaFlow.delete({ where: { id } });
  }

  // Dispatches the flow to one or more devices: one RPA_RUN job per device,
  // carrying the full step list in the payload for the runner to execute. Both the
  // flow AND the target devices are workspace-scoped — a tenant can't run their
  // flow on (or even reference) another tenant's devices.
  async run(id: string, deviceIds: string[], workspaceId?: string) {
    const flow = await this.get(id, workspaceId);
    if (deviceIds.length === 0) throw new AppError('At least one device is required', 400, 'NO_DEVICES');

    // Keep only devices the caller's workspace owns.
    const owned = await prisma.device.findMany({
      where: { id: { in: deviceIds }, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true }
    });
    const ownedIds = owned.map((d) => d.id);
    const missing = deviceIds.filter((d) => !ownedIds.includes(d));
    if (missing.length > 0) throw new AppError(`Unknown device(s): ${missing.join(', ')}`, 404, 'DEVICE_NOT_FOUND');

    const jobs = await Promise.all(
      ownedIds.map((deviceId) =>
        createJobRecord('RPA_RUN', {
          deviceId,
          flowId: flow.id,
          flowName: flow.name,
          steps: flow.steps
        }, undefined, workspaceId)
      )
    );

    await prisma.rpaFlow.update({
      where: { id },
      data: { runCount: { increment: ownedIds.length }, lastRunAt: new Date() }
    });

    return { dispatched: jobs.length, jobIds: jobs.map((j) => j.id) };
  }
}

export const rpaService = new RpaService();
