import type { Host } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { decryptString } from '../../lib/crypto';
import { webhooksService } from '../webhooks/webhooks.service';
import { deviceHub } from '../devices/device.hub';
import { alertsService } from '../alerts/alerts.service';
import { snapshotService } from '../snapshots/snapshot.service';

// The shape a host agent needs to execute a job on a local emulator. We resolve
// the device's ADB endpoint and (for proxy jobs) decrypt the proxy secret here
// so the agent never has to talk to the database or the crypto key directly.
export type AgentJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  serial: string | null;
};

export class AgentService {
  // Atomically claims the oldest PENDING job belonging to a device assigned to
  // this host. updateMany with a status guard makes the claim race-safe: only
  // one agent can flip a given job from PENDING to RUNNING.
  async claimNext(host: Host): Promise<AgentJob | null> {
    // Devices physically running on this host.
    const devices = await prisma.device.findMany({
      where: { hostId: host.id },
      select: { id: true, ipAddress: true, adbPort: true }
    });
    if (devices.length === 0) return null;

    const deviceIds = devices.map((d) => d.id);
    const serialById = new Map(
      devices.map((d) => [d.id, d.ipAddress && d.adbPort ? `${d.ipAddress}:${d.adbPort}` : null])
    );

    // Find a candidate PENDING job whose payload targets one of this host's
    // devices. Jobs carry the Device id in payload.deviceId (the dashboard shape)
    // or in emulatorId for legacy emulator jobs.
    const candidates = await prisma.job.findMany({
      where: { status: 'PENDING', claimedByHostId: null },
      orderBy: { createdAt: 'asc' },
      take: 25
    });

    for (const job of candidates) {
      const payload = (job.payload as Record<string, unknown>) ?? {};
      const deviceId = (payload.deviceId as string | undefined) ?? job.emulatorId ?? undefined;
      if (!deviceId || !deviceIds.includes(deviceId)) continue;

      // Race-safe claim: flips PENDING -> RUNNING only if still unclaimed.
      const claimed = await prisma.job.updateMany({
        where: { id: job.id, status: 'PENDING', claimedByHostId: null },
        data: { status: 'RUNNING', claimedByHostId: host.id, claimedAt: new Date(), startedAt: new Date() }
      });
      if (claimed.count === 0) continue; // lost the race; try the next candidate

      return {
        id: job.id,
        type: job.type,
        payload: this.materializePayload(payload),
        serial: serialById.get(deviceId) ?? null
      };
    }

    return null;
  }

  // Records a job result reported by the agent and fires terminal webhooks.
  // A host may only complete jobs it actually claimed.
  async complete(
    host: Host,
    jobId: string,
    outcome: { status: 'COMPLETED' | 'FAILED'; result?: unknown; error?: string | undefined }
  ) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    if (job.claimedByHostId !== host.id) {
      throw new AppError('Job was not claimed by this host', 403, 'JOB_NOT_CLAIMED');
    }

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: outcome.status,
        finishedAt: new Date(),
        ...(outcome.result !== undefined ? { result: outcome.result as object } : {}),
        ...(outcome.error !== undefined ? { error: outcome.error } : {})
      }
    });

    void webhooksService.dispatch(
      outcome.status === 'COMPLETED' ? 'JOB_COMPLETED' : 'JOB_FAILED',
      {
        jobId: updated.id,
        jobType: updated.type,
        ...(updated.error ? { error: updated.error } : {})
      },
      updated.workspaceId ?? undefined
    );

    // Real-time push to dashboards.
    deviceHub.broadcast({
      type: 'job.updated',
      deviceId: (updated.payload as { deviceId?: string } | null)?.deviceId ?? '',
      payload: { id: updated.id, type: updated.type, status: updated.status },
      timestamp: new Date().toISOString(),
      workspaceId: updated.workspaceId ?? undefined
    });

    // Snapshot capture jobs carry a snapshotId; reflect the outcome onto the
    // snapshot row (READY + artifactRef/size, or FAILED).
    if (updated.type === 'EMULATOR_SNAPSHOT_CREATE') {
      const snapshotId = (updated.payload as { snapshotId?: string } | null)?.snapshotId;
      if (snapshotId) {
        const r = (outcome.result as { artifactRef?: string; sizeBytes?: number } | undefined) ?? null;
        void snapshotService.onCaptureResult(snapshotId, r, outcome.status === 'COMPLETED').catch(() => undefined);
      }
    }

    // Evaluate alert rules on job failure.
    if (outcome.status === 'FAILED') {
      void alertsService.evaluate(updated.workspaceId ?? undefined, 'JOB_FAILED', {
        title: 'Job failed',
        detail: `${updated.type} — ${updated.error ?? 'unknown error'}`
      });
    }

    return { id: updated.id, status: updated.status };
  }

  async heartbeat(host: Host, input: { runningPhones?: number | undefined; capacity?: number | undefined }) {
    const updated = await prisma.host.update({
      where: { id: host.id },
      data: {
        status: 'ONLINE',
        lastSeenAt: new Date(),
        ...(typeof input.runningPhones === 'number' ? { runningPhones: input.runningPhones } : {}),
        ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {})
      }
    });

    // A live agent heartbeat means this host's bound phones are reachable over
    // ADB, so reflect them as ONLINE on the dashboard. We don't override devices
    // mid-transition (STARTING/STOPPING/REBOOTING/UPDATING) or in an ERROR state.
    const now = new Date();
    // Capture which devices were OFFLINE before this heartbeat so we can fire a
    // DEVICE_ONLINE webhook only on the actual OFFLINE -> ONLINE transition (not
    // on every heartbeat of an already-online device).
    const justCameOnline = await prisma.device.findMany({
      where: { hostId: host.id, status: 'OFFLINE' },
      select: { id: true, name: true, workspaceId: true }
    });
    await prisma.device.updateMany({
      where: { hostId: host.id, status: { in: ['OFFLINE', 'ONLINE'] } },
      data: { status: 'ONLINE', lastSeen: now }
    });
    for (const d of justCameOnline) {
      void webhooksService.dispatch('DEVICE_ONLINE', { deviceId: d.id, name: d.name }, d.workspaceId ?? undefined);
    }

    return updated;
  }

  // Persist per-device CPU/mem/disk reported by the agent. The agent knows each
  // device only by its ADB serial (ipAddress:adbPort); we map that back to the
  // device id within this host and update the metrics + lastSeen.
  async updateDeviceMetrics(
    host: Host,
    input: { devices: Array<{ serial: string; cpuUsage?: number | undefined; memoryUsage?: number | undefined; diskUsage?: number | undefined }> }
  ): Promise<{ updated: number }> {
    const devices = await prisma.device.findMany({
      where: { hostId: host.id },
      select: { id: true, ipAddress: true, adbPort: true }
    });
    const serialToId = new Map(
      devices
        .filter((d) => d.ipAddress && d.adbPort)
        .map((d) => [`${d.ipAddress}:${d.adbPort}`, d.id])
    );

    const now = new Date();
    let updated = 0;
    for (const m of input.devices) {
      const deviceId = serialToId.get(m.serial);
      if (!deviceId) continue;
      try {
        await prisma.device.update({
          where: { id: deviceId },
          data: {
            lastSeen: now,
            ...(typeof m.cpuUsage === 'number' ? { cpuUsage: m.cpuUsage } : {}),
            ...(typeof m.memoryUsage === 'number' ? { memoryUsage: m.memoryUsage } : {}),
            ...(typeof m.diskUsage === 'number' ? { diskUsage: m.diskUsage } : {})
          }
        });
        updated += 1;
      } catch {
        /* device may have been deleted between heartbeats — skip */
      }
    }
    return { updated };
  }

  // Decrypt any secret fields so the agent receives ready-to-use values. The
  // proxy password is stored AES-256-GCM encrypted; the agent never sees the key.
  private materializePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const out = { ...payload };
    if (typeof out.passwordEnc === 'string' && out.passwordEnc) {
      try {
        out.password = decryptString(out.passwordEnc);
      } catch {
        /* leave it absent if decryption fails */
      }
      delete out.passwordEnc;
    }
    return out;
  }
}

export const agentService = new AgentService();
