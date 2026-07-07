import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import { deviceHub } from '../devices/device.hub';
import { DeviceService } from '../devices/device.service';
import { fingerprintService } from '../fingerprint/fingerprint.service';

const deviceService = new DeviceService();

// ── One-click device provisioning ("Tek Tıkla Cihaz Oluştur") ───────────────
//
// Operator clicks once → the API creates a brand-new host-bound Device row and
// writes a single PROVISION_DEVICE job. The KVM host agent then builds a fully
// isolated Waydroid instance FROM SCRATCH (binderfs + bridge + userdata clone),
// boots it, and brings it to "WhatsApp-ready" (root + vtouch + unique identity
// spoof + route + optional country-matched proxy + APKs + a11y + screen). The
// agent reports each sub-step via /agent/jobs/:id/progress; we normalize it to a
// `provision.progress` WS event so the dashboard renders a live wizard.
//
// Scope ENDS at "WhatsApp-ready" — number/OTP registration is out of scope.

export type ProvisionStepKey =
  | 'queued'
  | 'infra'
  | 'boot'
  | 'root'
  | 'screen'
  | 'vtouch'
  | 'route'
  | 'proxy'
  | 'apks'
  | 'a11y'
  | 'persist'
  | 'done';

export type ProvisionStep = { key: ProvisionStepKey; label: string; percent: number };

// Step plan + target percentages. The agent reports with these `step` keys; the
// API broadcasts with the agent's percent when present, else this fallback.
export const PROVISION_STEPS: ProvisionStep[] = [
  { key: 'queued', label: 'Kuyruğa alındı', percent: 3 },
  { key: 'infra', label: 'İzole altyapı kuruluyor', percent: 12 },
  { key: 'boot', label: 'Cihaz açılışı bekleniyor', percent: 22 },
  { key: 'root', label: 'Root / Magisk kuruluyor', percent: 38 },
  { key: 'screen', label: 'Ekran ayarları', percent: 47 },
  { key: 'vtouch', label: 'Gerçek dokunma + benzersiz kimlik', percent: 60 },
  { key: 'route', label: 'Ağ yönlendirme', percent: 68 },
  { key: 'proxy', label: 'Proxy (ülke eşleşmeli)', percent: 76 },
  { key: 'apks', label: 'Uygulamalar kuruluyor', percent: 86 },
  { key: 'a11y', label: 'Erişilebilirlik + klavye', percent: 93 },
  { key: 'persist', label: 'Kalıcılık doğrulanıyor', percent: 97 },
  { key: 'done', label: 'Kurulum tamamlandı (WhatsApp-hazır)', percent: 100 }
];

export type ProvisionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ProvisionProgress = {
  deviceId: string;
  jobId: string;
  step: ProvisionStepKey;
  label: string;
  percent: number;
  status: ProvisionStatus;
  note?: string | undefined;
};

export type CreateInstanceInput = {
  name?: string | undefined;
  countryCode?: string | undefined;
  deviceModel?: string | undefined;
  androidVersion?: string | undefined;
  // Country-matched residential proxy (WhatsApp needs number-country == exit-IP).
  proxyCountry?: string | undefined;
};

// thordata residential proxy (proven). Credentials come from env so they aren't
// baked into the repo; the username country suffix is appended host-side.
const PROXY_HOST = process.env.FLEET_PROXY_HOST || '';
const PROXY_PORT = Number(process.env.FLEET_PROXY_PORT || 9999);
const PROXY_USER = process.env.FLEET_PROXY_USER || '';
const PROXY_PASS = process.env.FLEET_PROXY_PASS || '';

function stepFor(key: string): ProvisionStep {
  return PROVISION_STEPS.find((s) => s.key === key) ?? PROVISION_STEPS[0]!;
}

// Third octet of a Waydroid instance's subnet, matching the host's net-head.sh:
// md5(name) -> 192.168.<241..256>.x. Used to avoid subnet collisions with the
// existing instances when picking the next instance name.
function subnetIdFor(instance: string): number {
  const hex = createHash('md5').update(instance).digest('hex').slice(0, 8);
  return (parseInt(hex, 16) % 16) + 241;
}

class ProvisionService {
  steps(): ProvisionStep[] {
    return PROVISION_STEPS;
  }

  // Pick the next free instance name for a host. Deterministic names (mi4, mi5…)
  // can collide on subnet (net-head.sh is md5-based), so we skip any name whose
  // subnet is already taken by another instance on this host or by a reserved one.
  private async nextInstanceName(hostId: string): Promise<string> {
    const prefix = process.env.FLEET_WD_PREFIX || 'mi';
    const devices = await prisma.device.findMany({
      where: { hostId },
      select: { metadata: true }
    });
    const usedNames = new Set<string>();
    const usedSubnets = new Set<number>([240]); // 240 = default instance (#1)
    for (const d of devices) {
      const meta = (d.metadata ?? {}) as Record<string, unknown>;
      const inst = typeof meta.instance === 'string' ? meta.instance : null;
      if (inst) {
        usedNames.add(inst);
        usedSubnets.add(subnetIdFor(inst));
      }
    }
    // The bootstrap instances the fleet was built on (not always in DB).
    for (const seed of ['work', 'mi3']) usedSubnets.add(subnetIdFor(seed));

    for (let n = 2; n < 200; n++) {
      const name = `${prefix}${n}`;
      if (usedNames.has(name)) continue;
      const sub = subnetIdFor(name);
      if (sub > 254) continue; // invalid /24 host range
      if (usedSubnets.has(sub)) continue;
      return name;
    }
    throw new AppError('No free instance slot on this host', 409, 'NO_INSTANCE_SLOT');
  }

  // Create a brand-new instance: pick a host, allocate an instance name, create a
  // host-bound Device (with a unique fingerprint), decrypt that fingerprint into
  // the job payload (the agent can't decrypt), and write the PROVISION_DEVICE job.
  async createInstance(
    input: CreateInstanceInput,
    workspaceId?: string
  ): Promise<{ jobId: string; deviceId: string; instance: string; steps: ProvisionStep[] }> {
    const host = await prisma.host.findFirst({
      where: { ...(workspaceId ? { workspaceId } : {}), status: 'ONLINE' },
      select: { id: true }
    });
    if (!host) throw new AppError('No online KVM host available for provisioning', 409, 'NO_ONLINE_HOST');

    const instance = await this.nextInstanceName(host.id);
    const subnetId = subnetIdFor(instance);

    const device = await deviceService.createDevice(
      {
        name: input.name && input.name.trim() ? input.name.trim() : `Cihaz ${instance}`,
        hostId: host.id,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
        ...(input.androidVersion ? { androidVersion: input.androidVersion } : {}),
        metadata: { instance, subnetId, provisionStatus: 'PROVISIONING' }
      },
      workspaceId
    );

    // Decrypt the unique fingerprint so the agent can spoof a distinct identity.
    const fp = await fingerprintService.get(device.id, workspaceId);
    const fingerprint = fp
      ? {
          model: fp.model,
          manufacturer: fp.manufacturer,
          brand: fp.brand,
          osVersion: fp.osVersion,
          buildNumber: fp.buildNumber,
          serialNo: fp.serialNo,
          androidId: fp.androidId,
          resolution: fp.resolution,
          dpi: fp.dpi
        }
      : {};

    const proxy =
      input.proxyCountry && PROXY_HOST && PROXY_USER
        ? {
            country: input.proxyCountry.toUpperCase(),
            username: PROXY_USER,
            password: PROXY_PASS,
            host: PROXY_HOST,
            port: PROXY_PORT
          }
        : null;

    const payload = {
      deviceId: device.id,
      instance,
      subnetId,
      srcSerial: process.env.FLEET_WD_SRC || '192.168.248.112:5555',
      fingerprint,
      ...(proxy ? { proxy } : {})
    };

    const job = await createJobRecord('PROVISION_DEVICE', payload as never, device.id, workspaceId);

    // Record the provision job id on the device so a "⚡ Kuruluyor" badge in the
    // profiles list can reopen the modal with the right job (restore live log).
    await prisma.device
      .update({
        where: { id: device.id },
        data: { metadata: { instance, subnetId, provisionStatus: 'PROVISIONING', provisionJobId: job.id } as Prisma.InputJsonValue }
      })
      .catch(() => undefined);

    // First progress signal so the modal opens immediately.
    this.broadcast(
      {
        deviceId: device.id,
        jobId: job.id,
        step: 'queued',
        label: stepFor('queued').label,
        percent: stepFor('queued').percent,
        status: 'RUNNING'
      },
      workspaceId
    );

    return { jobId: job.id, deviceId: device.id, instance, steps: PROVISION_STEPS };
  }

  // Normalize + broadcast one agent-reported sub-step. On done/FAILED also update
  // the device's provisionStatus in metadata.
  async reportProgress(
    input: { deviceId: string; jobId: string; step: string; percent?: number | undefined; status?: string | undefined; note?: string | undefined },
    workspaceId?: string
  ): Promise<ProvisionProgress> {
    const st = stepFor(input.step);
    const status: ProvisionStatus =
      input.status === 'COMPLETED' || input.status === 'FAILED' ? input.status : 'RUNNING';
    const percent =
      typeof input.percent === 'number' && input.percent >= 0 && input.percent <= 100
        ? Math.round(input.percent)
        : st.percent;
    const event: ProvisionProgress = {
      deviceId: input.deviceId,
      jobId: input.jobId,
      step: st.key,
      label: st.label,
      percent,
      status,
      ...(input.note ? { note: input.note } : {})
    };
    this.broadcast(event, workspaceId);

    // Persist the log line so the modal can restore history after "arka plana al".
    await this.appendLog(input.jobId, event).catch(() => undefined);

    if (st.key === 'done' || status === 'FAILED') {
      await this.updateProvisionStatus(input.deviceId, status === 'FAILED' ? 'FAILED' : 'READY').catch(() => undefined);
    }
    return event;
  }

  // Append a progress event to Job.result.provisionLog[] (capped) + lastProgress,
  // so a reopened modal can replay the terminal. Uses the existing Job.result Json
  // field — no migration.
  private async appendLog(jobId: string, event: ProvisionProgress): Promise<void> {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { result: true } });
    if (!job) return;
    const result = (job.result ?? {}) as Record<string, unknown>;
    const log = Array.isArray(result.provisionLog) ? (result.provisionLog as unknown[]) : [];
    log.push({
      ts: new Date().toISOString(),
      step: event.step,
      percent: event.percent,
      status: event.status,
      ...(event.note ? { note: event.note } : {})
    });
    // Keep the last 400 lines to bound the JSON size.
    const trimmed = log.slice(-400);
    await prisma.job.update({
      where: { id: jobId },
      data: { result: { ...result, provisionLog: trimmed, lastProgress: event } as Prisma.InputJsonValue }
    });
  }

  // Return the persisted provision log + last progress for a job (modal restore).
  async getStatus(
    jobId: string,
    workspaceId?: string
  ): Promise<{ jobId: string; deviceId: string; status: string; steps: ProvisionStep[]; lastProgress: ProvisionProgress | null; log: unknown[] }> {
    const job = await prisma.job.findFirst({
      where: { id: jobId, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, status: true, result: true, payload: true }
    });
    if (!job) throw new AppError('Provision job not found', 404, 'JOB_NOT_FOUND');
    const result = (job.result ?? {}) as Record<string, unknown>;
    const deviceId = (job.payload as { deviceId?: string } | null)?.deviceId ?? '';
    return {
      jobId: job.id,
      deviceId,
      status: job.status,
      steps: PROVISION_STEPS,
      lastProgress: (result.lastProgress as ProvisionProgress) ?? null,
      log: Array.isArray(result.provisionLog) ? (result.provisionLog as unknown[]) : []
    };
  }

  private async updateProvisionStatus(deviceId: string, provisionStatus: 'READY' | 'FAILED'): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } });
    const meta = (device?.metadata ?? {}) as Record<string, unknown>;
    await prisma.device.update({
      where: { id: deviceId },
      data: { metadata: { ...meta, provisionStatus } as Prisma.InputJsonValue }
    });
  }

  private broadcast(event: ProvisionProgress, workspaceId?: string): void {
    deviceHub.broadcast({
      type: 'provision.progress',
      deviceId: event.deviceId,
      payload: event,
      timestamp: new Date().toISOString(),
      ...(workspaceId ? { workspaceId } : {})
    });
  }
}

export const provisionService = new ProvisionService();
