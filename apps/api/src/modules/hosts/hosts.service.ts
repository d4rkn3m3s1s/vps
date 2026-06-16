import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

export type HostCreateInput = {
  name: string;
  address: string;
  region?: string | undefined;
  capacity?: number | undefined;
  cpuCores?: number | undefined;
  memoryGb?: number | undefined;
  kvm?: boolean | undefined;
};

export type HostHeartbeatInput = {
  status?: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | undefined;
  runningPhones?: number | undefined;
  capacity?: number | undefined;
};

// Hide the agent key hash from API responses.
function toPublic<T extends { agentKeyHash: string | null }>(host: T) {
  const { agentKeyHash, ...rest } = host;
  return { ...rest, hasAgentKey: Boolean(agentKeyHash) };
}

export class HostsService {
  async list() {
    const rows = await prisma.host.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toPublic);
  }

  // Registers a host and returns a one-time agent key (shown once) the host
  // agent uses to authenticate heartbeats.
  async create(input: HostCreateInput) {
    const agentKey = `host_${sha256(input.name + input.address + Date.now()).slice(0, 32)}`;
    const data: Prisma.HostCreateInput = {
      name: input.name,
      address: input.address,
      agentKeyHash: sha256(agentKey),
      ...(input.region ? { region: input.region } : {}),
      ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {}),
      ...(typeof input.cpuCores === 'number' ? { cpuCores: input.cpuCores } : {}),
      ...(typeof input.memoryGb === 'number' ? { memoryGb: input.memoryGb } : {}),
      ...(typeof input.kvm === 'boolean' ? { kvm: input.kvm } : {})
    };
    const host = await prisma.host.create({ data });
    return { ...toPublic(host), agentKey };
  }

  async heartbeat(id: string, input: HostHeartbeatInput) {
    await this.assertExists(id);
    const host = await prisma.host.update({
      where: { id },
      data: {
        status: input.status ?? 'ONLINE',
        ...(typeof input.runningPhones === 'number' ? { runningPhones: input.runningPhones } : {}),
        ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {}),
        lastSeenAt: new Date()
      }
    });
    return toPublic(host);
  }

  async remove(id: string) {
    await this.assertExists(id);
    return prisma.host.delete({ where: { id } });
  }

  private async assertExists(id: string): Promise<void> {
    const host = await prisma.host.findUnique({ where: { id } });
    if (!host) throw new AppError('Host not found', 404, 'HOST_NOT_FOUND');
  }
}

export const hostsService = new HostsService();
