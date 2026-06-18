import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { generateFingerprintData } from '../fingerprint/fingerprint.service';
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
  async listDevices(workspaceId?: string) {
    return prisma.device.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { group: true, fingerprint: true, host: true }
    });
  }

  async getDevice(id: string, workspaceId?: string) {
    return prisma.device.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      include: { group: true, fingerprint: true, host: true }
    });
  }

  async createDevice(input: DeviceCreateInput, workspaceId?: string) {
    if (input.groupId) {
      await this.assertGroupExists(input.groupId);
    }

    const data: Prisma.DeviceCreateInput = { name: input.name };
    if (input.ipAddress) data.ipAddress = input.ipAddress;
    if (typeof input.adbPort === 'number') data.adbPort = input.adbPort;
    if (input.androidVersion) data.androidVersion = input.androidVersion;
    if (input.groupId) data.group = { connect: { id: input.groupId } };
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

    return prisma.device.create({
      data,
      include: { group: true, fingerprint: true }
    });
  }

  async updateDevice(id: string, input: DeviceUpdateInput) {
    await this.assertDeviceExists(id);
    if (input.groupId) {
      await this.assertGroupExists(input.groupId);
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
      await this.assertHostExists(input.hostId);
      data.host = { connect: { id: input.hostId } };
    }
    const metadata = buildJsonMetadata(input.metadata);
    if (metadata !== undefined) data.metadata = metadata;
    const lastSeen = toDate(input.lastSeen);
    if (lastSeen) data.lastSeen = lastSeen;

    return prisma.device.update({
      where: { id },
      data,
      include: { group: true, host: true }
    });
  }

  async heartbeat(id: string, input: DeviceHeartbeatInput) {
    await this.assertDeviceExists(id);
    return prisma.device.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(typeof input.cpuUsage === 'number' ? { cpuUsage: input.cpuUsage } : {}),
        ...(typeof input.memoryUsage === 'number' ? { memoryUsage: input.memoryUsage } : {}),
        ...(typeof input.diskUsage === 'number' ? { diskUsage: input.diskUsage } : {}),
        lastSeen: toDate(input.lastSeen) ?? new Date()
      },
      include: { group: true }
    });
  }

  async deleteDevice(id: string) {
    await this.assertDeviceExists(id);
    return prisma.device.delete({ where: { id } });
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

  async updateGroup(id: string, input: DeviceGroupUpdateInput) {
    await this.assertGroupExists(id);
    return prisma.deviceGroup.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description === null ? { description: null } : input.description ? { description: input.description } : {})
      },
      include: { devices: true }
    });
  }

  async deleteGroup(id: string) {
    await this.assertGroupExists(id);
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

  private async assertDeviceExists(id: string): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }

  private async assertGroupExists(id: string): Promise<void> {
    const group = await prisma.deviceGroup.findUnique({ where: { id } });
    if (!group) throw new AppError('Device group not found', 404, 'DEVICE_GROUP_NOT_FOUND');
  }

  private async assertHostExists(id: string): Promise<void> {
    const host = await prisma.host.findUnique({ where: { id } });
    if (!host) throw new AppError('Host not found', 404, 'HOST_NOT_FOUND');
  }
}
