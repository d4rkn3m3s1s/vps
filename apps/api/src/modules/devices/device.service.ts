import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { generateFingerprintData, decryptFingerprint } from '../fingerprint/fingerprint.service';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { usageService } from '../usage/usage.service';
import type {
  DeviceCreateInput,
  DeviceGroupCreateInput,
  DeviceGroupUpdateInput,
  DeviceHeartbeatInput,
  DeviceUpdateInput
} from './device.types';

function buildJsonMetadata(metadata: unknown): Prisma.InputJsonValue | undefined {
  return metadata === undefined ? undefined : (metadata as Prisma.InputJsonValue);
}

function toDate(value?: string | Date): Date | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(value);
}

export class DeviceService {
  // All reads/writes accept an optional workspaceId. When provided (every
  // interactive call), results are strictly scoped to that workspace so one
  // tenant can never see or touch another's devices.
  async listDevices(workspaceId?: string, tag?: string, search?: string) {
    const t = tag?.trim().toLowerCase();
    const q = search?.trim();
    const devices = await prisma.device.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        ...(t ? { tags: { has: t } } : {}),
        // Free-text search over the device name (case-insensitive). Lets the
        // dashboard/API filter a large fleet by name instead of only by tag.
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {})
      },
      orderBy: { createdAt: 'desc' },
      include: { group: true, fingerprint: true, host: true }
    });
    // Decrypt each fingerprint's identity fields so the profiles list + the
    // fingerprint modal show real IMEI/MAC/serial/androidId/phone, not ciphertext.
    for (const d of devices) if (d.fingerprint) d.fingerprint = decryptFingerprint(d.fingerprint);
    return devices;
  }

  async getDevice(id: string, workspaceId?: string) {
    const device = await prisma.device.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      include: { group: true, fingerprint: true, host: true }
    });
    // Decrypt the eager-loaded fingerprint's identity fields (IMEI/MAC/serial/
    // androidId/phone) so the detail panel shows real values, not ciphertext.
    if (device?.fingerprint) device.fingerprint = decryptFingerprint(device.fingerprint);
    return device;
  }

  // Recent CPU/mem/disk timeseries for one device (workspace-scoped). `hours`
  // bounds the window; points come back oldest-first ready to plot. Returns []
  // for an unknown/foreign device rather than leaking existence.
  async getMetrics(id: string, hours = 6, workspaceId?: string) {
    const device = await prisma.device.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true }
    });
    if (!device) return [];
    const since = new Date(Date.now() - Math.min(Math.max(1, hours), 168) * 60 * 60 * 1000);
    const points = await prisma.deviceMetricPoint.findMany({
      where: { deviceId: id, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      take: 2000,
      select: { cpuUsage: true, memoryUsage: true, diskUsage: true, capturedAt: true }
    });
    return points.map((p) => ({
      t: p.capturedAt.toISOString(),
      cpu: Math.round(p.cpuUsage * 10) / 10,
      mem: Math.round(p.memoryUsage * 10) / 10,
      disk: Math.round(p.diskUsage * 10) / 10
    }));
  }

  async createDevice(input: DeviceCreateInput, workspaceId?: string, tx?: Prisma.TransactionClient) {
    // Run inside the caller's transaction when provided (e.g. provisioning holds
    // a per-host advisory lock so concurrent one-click provisions can't allocate
    // the same instance name/subnet). Falls back to the global client otherwise.
    const db = tx ?? prisma;
    if (input.groupId) {
      await this.assertGroupExists(input.groupId, workspaceId);
    }
    // Tenant guard: a client-supplied hostId must belong to the caller's
    // workspace, otherwise a device could be placed onto another tenant's host
    // (and its jobs would dispatch to the victim's agent). Mirrors the groupId
    // check above and updateDevice's assertHostExists.
    if (input.hostId) {
      await this.assertHostExists(input.hostId, workspaceId);
    }

    const data: Prisma.DeviceCreateInput = { name: input.name };
    if (input.ipAddress) data.ipAddress = input.ipAddress;
    if (typeof input.adbPort === 'number') data.adbPort = input.adbPort;
    if (input.androidVersion) data.androidVersion = input.androidVersion;
    if (input.groupId) data.group = { connect: { id: input.groupId } };
    if (input.hostId) data.host = { connect: { id: input.hostId } };
    if (workspaceId) data.workspace = { connect: { id: workspaceId } };
    // Fold any chosen hardware tier into metadata so it's visible on the device.
    const baseMeta = buildJsonMetadata(input.metadata);
    const hw: Record<string, unknown> = {};
    if (typeof input.ramGb === 'number') hw.ramGb = input.ramGb;
    if (typeof input.cpuCores === 'number') hw.cpuCores = input.cpuCores;
    if (input.deviceModel) hw.provisionedModel = input.deviceModel;
    const mergedMeta =
      Object.keys(hw).length > 0
        ? ({ ...(baseMeta && typeof baseMeta === 'object' ? (baseMeta as object) : {}), ...hw } as Prisma.InputJsonValue)
        : baseMeta;
    if (mergedMeta !== undefined) data.metadata = mergedMeta;

    // Every cloud phone is born with a unique randomized fingerprint so it looks
    // like a distinct physical device. Country, model, and Android version can
    // be pinned at creation (provisioning catalog); otherwise randomized.
    data.fingerprint = {
      create: generateFingerprintData({
        countryCode: input.countryCode,
        ...(input.deviceModel ? { model: input.deviceModel } : {}),
        ...(input.androidVersion ? { osVersion: input.androidVersion } : {})
      })
    };

    return db.device.create({
      data,
      include: { group: true, fingerprint: true }
    });
  }

  // Quick profile — Multilogin-style one-call provisioning: spin up a disposable
  // cloud phone with a fresh randomized fingerprint in a single request (name is
  // auto-generated), tag it `quick` in metadata so it can be reaped later, and
  // optionally dispatch a start job. Built on top of createDevice so it inherits
  // the same fingerprint generation.
  async quickProfile(
    input: {
      countryCode?: string | undefined; deviceModel?: string | undefined; androidVersion?: string | undefined;
      ramGb?: number | undefined; cpuCores?: number | undefined; autoStart?: boolean | undefined;
    },
    workspaceId?: string
  ) {
    const stamp = randomBytes(3).toString('hex');
    const created = await this.createDevice(
      {
        name: `quick-${stamp}`,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
        ...(input.androidVersion ? { androidVersion: input.androidVersion } : {}),
        ...(typeof input.ramGb === 'number' ? { ramGb: input.ramGb } : {}),
        ...(typeof input.cpuCores === 'number' ? { cpuCores: input.cpuCores } : {}),
        metadata: { quick: true }
      } as DeviceCreateInput,
      workspaceId
    );

    let job = null;
    if (input.autoStart) {
      job = await createJobRecord('EMULATOR_START', {} as unknown as JobPayload, created.id, workspaceId);
      await prisma.device.update({ where: { id: created.id }, data: { status: 'STARTING' } });
    }
    return { device: created, ...(job ? { job } : {}) };
  }

  async updateDevice(id: string, input: DeviceUpdateInput, workspaceId?: string) {
    // Workspace-scoped: a tenant must not rename/move/reassign another tenant's
    // device by id (e.g. reattach it to an attacker-controlled host).
    const dev = await prisma.device.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!dev) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    if (input.groupId) {
      await this.assertGroupExists(input.groupId, workspaceId);
    }

    const data: Prisma.DeviceUpdateInput = {};
    if (input.name) data.name = input.name;
    if (input.status) data.status = input.status;
    if (input.ipAddress) data.ipAddress = input.ipAddress;
    if (typeof input.adbPort === 'number') data.adbPort = input.adbPort;
    if (input.androidVersion) data.androidVersion = input.androidVersion;
    if (typeof input.cpuUsage === 'number') data.cpuUsage = input.cpuUsage;
    if (typeof input.memoryUsage === 'number') data.memoryUsage = input.memoryUsage;
    if (typeof input.diskUsage === 'number') data.diskUsage = input.diskUsage;
    if (input.groupId === null) {
      data.group = { disconnect: true };
    } else if (input.groupId) {
      data.group = { connect: { id: input.groupId } };
    }
    if (input.hostId === null) {
      data.host = { disconnect: true };
    } else if (input.hostId) {
      await this.assertHostExists(input.hostId, workspaceId);
      data.host = { connect: { id: input.hostId } };
    }
    const metadata = buildJsonMetadata(input.metadata);
    if (metadata !== undefined) data.metadata = metadata;
    if (input.tags !== undefined) {
      // Normalize: trim, drop blanks, lowercase, dedupe, cap count + length.
      data.tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).map((t) => t.slice(0, 32)))].slice(0, 20);
    }
    const lastSeen = toDate(input.lastSeen);
    if (lastSeen) data.lastSeen = lastSeen;

    return prisma.device.update({
      where: { id },
      data,
      include: { group: true, host: true }
    });
  }

  // Wake / sleep / reboot a Waydroid instance FOR REAL (EMULATOR_START only ack'd
  // it host-side). Writes a DEVICE_WAKE / DEVICE_SLEEP job carrying the instance
  // name from metadata; the agent runs wd-run.sh / wd-stop.sh. On completion the
  // agent.service marks the device ONLINE/OFFLINE from the job result.
  private async instanceOf(id: string, workspaceId?: string): Promise<{ device: { id: string; hostId: string | null }; instance: string }> {
    const device = await prisma.device.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, hostId: true, metadata: true }
    });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    if (!device.hostId) throw new AppError('Device is not bound to a host', 409, 'DEVICE_NO_HOST');
    const meta = (device.metadata ?? {}) as Record<string, unknown>;
    const instance = typeof meta.instance === 'string' ? meta.instance : '';
    if (!instance) throw new AppError('Device has no Waydroid instance to control', 409, 'DEVICE_NO_INSTANCE');
    return { device: { id: device.id, hostId: device.hostId }, instance };
  }

  async wake(id: string, workspaceId?: string) {
    const { instance } = await this.instanceOf(id, workspaceId);
    const job = await createJobRecord('DEVICE_WAKE', { deviceId: id, instance } as JobPayload, id, workspaceId);
    await prisma.device.update({ where: { id }, data: { status: 'STARTING' } });
    return { jobId: job.id, deviceId: id, instance };
  }

  async sleep(id: string, workspaceId?: string) {
    const { instance } = await this.instanceOf(id, workspaceId);
    const job = await createJobRecord('DEVICE_SLEEP', { deviceId: id, instance } as JobPayload, id, workspaceId);
    await prisma.device.update({ where: { id }, data: { status: 'STOPPING' } });
    return { jobId: job.id, deviceId: id, instance };
  }

  async reboot(id: string, workspaceId?: string) {
    const { instance } = await this.instanceOf(id, workspaceId);
    // Reboot = sleep then wake, chained by the agent as two jobs. We enqueue SLEEP
    // then WAKE; the agent processes them in order (sleep completes, then wake).
    await createJobRecord('DEVICE_SLEEP', { deviceId: id, instance } as JobPayload, id, workspaceId);
    const wake = await createJobRecord('DEVICE_WAKE', { deviceId: id, instance } as JobPayload, id, workspaceId);
    await prisma.device.update({ where: { id }, data: { status: 'REBOOTING' } });
    return { jobId: wake.id, deviceId: id, instance };
  }

  async heartbeat(id: string, input: DeviceHeartbeatInput) {
    // Read prior lastSeen/status/workspace so we can meter online minutes before
    // overwriting lastSeen.
    const prev = await prisma.device.findUnique({
      where: { id },
      select: { lastSeen: true, status: true, workspaceId: true }
    });
    if (!prev) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    const now = toDate(input.lastSeen) ?? new Date();

    const updated = await prisma.device.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(typeof input.cpuUsage === 'number' ? { cpuUsage: input.cpuUsage } : {}),
        ...(typeof input.memoryUsage === 'number' ? { memoryUsage: input.memoryUsage } : {}),
        ...(typeof input.diskUsage === 'number' ? { diskUsage: input.diskUsage } : {}),
        lastSeen: now
      },
      include: { group: true }
    });

    // Meter usage only while the device is (and was) effectively online.
    const effectiveStatus = input.status ?? prev.status;
    if (effectiveStatus === 'ONLINE') {
      void usageService.accrue(id, prev.lastSeen, now, prev.workspaceId ?? undefined);
    }
    return updated;
  }

  async deleteDevice(id: string, workspaceId?: string) {
    // Workspace-scoped, atomic delete: a device outside the caller's workspace is
    // never matched (no cross-tenant delete, no TOCTOU window).
    const { count } = await prisma.device.deleteMany({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (count === 0) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    return { id };
  }

  async createGroup(input: DeviceGroupCreateInput, workspaceId?: string) {
    return prisma.deviceGroup.create({
      data: {
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(workspaceId ? { workspaceId } : {})
      },
      include: { devices: true }
    });
  }

  async updateGroup(id: string, input: DeviceGroupUpdateInput, workspaceId?: string) {
    const group = await prisma.deviceGroup.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!group) throw new AppError('Device group not found', 404, 'DEVICE_GROUP_NOT_FOUND');
    return prisma.deviceGroup.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description === null ? { description: null } : input.description ? { description: input.description } : {})
      },
      include: { devices: true }
    });
  }

  async deleteGroup(id: string, workspaceId?: string) {
    const group = await prisma.deviceGroup.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!group) throw new AppError('Device group not found', 404, 'DEVICE_GROUP_NOT_FOUND');
    return prisma.deviceGroup.delete({ where: { id } });
  }

  async countByStatus(workspaceId?: string) {
    const ws = workspaceId ? { workspaceId } : {};
    const [online, offline, starting, stopping, error, updating, rebooting, total] = await Promise.all([
      prisma.device.count({ where: { ...ws, status: 'ONLINE' } }),
      prisma.device.count({ where: { ...ws, status: 'OFFLINE' } }),
      prisma.device.count({ where: { ...ws, status: 'STARTING' } }),
      prisma.device.count({ where: { ...ws, status: 'STOPPING' } }),
      prisma.device.count({ where: { ...ws, status: 'ERROR' } }),
      prisma.device.count({ where: { ...ws, status: 'UPDATING' } }),
      prisma.device.count({ where: { ...ws, status: 'REBOOTING' } }),
      prisma.device.count({ where: { ...ws } })
    ]);

    return { online, offline, starting, stopping, error, updating, rebooting, total };
  }

  async listGroups(workspaceId?: string) {
    return prisma.deviceGroup.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { devices: true }
    });
  }

  // Group/host existence checks are workspace-scoped so a device can't be attached
  // to ANOTHER tenant's group or host by id. (assertDeviceExists is unused now that
  // delete/update scope inline, but kept scoped for safety if reused.)
  private async assertDeviceExists(id: string, workspaceId?: string): Promise<void> {
    const device = await prisma.device.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }

  private async assertGroupExists(id: string, workspaceId?: string): Promise<void> {
    const group = await prisma.deviceGroup.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!group) throw new AppError('Device group not found', 404, 'DEVICE_GROUP_NOT_FOUND');
  }

  private async assertHostExists(id: string, workspaceId?: string): Promise<void> {
    const host = await prisma.host.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!host) throw new AppError('Host not found', 404, 'HOST_NOT_FOUND');
  }
}
