// Cloud-phone providers service.
//
// Manages external cloud-phone vendor accounts (CloudPhoneProvider) and drives
// phone lifecycle/control through the vendor-agnostic adapter layer. Rented phones
// surface as ordinary Device rows (cloudProvider != null) so every existing panel
// feature (groups, fingerprints, RPA targeting, wall, …) treats them uniformly.
//
// Secrets are AES-256-GCM encrypted at rest and never returned to clients.

import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, decryptString } from '../../lib/crypto';
import { getAdapter, isImplemented } from './adapters/registry';
import type { CloudProviderAdapter, ProviderCreds, ProxyConfig } from './adapters/types';

type Kind = 'SELF' | 'GEELARK' | 'VMOS' | 'DUOPLUS' | 'UGPHONE';

export type ProviderCreateInput = {
  name: string;
  kind: Kind;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
};

// Strip secrets from any provider row before returning to a client. Preserves the
// non-secret fields (id, name, kind, …) and adds boolean has-secret flags.
function toPublic<T extends { id: string; apiKeyEnc: string | null; apiSecretEnc: string | null }>(p: T) {
  const { apiKeyEnc, apiSecretEnc, ...rest } = p;
  return { ...rest, hasApiKey: Boolean(apiKeyEnc), hasApiSecret: Boolean(apiSecretEnc) };
}

function credsFor(p: { baseUrl: string | null; apiKeyEnc: string | null; apiSecretEnc: string | null }): ProviderCreds {
  return {
    ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
    ...(p.apiKeyEnc ? { apiKey: decryptString(p.apiKeyEnc) } : {}),
    ...(p.apiSecretEnc ? { apiSecret: decryptString(p.apiSecretEnc) } : {})
  };
}

export class CloudProvidersService {
  async list(workspaceId?: string) {
    const rows = await prisma.cloudPhoneProvider.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toPublic);
  }

  async create(input: ProviderCreateInput, workspaceId?: string) {
    if (input.kind !== 'SELF' && !isImplemented(input.kind)) {
      // Allow saving the credentials, but warn the operator the adapter is pending.
    }
    const row = await prisma.cloudPhoneProvider.create({
      data: {
        name: input.name,
        kind: input.kind,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        ...(input.apiKey ? { apiKeyEnc: encryptString(input.apiKey) } : {}),
        ...(input.apiSecret ? { apiSecretEnc: encryptString(input.apiSecret) } : {}),
        ...(workspaceId ? { workspace: { connect: { id: workspaceId } } } : {})
      }
    });
    return toPublic(row);
  }

  async update(
    id: string,
    input: {
      name?: string | undefined;
      baseUrl?: string | undefined;
      apiKey?: string | undefined;
      apiSecret?: string | undefined;
      enabled?: boolean | undefined;
    },
    workspaceId?: string
  ) {
    await this.get(id, workspaceId);
    const row = await prisma.cloudPhoneProvider.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl || null } : {}),
        ...(input.apiKey ? { apiKeyEnc: encryptString(input.apiKey) } : {}),
        ...(input.apiSecret ? { apiSecretEnc: encryptString(input.apiSecret) } : {}),
        ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {})
      }
    });
    return toPublic(row);
  }

  async remove(id: string, workspaceId?: string) {
    await this.get(id, workspaceId);
    // Detach any devices that came from this provider (keep the rows; mark orphan).
    await prisma.device.updateMany({ where: { cloudProviderId: id }, data: { cloudProviderId: null } });
    await prisma.cloudPhoneProvider.delete({ where: { id } });
    return { deleted: true };
  }

  // Run a connectivity check and persist the result for the admin page.
  async check(id: string, workspaceId?: string) {
    const row = await this.getRow(id, workspaceId);
    const adapter = this.adapterFor(row);
    const result = await adapter.check().catch((e) => ({ ok: false, detail: (e as Error).message }));
    await prisma.cloudPhoneProvider.update({
      where: { id },
      data: { lastCheckAt: new Date(), lastCheckOk: result.ok, lastCheckMsg: result.detail.slice(0, 300) }
    });
    return result;
  }

  // ── Phone operations (provider → Device row sync) ──────────────────────────

  // Pull the vendor's current phone list and upsert each as a Device row so the
  // whole panel can manage them. Returns how many were imported/updated.
  async syncPhones(id: string, workspaceId?: string) {
    const row = await this.getRow(id, workspaceId);
    const adapter = this.adapterFor(row);
    const phones = await adapter.listPhones();
    let upserted = 0;
    for (const p of phones) {
      const existing = await prisma.device.findFirst({
        where: { cloudProviderId: id, externalId: p.externalId, ...(workspaceId ? { workspaceId } : {}) },
        select: { id: true }
      });
      const data = {
        name: p.name,
        status: p.status === 'UNKNOWN' ? ('OFFLINE' as const) : p.status,
        ...(p.androidVersion ? { androidVersion: p.androidVersion } : {})
      };
      if (existing) {
        await prisma.device.update({ where: { id: existing.id }, data });
      } else {
        await prisma.device.create({
          data: {
            ...data,
            cloudProvider: row.kind,
            cloudProviderId: id,
            externalId: p.externalId,
            ...(workspaceId ? { workspace: { connect: { id: workspaceId } } } : {})
          }
        });
      }
      upserted += 1;
    }
    return { imported: upserted };
  }

  // Create a new phone at the vendor and mirror it as a Device row.
  async createPhone(id: string, name: string, workspaceId?: string) {
    const row = await this.getRow(id, workspaceId);
    const adapter = this.adapterFor(row);
    const phone = await adapter.createPhone({ name });
    const device = await prisma.device.create({
      data: {
        name: phone.name,
        status: 'STARTING',
        cloudProvider: row.kind,
        cloudProviderId: id,
        externalId: phone.externalId,
        ...(workspaceId ? { workspace: { connect: { id: workspaceId } } } : {})
      }
    });
    return device;
  }

  // Lifecycle/control by OUR device id — resolves the device's provider + externalId.
  async deviceAction(
    deviceId: string,
    action: 'start' | 'stop' | 'reboot' | 'delete',
    workspaceId?: string
  ) {
    const { adapter, externalId } = await this.resolveDevice(deviceId, workspaceId);
    if (action === 'start') await adapter.startPhone(externalId);
    else if (action === 'stop') await adapter.stopPhone(externalId);
    else if (action === 'reboot') await adapter.rebootPhone(externalId);
    else if (action === 'delete') {
      await adapter.deletePhone(externalId);
      await prisma.device.delete({ where: { id: deviceId } }).catch(() => undefined);
    }
    return { ok: true };
  }

  async deviceShell(deviceId: string, command: string, workspaceId?: string) {
    const { adapter, externalId } = await this.resolveDevice(deviceId, workspaceId);
    return adapter.runShell(externalId, command);
  }

  async deviceSetProxy(deviceId: string, proxy: ProxyConfig | null, workspaceId?: string) {
    const { adapter, externalId } = await this.resolveDevice(deviceId, workspaceId);
    await adapter.setProxy(externalId, proxy);
    return { ok: true };
  }

  async deviceScreenshot(deviceId: string, workspaceId?: string) {
    const { adapter, externalId } = await this.resolveDevice(deviceId, workspaceId);
    return adapter.screenshot(externalId);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private adapterFor(row: { kind: string; baseUrl: string | null; apiKeyEnc: string | null; apiSecretEnc: string | null }): CloudProviderAdapter {
    return getAdapter(row.kind, credsFor(row));
  }

  private async resolveDevice(deviceId: string, workspaceId?: string): Promise<{ adapter: CloudProviderAdapter; externalId: string }> {
    const device = await prisma.device.findFirst({
      where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
      select: { externalId: true, cloudProviderId: true }
    });
    if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    if (!device.cloudProviderId || !device.externalId) {
      throw new AppError('Bu cihaz bir bulut sağlayıcısına bağlı değil (SELF fleet).', 400, 'NOT_CLOUD_DEVICE');
    }
    const row = await this.getRow(device.cloudProviderId, workspaceId);
    return { adapter: this.adapterFor(row), externalId: device.externalId };
  }

  private async get(id: string, workspaceId?: string) {
    const row = await this.getRow(id, workspaceId);
    return toPublic(row);
  }

  private async getRow(id: string, workspaceId?: string) {
    const row = await prisma.cloudPhoneProvider.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) }
    });
    if (!row) throw new AppError('Sağlayıcı bulunamadı', 404, 'PROVIDER_NOT_FOUND');
    return row;
  }
}

export const cloudProvidersService = new CloudProvidersService();
