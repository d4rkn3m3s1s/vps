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

// Verifies every id is a device the CALLER's workspace owns. Scoping by
// workspaceId here closes a cross-tenant control hole: without it, any id could be
// targeted by bulk start/stop/install/proxy. Devices outside the workspace read as
// "unknown" (404) rather than being silently actionable.
async function assertDevices(deviceIds: string[], workspaceId?: string): Promise<void> {
  if (deviceIds.length === 0) throw new AppError('At least one device is required', 400, 'NO_DEVICES');
  const devices = await prisma.device.findMany({
    where: { id: { in: deviceIds }, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true }
  });
  const known = new Set(devices.map((d) => d.id));
  const missing = deviceIds.filter((id) => !known.has(id));
  if (missing.length > 0) throw new AppError(`Unknown device(s): ${missing.join(', ')}`, 404, 'DEVICE_NOT_FOUND');
}

export class BulkService {
  // Fans out one job per device for a single action (start/stop/install/etc.).
  // A busy device (DEVICE_BUSY) is skipped, not fatal for the whole batch — we
  // report which devices were skipped so the panel can warn the operator.
  async runJob(input: BulkJobInput, workspaceId?: string) {
    await assertDevices(input.deviceIds, workspaceId);
    const results = await Promise.allSettled(
      input.deviceIds.map((deviceId) =>
        createJobRecord(input.jobType, { ...(input.payload ?? {}), deviceId } as JobPayload, undefined, workspaceId)
          .then((j) => ({ deviceId, id: j.id }))
      )
    );
    const jobIds: string[] = [];
    const skipped: { deviceId: string; reason: string }[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') jobIds.push(r.value.id);
      else {
        const err = r.reason as { code?: string; message?: string };
        skipped.push({ deviceId: input.deviceIds[i]!, reason: err?.message || 'İş oluşturulamadı' });
      }
    });
    return { created: jobIds.length, jobIds, skipped };
  }

  // Assigns the same proxy to many devices: updates each device's connection
  // info and records a SET_PROXY job so the change is applied on the phone.
  async setProxy(input: BulkProxyInput, workspaceId?: string) {
    await assertDevices(input.deviceIds, workspaceId);
    // Scope the proxy to the caller's workspace too, so one tenant can't apply
    // another tenant's proxy (which would also leak that proxy's host/port).
    const proxy = await prisma.proxy.findFirst({
      where: { id: input.proxyId, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!proxy) throw new AppError('Proxy not found', 404, 'PROXY_NOT_FOUND');

    // NOTE: do not overwrite the device's ipAddress/adbPort here — those are the
    // phone's own ADB endpoint, not the proxy. The proxy is applied inside the
    // phone via the SET_PROXY job payload below (real redsocks routing for Waydroid).
    // Fetch every device's metadata (for the Waydroid instance name) in ONE query
    // up front (N+1 findUnique → 1 findMany), then read it from a Map in the loop.
    const metaRows = await prisma.device.findMany({
      where: { id: { in: input.deviceIds } },
      select: { id: true, metadata: true }
    });
    const metaById = new Map(metaRows.map((r) => [r.id, r.metadata]));
    const jobs = await Promise.all(
      input.deviceIds.map(async (deviceId) => {
        // Persist the device↔proxy link so the panel can show + change it.
        await prisma.device.update({ where: { id: deviceId }, data: { proxyId: proxy.id } }).catch(() => undefined);
        // Fold the Waydroid instance name so the agent can drive wd-proxy.sh
        // (real country-matched redsocks routing, not the ignored global http_proxy).
        const instance = ((metaById.get(deviceId) ?? {}) as Record<string, unknown>).instance;
        return createJobRecord('EMULATOR_SET_PROXY', {
          deviceId,
          proxyId: proxy.id,
          host: proxy.host,
          port: proxy.port,
          type: proxy.type,
          ...(typeof instance === 'string' ? { instance } : {}),
          ...(proxy.countryCode ? { country: proxy.countryCode } : {}),
          ...(proxy.username ? { username: proxy.username } : {}),
          // passwordEnc is decrypted by agent.service.materializePayload before dispatch.
          ...(proxy.password ? { passwordEnc: proxy.password } : {})
        } as JobPayload, undefined, workspaceId);
      })
    );

    return { updated: input.deviceIds.length, jobIds: jobs.map((j) => j.id) };
  }

  // Stop many devices at once — dedicated helper so callers don't have to know the
  // EMULATOR_STOP job type. Verifies ownership then fans out one stop job each.
  async stopDevices(deviceIds: string[], workspaceId?: string) {
    await assertDevices(deviceIds, workspaceId);
    const jobs = await Promise.all(
      deviceIds.map((deviceId) =>
        createJobRecord('EMULATOR_STOP', { deviceId } as JobPayload, undefined, workspaceId)
      )
    );
    return { stopped: deviceIds.length, jobIds: jobs.map((j) => j.id) };
  }

  // Delete many devices at once. Workspace-scoped atomic deleteMany — devices
  // outside the caller's workspace are never matched (no cross-tenant delete).
  // Returns how many rows were actually removed.
  async deleteDevices(deviceIds: string[], workspaceId?: string) {
    await assertDevices(deviceIds, workspaceId);
    const { count } = await prisma.device.deleteMany({
      where: { id: { in: deviceIds }, ...(workspaceId ? { workspaceId } : {}) }
    });
    return { deleted: count };
  }
}

export const bulkService = new BulkService();
