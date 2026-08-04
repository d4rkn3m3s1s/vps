import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { generateFingerprintData, decryptFingerprint } from '../fingerprint/fingerprint.service';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import type {
  DeviceCreateInput,
  DeviceGroupCreateInput,
  DeviceGroupUpdateInput,
  DeviceUpdateInput
} from './device.types';
import { getWhatsappStates, getWhatsappState, EMPTY_WHATSAPP_STATE } from './whatsappCategory';

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
    // ★DATA-LOSS GUARD (UI hint): tag each device that already holds a live WhatsApp account
    // so the dashboard can warn before a new registration (which pm-clears/wipes it). One
    // grouped query for the whole page (no N+1). Signal = a whatsapp GeneratedAccount in
    // ACTIVE/AWAITING_MANUAL — the same authoritative check the API start-guard uses.
    if (devices.length) {
      const ids = devices.map((d) => d.id);
      // ★Kategori/hesap durumu TEK yerden gelir (devices/whatsappCategory.ts) — panel
      // kartı, public API guard'ı ve /devices/:id capabilities hep aynı kuralı görsün
      // diye. Eskiden bu sorgu burada kopyalanmıştı ve send-guard'daki ikinci kopyayla
      // ayrışmıştı (panel "sağlıklı" derken API 409 veriyordu).
      // `protected` = elle kaydedilmiş/değerli cihaz işareti; kategori bunu kullanır
      // (satır yok + korumalı = 'manual'). Cihaz satırları zaten elimizde olduğu için
      // yardımcının kendi Device sorgusunu atlatıyoruz.
      const protectedIds = new Set(devices.filter((d) => d.protected).map((d) => d.id));
      const states = await getWhatsappStates(ids, protectedIds);
      for (const d of devices) {
        const st = states.get(d.id) ?? EMPTY_WHATSAPP_STATE;
        // "Device still holds a live account" (veri-kaybı guard'ı): ACTIVE +
        // AWAITING_MANUAL + RESTRICTED = kategori 'whatsapp'.
        (d as Record<string, unknown>).hasActiveWhatsapp = st.category === 'whatsapp';
        (d as Record<string, unknown>).activeWhatsappPhone = st.phone;
        // Sorun rozeti yalnızca RESTRICTED/BANNED/LOGGED_OUT için; null = sağlıklı ya da hesap yok.
        (d as Record<string, unknown>).waAccountHealth = st.health;
        // empty | registering | whatsapp | blocked
        (d as Record<string, unknown>).whatsappCategory = st.category;
      }
    }
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
    // listDevices ile aynı WhatsApp alanlarını iliştir — tek cihaz okuyan çağıranın
    // (public /v1/devices/:id, dashboard detay) listeden farklı bir cevap görmemesi için.
    if (device) {
      const st = await getWhatsappState(device.id);
      (device as Record<string, unknown>).hasActiveWhatsapp = st.category === 'whatsapp';
      (device as Record<string, unknown>).activeWhatsappPhone = st.phone;
      (device as Record<string, unknown>).waAccountHealth = st.health;
      (device as Record<string, unknown>).whatsappCategory = st.category;
    }
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
    // Protect/unprotect: a protected device refuses delete/reset/restore.
    if (typeof input.protected === 'boolean') data.protected = input.protected;

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
    // The WAKE job is a deliberate continuation of the SAME operator action, so it
    // MUST pass skipBusyCheck: otherwise assertDeviceIdle sees the just-created
    // (still PENDING) SLEEP job and throws DEVICE_BUSY — leaving the device asleep
    // and never woken. (Same reasoning as OTP-continuation jobs.)
    await createJobRecord('DEVICE_SLEEP', { deviceId: id, instance } as JobPayload, id, workspaceId);
    const wake = await createJobRecord('DEVICE_WAKE', { deviceId: id, instance } as JobPayload, id, workspaceId, { skipBusyCheck: true });
    await prisma.device.update({ where: { id }, data: { status: 'REBOOTING' } });
    return { jobId: wake.id, deviceId: id, instance };
  }

  async deleteDevice(id: string, workspaceId?: string) {
    // Protected devices (e.g. one holding an active WhatsApp account) refuse
    // deletion — an operator must unprotect it first. Workspace-scoped lookup so
    // a cross-tenant device is treated as not-found. Also read the instance name so
    // we can tear the Waydroid instance down on the host (see below).
    const dev = await prisma.device.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      select: { protected: true, metadata: true, hostId: true }
    });
    if (!dev) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    if (dev.protected) {
      throw new AppError('Bu cihaz korumalı — silmeden önce korumayı kaldırın', 409, 'DEVICE_PROTECTED');
    }
    // ★2026-07-24: destroy the Waydroid instance on the host, not just the DB row.
    // BUG: delete previously did ONLY the DB delete — the host instance (lxc-start +
    // weston + surfaceflinger + WhatsApp) kept running forever as an orphan, so
    // deleting a device did NOT free CPU/RAM/disk (verified: 5 orphans running for
    // deleted devices). We now dispatch a DEVICE_DESTROY job BEFORE deleting the row.
    // It carries the instance NAME (not deviceId) so the agent's wd-destroy.sh runs
    // even though the Device row is about to vanish; the job is workspace-scoped but
    // not device-scoped (deviceId=null), so it survives the delete. Best-effort: a
    // missing instance name (manual/legacy device) just skips the host teardown.
    const instance = ((dev.metadata as { instance?: string } | null)?.instance || '').trim();
    if (instance) {
      await createJobRecord(
        'DEVICE_DESTROY',
        { instance } as unknown as JobPayload,
        undefined,
        workspaceId
      ).catch(() => undefined); // never block the delete on job-dispatch failure

      // ★2026-08-04 ADI EMEKLİYE AYIR — bir daha ASLA tahsis edilmesin.
      // Operatör: "mi47'yi silersem bir daha kurulmasın, hep farklı olsun".
      // Kayıt SİLME İŞLEMİNDEN ÖNCE yazılır: sonraya bırakılsaydı, silme ile
      // yazma arasında gelen bir provision aynı adı kapabilirdi.
      // Host tarafında ayrıca wd-destroy.sh `/var/lib/waydroid-retired.list`e
      // yazar — iki kayıt bağımsız, biri kaybolsa diğeri adı korur.
      if (dev.hostId) {
        await prisma.retiredInstance
          .create({ data: { hostId: dev.hostId, instance, reason: 'deleted' } })
          .catch(() => undefined); // zaten emekliyse (unique) veya yazılamazsa silmeyi bloklama
      }
    }
    // ★2026-07-24: Job.deviceId and GeneratedAccount.deviceId are plain String columns
    // (no @relation → no FK cascade), so deleting a device would leave them DANGLING —
    // pointing at a row that no longer exists (VERIFIED: 146 Job + 7 GA orphans). We keep
    // the history rows (register logs are valuable) but NULL the broken reference so a later
    // join/analytics can't silently mis-match. Done in a transaction with the delete so a
    // crash can't leave a half-cleared state.
    const { count } = await prisma.$transaction(async (tx) => {
      await tx.job.updateMany({ where: { deviceId: id }, data: { deviceId: null } });
      await tx.generatedAccount.updateMany({ where: { deviceId: id }, data: { deviceId: null } });
      // Workspace-scoped, atomic delete: a device outside the caller's workspace is
      // never matched (no cross-tenant delete, no TOCTOU window).
      const res = await tx.device.deleteMany({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
      return res;
    });
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
    // One groupBy instead of 8 separate count() round-trips (7 per-status + total).
    // Postgres buckets by status in a single index scan; we map the buckets back and
    // default any missing status to 0, deriving the total by summing.
    const groups = await prisma.device.groupBy({
      by: ['status'],
      where: { ...(workspaceId ? { workspaceId } : {}) },
      _count: { _all: true }
    });
    const by = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
    const online = by('ONLINE');
    const offline = by('OFFLINE');
    const starting = by('STARTING');
    const stopping = by('STOPPING');
    const error = by('ERROR');
    const updating = by('UPDATING');
    const rebooting = by('REBOOTING');
    const total = groups.reduce((sum, g) => sum + g._count._all, 0);
    return { online, offline, starting, stopping, error, updating, rebooting, total };
  }

  async listGroups(workspaceId?: string) {
    return prisma.deviceGroup.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { devices: true }
    });
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
