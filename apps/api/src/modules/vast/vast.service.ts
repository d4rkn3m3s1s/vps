import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, decryptString } from '../../lib/crypto';
import { env } from '../../config/env';
import { generateFingerprintData } from '../fingerprint/fingerprint.service';

const VAST_BASE = 'https://console.vast.ai/api/v0';

// ── API key storage (per-workspace, AES-GCM encrypted) ──────────────────────

export async function setApiKey(workspaceId: string, apiKey: string): Promise<void> {
  await prisma.workspaceSettings.upsert({
    where: { workspaceId },
    update: { vastApiKey: encryptString(apiKey) },
    create: { workspaceId, vastApiKey: encryptString(apiKey) }
  });
}

export async function clearApiKey(workspaceId: string): Promise<void> {
  await prisma.workspaceSettings.updateMany({ where: { workspaceId }, data: { vastApiKey: null } });
}

export async function hasApiKey(workspaceId: string): Promise<boolean> {
  const s = await prisma.workspaceSettings.findUnique({ where: { workspaceId }, select: { vastApiKey: true } });
  return Boolean(s?.vastApiKey);
}

async function getApiKey(workspaceId: string): Promise<string> {
  const s = await prisma.workspaceSettings.findUnique({ where: { workspaceId }, select: { vastApiKey: true } });
  if (!s?.vastApiKey) throw new AppError('Vast.ai is not configured for this workspace', 400, 'VAST_NOT_CONFIGURED');
  return decryptString(s.vastApiKey);
}

// ── REST helper ─────────────────────────────────────────────────────────────

async function vastFetch<T>(workspaceId: string, path: string, init: RequestInit = {}): Promise<T> {
  const key = await getApiKey(workspaceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${VAST_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {})
      }
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = (json as { msg?: string; error?: string })?.msg
        ?? (json as { error?: string })?.error
        ?? `Vast.ai API error (${res.status})`;
      throw new AppError(msg, res.status === 401 ? 401 : 502, 'VAST_API_ERROR');
    }
    return json as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(`Vast.ai request failed: ${message}`, 502, 'VAST_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
}

// ── Offers (search marketplace) ─────────────────────────────────────────────

export type VastOffer = {
  id: number;
  gpuName: string;
  numGpus: number;
  cpuCores: number;
  ramGb: number;
  diskGb: number;
  pricePerHour: number;
  region: string;
  reliability: number;
  cudaVersion: string;
};

type RawOffer = {
  id: number;
  gpu_name?: string;
  num_gpus?: number;
  cpu_cores?: number;
  cpu_ram?: number; // MB
  disk_space?: number;
  dph_total?: number;
  geolocation?: string;
  reliability2?: number;
  cuda_max_good?: number;
};

// Searches available offers. We keep the query simple and rank client-side by
// price; callers can pass a max price and minimum GPU count.
export async function searchOffers(
  workspaceId: string,
  opts: { maxPrice?: number | undefined; minGpus?: number | undefined; query?: string | undefined } = {}
): Promise<VastOffer[]> {
  // Vast's search accepts a query object; we request rentable, verified machines.
  const body = {
    q: {
      rentable: { eq: true },
      ...(opts.minGpus ? { num_gpus: { gte: opts.minGpus } } : {}),
      ...(opts.maxPrice ? { dph_total: { lte: opts.maxPrice } } : {}),
      order: [['dph_total', 'asc']],
      type: 'on-demand',
      limit: 30
    }
  };
  const data = await vastFetch<{ offers?: RawOffer[] }>(workspaceId, '/bundles/', {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  const offers = data.offers ?? [];
  return offers.map((o) => ({
    id: o.id,
    gpuName: o.gpu_name ?? 'Unknown',
    numGpus: o.num_gpus ?? 0,
    cpuCores: o.cpu_cores ?? 0,
    ramGb: o.cpu_ram ? Math.round(o.cpu_ram / 1024) : 0,
    diskGb: o.disk_space ?? 0,
    pricePerHour: o.dph_total ?? 0,
    region: o.geolocation ?? '—',
    reliability: o.reliability2 ?? 0,
    cudaVersion: o.cuda_max_good ? String(o.cuda_max_good) : '—'
  }));
}

// ── Instances (create / list / destroy) ─────────────────────────────────────

// Creates an instance on a chosen offer running the Android emulator image, with
// the ADB port (5555) and web-view port (6080) exposed, then registers it as a
// Host so the rest of the platform can use it. Returns the new Host.
export async function provision(
  workspaceId: string,
  params: { offerId: number; label?: string | undefined; diskGb?: number | undefined; image?: string | undefined }
) {
  const image = params.image ?? env.emulatorImage;
  const body = {
    client_id: 'me',
    image,
    disk: params.diskGb ?? 32,
    label: params.label ?? 'vps-fleet-host',
    runtype: 'ssh',
    // Expose ADB (5555) + the emulator's noVNC web view (6080) to the public IP.
    env: '-p 5555:5555 -p 6080:6080',
    onstart: 'echo "VPS Fleet host booting"; adbd || true'
  };
  const result = await vastFetch<{ success?: boolean; new_contract?: number }>(
    workspaceId,
    `/asks/${params.offerId}/`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  if (!result.new_contract) {
    throw new AppError('Vast.ai did not return an instance id', 502, 'VAST_CREATE_FAILED');
  }
  const instanceId = result.new_contract;

  // Register a Host row in PENDING/OFFLINE state; the host agent (or a later
  // sync) will fill in the real address/ports once the instance is RUNNING.
  const host = await prisma.host.create({
    data: {
      name: params.label ?? `vast-${instanceId}`,
      address: 'pending',
      region: 'vast.ai',
      status: 'OFFLINE',
      provider: 'vast',
      vastInstanceId: String(instanceId),
      workspaceId
    }
  });
  return { host, instanceId };
}

export type VastInstance = {
  id: number;
  status: string;
  gpuName: string;
  pricePerHour: number;
  publicIp: string | null;
  sshHost: string | null;
  sshPort: number | null;
  image: string;
  hostId: string | null;
};

type RawInstance = {
  id: number;
  actual_status?: string;
  cur_state?: string;
  gpu_name?: string;
  dph_total?: number;
  public_ipaddr?: string;
  ssh_host?: string;
  ssh_port?: number;
  image_uuid?: string;
  label?: string;
};

// Lists this workspace's Vast instances, joined to their local Host rows.
export async function listInstances(workspaceId: string): Promise<VastInstance[]> {
  const data = await vastFetch<{ instances?: RawInstance[] }>(workspaceId, '/instances/', { method: 'GET' });
  const instances = data.instances ?? [];
  const hosts = await prisma.host.findMany({
    where: { workspaceId, provider: 'vast' },
    select: { id: true, vastInstanceId: true }
  });
  const hostByInstance = new Map(hosts.map((h) => [h.vastInstanceId, h.id]));
  return instances.map((i) => ({
    id: i.id,
    status: i.actual_status ?? i.cur_state ?? 'unknown',
    gpuName: i.gpu_name ?? '—',
    pricePerHour: i.dph_total ?? 0,
    publicIp: i.public_ipaddr ?? null,
    sshHost: i.ssh_host ?? null,
    sshPort: i.ssh_port ?? null,
    image: i.image_uuid ?? '—',
    hostId: hostByInstance.get(String(i.id)) ?? null
  }));
}

// Destroys a Vast instance and removes its linked Host row.
export async function destroyInstance(workspaceId: string, instanceId: number): Promise<void> {
  await vastFetch(workspaceId, `/instances/${instanceId}/`, { method: 'DELETE' });
  await prisma.host.deleteMany({ where: { workspaceId, provider: 'vast', vastInstanceId: String(instanceId) } });
}

// The ADB port we expose on every provisioned Vast host (see `provision`).
const ADB_PORT = 5555;

function isRunning(status: string): boolean {
  return status.toLowerCase().includes('running');
}

export type SyncResult = {
  checked: number;
  hostsUpdated: number;
  devicesCreated: number;
};

// Reconciles a workspace's Vast instances with local Hosts/Devices:
//  1. When an instance is RUNNING, fills its Host's real address + ONLINE status.
//  2. Auto-registers one cloud-phone Device on a freshly-online host (ADB at
//     publicIp:5555) so the fleet can use it immediately.
//  3. Marks hosts OFFLINE when their instance is no longer running.
// Best-effort and idempotent — safe to run on a timer. Returns counts.
export async function syncInstances(workspaceId: string): Promise<SyncResult> {
  if (!(await hasApiKey(workspaceId))) return { checked: 0, hostsUpdated: 0, devicesCreated: 0 };

  const instances = await listInstances(workspaceId);
  let hostsUpdated = 0;
  let devicesCreated = 0;

  for (const inst of instances) {
    const host = await prisma.host.findFirst({
      where: { workspaceId, provider: 'vast', vastInstanceId: String(inst.id) }
    });
    if (!host) continue;

    const running = isRunning(inst.status);
    const address = inst.publicIp ?? inst.sshHost ?? host.address;

    // Update the host's address/status when something changed.
    const wantStatus = running ? 'ONLINE' : 'OFFLINE';
    if (host.status !== wantStatus || (running && address && host.address !== address)) {
      await prisma.host.update({
        where: { id: host.id },
        data: {
          status: wantStatus,
          ...(running && address ? { address } : {}),
          ...(running ? { lastSeenAt: new Date(), capacity: host.capacity || 1 } : {})
        }
      });
      hostsUpdated += 1;
    }

    // Auto-register a device the first time a host comes online with a real IP.
    if (running && inst.publicIp) {
      const existing = await prisma.device.count({ where: { hostId: host.id } });
      if (existing === 0) {
        await prisma.device.create({
          data: {
            name: `${host.name}-phone-1`,
            status: 'STARTING',
            ipAddress: inst.publicIp,
            adbPort: ADB_PORT,
            host: { connect: { id: host.id } },
            ...(workspaceId ? { workspace: { connect: { id: workspaceId } } } : {}),
            // Born with a randomized fingerprint like any other cloud phone.
            fingerprint: { create: generateFingerprintData({}) }
          }
        });
        devicesCreated += 1;
      }
    }
  }

  return { checked: instances.length, hostsUpdated, devicesCreated };
}

// Runs syncInstances for every workspace that has Vast configured. Used by the
// periodic background tick.
export async function syncAllWorkspaces(): Promise<SyncResult> {
  const configured = await prisma.workspaceSettings.findMany({
    where: { vastApiKey: { not: null } },
    select: { workspaceId: true }
  });
  const totals: SyncResult = { checked: 0, hostsUpdated: 0, devicesCreated: 0 };
  for (const { workspaceId } of configured) {
    try {
      const r = await syncInstances(workspaceId);
      totals.checked += r.checked;
      totals.hostsUpdated += r.hostsUpdated;
      totals.devicesCreated += r.devicesCreated;
    } catch {
      // One workspace's failure (e.g. revoked key) must not stop the others.
    }
  }
  return totals;
}
