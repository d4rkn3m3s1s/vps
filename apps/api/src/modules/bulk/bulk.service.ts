import type { JobType } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';

export type BulkJobInput = {
  deviceIds: string[];
  jobType: JobType;
  payload?: Record<string, unknown> | undefined;
};

export type BulkProxyInput = {
  deviceIds: string[];
  proxyId: string;
};

async function assertDevices(deviceIds: string[]): Promise<void> {
  if (deviceIds.length === 0) throw new AppError('At least one device is required', 400, 'NO_DEVICES');
  const devices = await prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true } });
  const known = new Set(devices.map((d) => d.id));
  const missing = deviceIds.filter((id) => !known.has(id));
  if (missing.length > 0) throw new AppError(`Unknown device(s): ${missing.join(', ')}`, 404, 'DEVICE_NOT_FOUND');
}

export class BulkService {
  // Fans out one job per device for a single action (start/stop/install/etc.).
  async runJob(input: BulkJobInput, workspaceId?: string) {
    await assertDevices(input.deviceIds);
    const jobs = await Promise.all(
      input.deviceIds.map((deviceId) =>
        createJobRecord(input.jobType, { ...(input.payload ?? {}), deviceId } as JobPayload, undefined, workspaceId)
      )
    );
    return { created: jobs.length, jobIds: jobs.map((j) => j.id) };
  }

  // Assigns the same proxy to many devices: updates each device's connection
  // info and records a SET_PROXY job so the change is applied on the phone.
  async setProxy(input: BulkProxyInput, workspaceId?: string) {
    await assertDevices(input.deviceIds);
    const proxy = await prisma.proxy.findUnique({ where: { id: input.proxyId } });
    if (!proxy) throw new AppError('Proxy not found', 404, 'PROXY_NOT_FOUND');

    // NOTE: do not overwrite the device's ipAddress/adbPort here — those are the
    // phone's own ADB endpoint, not the proxy. The proxy is applied inside the
    // phone via the SET_PROXY job payload below.
    const jobs = await Promise.all(
      input.deviceIds.map((deviceId) =>
        createJobRecord('EMULATOR_SET_PROXY', {
          deviceId,
          proxyId: proxy.id,
          host: proxy.host,
          port: proxy.port,
          type: proxy.type
        } as JobPayload, undefined, workspaceId)
      )
    );

    return { updated: input.deviceIds.length, jobIds: jobs.map((j) => j.id) };
  }
}

export const bulkService = new BulkService();
