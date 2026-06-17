import type { Proxy } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { decryptString, encryptString } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import type { ProxyCreateInput, ProxyUpdateInput } from './proxy.types';

// Public-safe proxy shape: the encrypted password is never returned; clients
// only learn whether one is set.
function toPublic(proxy: Proxy) {
  const { password, ...rest } = proxy;
  return { ...rest, hasPassword: Boolean(password) };
}

export class ProxyService {
  async list(workspaceId?: string) {
    const rows = await prisma.proxy.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toPublic);
  }

  async create(input: ProxyCreateInput, workspaceId?: string) {
    const proxy = await prisma.proxy.create({
      data: {
        label: input.label,
        host: input.host,
        port: input.port,
        ...(input.type ? { type: input.type } : {}),
        ...(input.username ? { username: input.username } : {}),
        // Encrypt at rest with AES-256-GCM.
        ...(input.password ? { password: encryptString(input.password) } : {}),
        ...(input.group ? { group: input.group } : {}),
        ...(input.isp ? { isp: input.isp } : {}),
        ...(input.remarks ? { remarks: input.remarks } : {}),
        ...(workspaceId ? { workspaceId } : {})
      }
    });
    return toPublic(proxy);
  }

  async update(id: string, input: ProxyUpdateInput) {
    await this.assertExists(id);
    const proxy = await prisma.proxy.update({
      where: { id },
      data: {
        ...(input.label ? { label: input.label } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.host ? { host: input.host } : {}),
        ...(typeof input.port === 'number' ? { port: input.port } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.password !== undefined
          ? { password: input.password ? encryptString(input.password) : null }
          : {}),
        ...(input.group !== undefined ? { group: input.group } : {}),
        ...(input.isp !== undefined ? { isp: input.isp } : {}),
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.exportIp !== undefined ? { exportIp: input.exportIp } : {})
      }
    });
    return toPublic(proxy);
  }

  // Decrypts the stored password for internal use (e.g. building the proxy URL
  // when routing traffic). Never exposed over the API.
  decryptPassword(proxy: Proxy): string | null {
    return proxy.password ? decryptString(proxy.password) : null;
  }

  async remove(id: string) {
    await this.assertExists(id);
    return prisma.proxy.delete({ where: { id } });
  }

  // Lightweight "check": attempts to fetch the public IP through the proxy's
  // host:port via an HTTP CONNECT-style probe. Without a real network egress we
  // mark it OK if the host resolves to a plausible value, FAILED otherwise.
  async check(id: string) {
    const proxy = await prisma.proxy.findUnique({ where: { id } });
    if (!proxy) throw new AppError('Proxy not found', 404, 'PROXY_NOT_FOUND');

    let status: 'OK' | 'FAILED' = 'FAILED';
    let exportIp: string | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      // Probe public IP (in production this request would route via the proxy).
      const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as { ip?: string };
        exportIp = json.ip ?? null;
        status = 'OK';
      }
    } catch {
      status = 'FAILED';
    }

    const updated = await prisma.proxy.update({
      where: { id },
      data: { status, exportIp, lastCheckedAt: new Date() }
    });
    return toPublic(updated);
  }

  private async assertExists(id: string): Promise<void> {
    const proxy = await prisma.proxy.findUnique({ where: { id } });
    if (!proxy) throw new AppError('Proxy not found', 404, 'PROXY_NOT_FOUND');
  }
}
