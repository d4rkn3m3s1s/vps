import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import { generateFingerprintData } from '../fingerprint/fingerprint.service';
import type { JobPayload } from '../jobs/job.types';

// Serialize a snapshot for the client. BigInt sizeBytes → number (snapshots are
// well under 2^53 bytes), and we expose a friendly source-device name.
function serialize(s: {
  sizeBytes: bigint;
  sourceDevice?: { name: string } | null;
  [k: string]: unknown;
}) {
  const { sizeBytes, sourceDevice, ...rest } = s;
  return { ...rest, sizeBytes: Number(sizeBytes), sourceDeviceName: sourceDevice?.name ?? null };
}

export const snapshotService = {
  // ── Capture ───────────────────────────────────────────────────────────────
  // Create a snapshot row (PENDING) and dispatch a capture job to the host that
  // owns the device. The agent tars /data (or commits the container image),
  // then reports artifactRef + size back via job completion.
  async createSnapshot(
    deviceId: string,
    input: { name: string; description?: string | undefined; tags?: string[] | undefined; visibility?: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC' | undefined },
    ctx: { workspaceId?: string | undefined; userId?: string | undefined }
  ) {
    const device = await prisma.device.findUnique({ where: { id: deviceId }, include: { fingerprint: true } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    if (!device.hostId) throw new AppError('Device has no host to capture from', 400, 'DEVICE_NO_HOST');

    const snap = await prisma.deviceSnapshot.create({
      data: {
        name: input.name.trim() || `${device.name} anlık görüntüsü`,
        ...(input.description ? { description: input.description } : {}),
        tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
        visibility: input.visibility ?? 'PRIVATE',
        status: 'PENDING',
        androidVersion: device.androidVersion ?? device.fingerprint?.osVersion ?? null,
        ...(device.fingerprint
          ? { metadata: { manufacturer: device.fingerprint.manufacturer, model: device.fingerprint.model, osVersion: device.fingerprint.osVersion } as Prisma.InputJsonValue }
          : {}),
        sourceDeviceId: deviceId,
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
        ...(ctx.userId ? { createdById: ctx.userId } : {})
      }
    });

    await createJobRecord(
      'EMULATOR_SNAPSHOT_CREATE',
      { deviceId, snapshotId: snap.id } as unknown as JobPayload,
      undefined,
      ctx.workspaceId
    );
    return serialize(snap);
  },

  // Called by the agent pipeline when a capture job finishes. Marks the snapshot
  // READY (with artifact location/size) or FAILED.
  async onCaptureResult(snapshotId: string, result: { artifactRef?: string; sizeBytes?: number } | null, ok: boolean) {
    const exists = await prisma.deviceSnapshot.findUnique({ where: { id: snapshotId } });
    if (!exists) return;
    await prisma.deviceSnapshot.update({
      where: { id: snapshotId },
      data: ok
        ? {
            status: 'READY',
            ...(result?.artifactRef ? { artifactRef: result.artifactRef } : {}),
            ...(typeof result?.sizeBytes === 'number' ? { sizeBytes: BigInt(Math.max(0, Math.round(result.sizeBytes))) } : {})
          }
        : { status: 'FAILED' }
    });
  },

  // ── Restore / reset / clone ────────────────────────────────────────────────
  // Restore a snapshot's state onto a device (the device must have a host).
  async restoreSnapshot(snapshotId: string, deviceId: string, ctx: { workspaceId?: string | undefined }) {
    const [snap, device] = await Promise.all([
      prisma.deviceSnapshot.findUnique({ where: { id: snapshotId } }),
      prisma.device.findUnique({ where: { id: deviceId } })
    ]);
    if (!snap) throw new AppError('Snapshot not found', 404, 'SNAPSHOT_NOT_FOUND');
    if (snap.status !== 'READY') throw new AppError('Snapshot is not ready', 400, 'SNAPSHOT_NOT_READY');
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    if (!device.hostId) throw new AppError('Device has no host', 400, 'DEVICE_NO_HOST');

    await createJobRecord(
      'EMULATOR_SNAPSHOT_RESTORE',
      { deviceId, snapshotId, artifactRef: snap.artifactRef } as unknown as JobPayload,
      undefined,
      ctx.workspaceId
    );
    await prisma.deviceSnapshot.update({ where: { id: snapshotId }, data: { installs: { increment: 1 } } });
    return { dispatched: true };
  },

  // One-click "new device": wipe app data and optionally re-roll the fingerprint
  // so the phone looks brand new without changing its platform id.
  async resetDevice(deviceId: string, input: { regenerateFingerprint?: boolean | undefined; wipeData?: boolean | undefined }, ctx: { workspaceId?: string | undefined }) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');

    if (input.regenerateFingerprint) {
      const fields = generateFingerprintData();
      await prisma.deviceFingerprint.upsert({
        where: { deviceId },
        create: { deviceId, ...fields },
        update: fields
      });
    }

    await createJobRecord(
      'EMULATOR_RESET',
      { deviceId, wipeData: input.wipeData !== false } as unknown as JobPayload,
      undefined,
      ctx.workspaceId
    );
    return { dispatched: true, regeneratedFingerprint: Boolean(input.regenerateFingerprint) };
  },

  // Provision a brand-new device and restore a snapshot onto it (the "clone"
  // flow / image-market install). Creates the device with a fresh fingerprint,
  // then dispatches a restore job (best-effort; needs a host assignment to run).
  async cloneFromSnapshot(
    snapshotId: string,
    input: { name: string; groupId?: string | undefined; hostId?: string | undefined },
    ctx: { workspaceId?: string | undefined }
  ) {
    const snap = await prisma.deviceSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snap) throw new AppError('Snapshot not found', 404, 'SNAPSHOT_NOT_FOUND');
    if (snap.status !== 'READY') throw new AppError('Snapshot is not ready', 400, 'SNAPSHOT_NOT_READY');

    const device = await prisma.device.create({
      data: {
        name: input.name.trim() || `${snap.name} kopyası`,
        ...(snap.androidVersion ? { androidVersion: snap.androidVersion } : {}),
        ...(input.groupId ? { group: { connect: { id: input.groupId } } } : {}),
        ...(input.hostId ? { host: { connect: { id: input.hostId } } } : {}),
        ...(ctx.workspaceId ? { workspace: { connect: { id: ctx.workspaceId } } } : {}),
        fingerprint: { create: generateFingerprintData() }
      },
      include: { fingerprint: true, group: true }
    });

    if (device.hostId) {
      await createJobRecord(
        'EMULATOR_SNAPSHOT_RESTORE',
        { deviceId: device.id, snapshotId, artifactRef: snap.artifactRef } as unknown as JobPayload,
        undefined,
        ctx.workspaceId
      );
    }
    await prisma.deviceSnapshot.update({ where: { id: snapshotId }, data: { installs: { increment: 1 } } });
    return { deviceId: device.id, restoreDispatched: Boolean(device.hostId) };
  },

  // ── Library + market ────────────────────────────────────────────────────────
  // Snapshots visible to a workspace: its own (any visibility) + PUBLIC market.
  async listSnapshots(workspaceId?: string) {
    const rows = await prisma.deviceSnapshot.findMany({
      where: {
        OR: [
          ...(workspaceId ? [{ workspaceId }] : []),
          { visibility: 'PUBLIC' as const }
        ]
      },
      orderBy: { createdAt: 'desc' },
      include: { sourceDevice: { select: { name: true } } }
    });
    return rows.map(serialize);
  },

  // Public image market (cross-workspace), most-installed first.
  async listMarket() {
    const rows = await prisma.deviceSnapshot.findMany({
      where: { visibility: 'PUBLIC', status: 'READY' },
      orderBy: [{ installs: 'desc' }, { createdAt: 'desc' }],
      include: { sourceDevice: { select: { name: true } } }
    });
    return rows.map(serialize);
  },

  async updateSnapshot(id: string, input: { name?: string | undefined; description?: string | undefined; tags?: string[] | undefined; visibility?: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC' | undefined }, workspaceId?: string) {
    const snap = await prisma.deviceSnapshot.findUnique({ where: { id } });
    if (!snap) throw new AppError('Snapshot not found', 404, 'SNAPSHOT_NOT_FOUND');
    if (workspaceId && snap.workspaceId && snap.workspaceId !== workspaceId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    const data: Prisma.DeviceSnapshotUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description || null;
    if (input.tags !== undefined) data.tags = input.tags.map((t) => t.trim()).filter(Boolean);
    if (input.visibility !== undefined) data.visibility = input.visibility;
    return serialize(await prisma.deviceSnapshot.update({ where: { id }, data, include: { sourceDevice: { select: { name: true } } } }));
  },

  async deleteSnapshot(id: string, workspaceId?: string) {
    const snap = await prisma.deviceSnapshot.findUnique({ where: { id } });
    if (!snap) throw new AppError('Snapshot not found', 404, 'SNAPSHOT_NOT_FOUND');
    if (workspaceId && snap.workspaceId && snap.workspaceId !== workspaceId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    await prisma.deviceSnapshot.delete({ where: { id } });
    return { deleted: true };
  }
};
