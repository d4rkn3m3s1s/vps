import type { GeneratedAccountStatus, Host } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { decryptString, encryptString, sha256 } from '../../lib/crypto';
import { webhooksService } from '../webhooks/webhooks.service';
import { deviceHub } from '../devices/device.hub';
import { alertsService } from '../alerts/alerts.service';
import { snapshotService } from '../snapshots/snapshot.service';
import { usageService } from '../usage/usage.service';
import { calendarService } from '../calendar/calendar.service';
import { notificationsService } from '../notifications/notifications.service';
import { whatsappService, normalizePeer } from '../whatsapp/whatsapp.service';
import { provisionService } from '../provision/provision.service';

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

    // ── WhatsApp on-device job → operator notification (Telegram/Slack/Discord) ──
    // Every WhatsApp device action fired from Telegram/dashboard/public-API is an
    // async PENDING job; the trigger only says "started". Without a completion
    // notification the operator never learns the OUTCOME (deleted? blocked? number?).
    // This is the single terminal chokepoint, so we fan a human-readable Turkish
    // result out to the workspace's channels here — the fix for "Telegram logs never
    // arrive". Best-effort; never blocks or throws.
    if (updated.type.startsWith('WHATSAPP_') && updated.workspaceId) {
      void notifyWhatsappJob(updated.workspaceId, updated.type, updated.payload, outcome).catch(() => undefined);
    }

    // Snapshot capture jobs carry a snapshotId; reflect the outcome onto the
    // snapshot row (READY + artifactRef/size, or FAILED).
    if (updated.type === 'EMULATOR_SNAPSHOT_CREATE') {
      const snapshotId = (updated.payload as { snapshotId?: string } | null)?.snapshotId;
      if (snapshotId) {
        const r = (outcome.result as { artifactRef?: string; sizeBytes?: number } | undefined) ?? null;
        void snapshotService.onCaptureResult(snapshotId, r, outcome.status === 'COMPLETED').catch(() => undefined);
      }
    }

    // Outbound WhatsApp: record BOTH success and failure so the operator always
    // sees the sent message in history with a delivery status (SENT / FAILED). A
    // failed send (job FAILED, or COMPLETED with INVALID_RECIPIENT/COMPOSE_FAILED)
    // used to vanish silently — now it's a FAILED bubble with the reason.
    if (updated.type === 'WHATSAPP_SEND') {
      const pl = (updated.payload as { deviceId?: string; to?: string; message?: string; broadcastId?: string } | null) ?? {};
      const res = (outcome.result as { status?: string; note?: string } | undefined) ?? {};
      if (pl.deviceId && pl.to && pl.message) {
        // Canonical peer so outbound rows land in the SAME thread as inbound ones.
        const outPeer = normalizePeer(String(pl.to));
        const outBody = String(pl.message).slice(0, 4096);
        const outAt = new Date();
        const ok = outcome.status === 'COMPLETED' && res.status === 'SENT';
        const status = ok ? 'SENT' : 'FAILED';
        const failReason = ok ? null : (res.status || outcome.error || 'SEND_FAILED');
        void prisma.whatsappMessage
          .create({
            data: {
              deviceId: pl.deviceId,
              workspaceId: updated.workspaceId ?? null,
              direction: 'OUT',
              peer: outPeer,
              body: encryptString(outBody),
              read: true,
              status,
              statusAt: outAt,
              ...(failReason ? { failReason: String(failReason).slice(0, 200) } : {}),
              waTimestamp: outAt
            }
          })
          .catch(() => undefined);
        // Upsert the conversation thread with the outbound status (list tick).
        void whatsappService
          .recordMessage({
            deviceId: pl.deviceId,
            workspaceId: updated.workspaceId ?? null,
            peer: outPeer,
            direction: 'OUT',
            plainBody: outBody,
            at: outAt,
            status
          })
          .catch(() => undefined);
        // Webhook fan-out for external integrations (send outcome).
        void webhooksService.dispatch(
          ok ? 'WHATSAPP_SENT' : 'WHATSAPP_FAILED',
          { deviceId: pl.deviceId, to: outPeer, status, ...(failReason ? { failReason: String(failReason) } : {}), ts: outAt.toISOString() },
          updated.workspaceId ?? undefined
        );
        // Update the parent broadcast's fail counter if this send belonged to one.
        if (pl.broadcastId && !ok) {
          void prisma.whatsappBroadcast
            .update({ where: { id: pl.broadcastId }, data: { failCount: { increment: 1 } } })
            .catch(() => undefined);
        }
      }
    }

    // WhatsApp registration: reflect the agent's outcome onto the GeneratedAccount
    // row so the operator-OTP flow can advance. The agent stops at OTP_WAIT (needs
    // the SMS code), reaches CREATED once the code + profile name are entered, or
    // hits a wall (device-integrity/ban/rejected code). Without this the account
    // stayed stuck at REGISTERING forever.
    if (updated.type === 'REGISTER_WHATSAPP') {
      const accountId = (updated.payload as { accountId?: string } | null)?.accountId;
      if (accountId) {
        let nextStatus: GeneratedAccountStatus;
        let error: string | null = null;
        if (outcome.status === 'COMPLETED') {
          const res = (outcome.result as { status?: string; note?: string } | undefined) ?? {};
          switch (res.status) {
            case 'OTP_WAIT':
              nextStatus = 'AWAITING_OTP';
              break;
            case 'CREATED':
            case 'REGISTERED':
            case 'DONE':
            case 'OK':
              nextStatus = 'ACTIVE';
              break;
            default:
              // DEVICE_WALL / OTP_REJECTED / NOT_INSTALLED / unknown → failure.
              nextStatus = 'FAILED';
              error = String(res.note ?? res.status ?? 'kayıt başarısız');
          }
        } else {
          nextStatus = 'FAILED';
          error = updated.error ?? 'kayıt işi başarısız';
        }
        void prisma.generatedAccount
          .update({
            where: { id: accountId },
            data: { status: nextStatus, ...(error !== null ? { error } : { error: null }) }
          })
          .catch(() => undefined);
      }
    }

    // WhatsApp profile fetch: persist the scraped avatar + profile text onto the
    // matching conversation thread so the list/contact panel show a real photo
    // and profile fields (name/about) instead of just initials. Best-effort: if
    // no thread exists yet for this peer we skip (the operator hasn't opened a
    // chat with them). The full result also stays on the Job row.
    if (updated.type === 'WHATSAPP_PROFILE' && outcome.status === 'COMPLETED') {
      const pl = (updated.payload as { deviceId?: string; to?: string } | null) ?? {};
      const res = (outcome.result as
        | { avatarBase64?: string; profile?: Record<string, unknown> }
        | undefined) ?? {};
      if (pl.deviceId && pl.to) {
        const peer = normalizePeer(String(pl.to));
        const data: Record<string, unknown> = {};
        if (res.avatarBase64 && typeof res.avatarBase64 === 'string') {
          // Cap the stored data-URI to keep the row sane (~1.3MB of base64).
          data.avatarBase64 = res.avatarBase64.slice(0, 1_400_000);
          data.avatarAt = new Date();
        }
        if (res.profile && typeof res.profile === 'object') {
          data.profileInfo = res.profile as object;
        }
        if (Object.keys(data).length > 0) {
          void prisma.whatsappConversation
            .updateMany({ where: { deviceId: pl.deviceId, peer }, data })
            .catch(() => undefined);
        }
      }
    }

    // WhatsApp block/unblock: reconcile the conversation's `blocked` flag from the
    // agent's confirmed outcome (BLOCKED / UNBLOCKED / ALREADY_*). NO_ACTION /
    // NO_INFO leave the flag untouched.
    if (updated.type === 'WHATSAPP_BLOCK' && outcome.status === 'COMPLETED') {
      const pl = (updated.payload as { deviceId?: string; to?: string } | null) ?? {};
      const res = (outcome.result as { status?: string } | undefined) ?? {};
      const st = String(res.status || '');
      const blocked = /^BLOCKED$|^ALREADY_BLOCKED$/.test(st) ? true
        : /^UNBLOCKED$|^ALREADY_UNBLOCKED$/.test(st) ? false
        : null;
      if (pl.deviceId && pl.to && blocked !== null) {
        const peer = normalizePeer(String(pl.to));
        void prisma.whatsappConversation
          .updateMany({ where: { deviceId: pl.deviceId, peer }, data: { blocked } })
          .catch(() => undefined);
      }
    }

    // WhatsApp blocklist read: reconcile every thread's `blocked` flag on the
    // device against the scraped list — set blocked=true for peers whose number
    // appears, false for the rest. Matching is by the numeric tail of the scraped
    // string (names without a number can't be reconciled and are left as-is).
    if (updated.type === 'WHATSAPP_BLOCKLIST' && outcome.status === 'COMPLETED') {
      const pl = (updated.payload as { deviceId?: string } | null) ?? {};
      const res = (outcome.result as { blocked?: unknown } | undefined) ?? {};
      const list = Array.isArray(res.blocked) ? (res.blocked as unknown[]) : [];
      const blDeviceId = pl.deviceId;
      if (blDeviceId) {
        // Peers we can match are those where the scraped string carries a number.
        const blockedPeers = new Set<string>();
        for (const item of list) {
          const digits = String(item).replace(/[^\d]/g, '');
          if (digits.length >= 7) blockedPeers.add(normalizePeer(digits));
        }
        void (async () => {
          const threads = await prisma.whatsappConversation.findMany({
            where: { deviceId: blDeviceId },
            select: { id: true, peer: true, blocked: true }
          });
          // Partition thread ids into "should be blocked" vs "should be unblocked",
          // only where the current flag differs, then reconcile with at most TWO
          // updateMany queries instead of one UPDATE per thread (was N+1 on chatty
          // devices).
          const toBlock: string[] = [];
          const toUnblock: string[] = [];
          for (const t of threads) {
            const shouldBlock = blockedPeers.has(t.peer);
            if (t.blocked === shouldBlock) continue;
            (shouldBlock ? toBlock : toUnblock).push(t.id);
          }
          if (toBlock.length) {
            await prisma.whatsappConversation
              .updateMany({ where: { id: { in: toBlock } }, data: { blocked: true } })
              .catch(() => undefined);
          }
          if (toUnblock.length) {
            await prisma.whatsappConversation
              .updateMany({ where: { id: { in: toUnblock } }, data: { blocked: false } })
              .catch(() => undefined);
          }
        })().catch(() => undefined);
      }
    }

    // Scheduled-post RPA jobs carry scheduledPostId; advance the post from
    // POSTING to its real terminal state once the device actually ran the flow.
    if (updated.type === 'RPA_RUN') {
      const scheduledPostId = (updated.payload as { scheduledPostId?: string } | null)?.scheduledPostId;
      if (scheduledPostId) {
        void calendarService
          .resolvePosting(scheduledPostId, outcome.status === 'COMPLETED', outcome.error)
          .catch(() => undefined);
      }
    }

    // One-click provisioning finished: the agent built a brand-new instance and
    // returns its live ADB endpoint. Reflect it onto the Device so it becomes
    // reachable/ONLINE and mark provisionStatus in metadata. On failure, flag it.
    if (updated.type === 'PROVISION_DEVICE') {
      const deviceId = (updated.payload as { deviceId?: string } | null)?.deviceId;
      if (deviceId) {
        const r = (outcome.result as { ip?: string; adbPort?: number; instance?: string } | undefined) ?? {};
        const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } });
        const meta = (device?.metadata ?? {}) as Record<string, unknown>;
        if (outcome.status === 'COMPLETED' && r.ip && r.adbPort) {
          await prisma.device
            .update({
              where: { id: deviceId },
              data: {
                ipAddress: r.ip,
                adbPort: r.adbPort,
                status: 'ONLINE',
                metadata: { ...meta, provisionStatus: 'READY' } as object
              }
            })
            .catch(() => undefined);
        } else {
          await prisma.device
            .update({
              where: { id: deviceId },
              data: { metadata: { ...meta, provisionStatus: 'FAILED' } as object }
            })
            .catch(() => undefined);
        }
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

  // Agent-reported provision sub-step → normalize + broadcast provision.progress.
  async reportProgress(
    host: Host,
    jobId: string,
    input: { step: string; percent?: number | undefined; note?: string | undefined; status?: string | undefined }
  ): Promise<{ ok: true }> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    if (job.claimedByHostId !== host.id) {
      throw new AppError('Job was not claimed by this host', 403, 'JOB_NOT_CLAIMED');
    }
    const deviceId = (job.payload as { deviceId?: string } | null)?.deviceId ?? '';
    await provisionService.reportProgress(
      {
        deviceId,
        jobId,
        step: input.step,
        ...(input.percent !== undefined ? { percent: input.percent } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      },
      job.workspaceId ?? undefined
    );
    return { ok: true };
  }

  async heartbeat(
    host: Host,
    input: { runningPhones?: number | undefined; capacity?: number | undefined; serials?: string[] | undefined }
  ) {
    const updated = await prisma.host.update({
      where: { id: host.id },
      data: {
        status: 'ONLINE',
        lastSeenAt: new Date(),
        ...(typeof input.runningPhones === 'number' ? { runningPhones: input.runningPhones } : {}),
        ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {})
      }
    });

    const now = new Date();
    // When the agent reports the exact set of ADB-reachable serials, we trust it
    // as ground truth: a phone is ONLINE iff its serial is in that set, OFFLINE
    // otherwise. This also clears transitional states (REBOOTING/STARTING/…) once
    // the phone reappears, and demotes phones whose emulator was shut down but
    // whose row was left ONLINE. Without serials (older agent) we fall back to the
    // legacy behavior: a live heartbeat means all bound phones are reachable.
    const hasSerials = Array.isArray(input.serials);
    const reachable = new Set((input.serials ?? []).map((s) => s.trim()).filter(Boolean));

    // Read each affected device's PREVIOUS lastSeen BEFORE we overwrite it, so we
    // can accrue the online minutes elapsed since the last heartbeat (pay-as-you-
    // go metering). We can't do this with a bulk updateMany because that would
    // discard the prior lastSeen we need to measure the gap. With serials we also
    // consider transitional states so they can resolve; without, only OFFLINE/ONLINE.
    const affected = await prisma.device.findMany({
      where: {
        hostId: host.id,
        status: hasSerials
          ? { in: ['OFFLINE', 'ONLINE', 'STARTING', 'STOPPING', 'REBOOTING', 'UPDATING'] }
          : { in: ['OFFLINE', 'ONLINE'] }
      },
      select: { id: true, name: true, status: true, lastSeen: true, workspaceId: true, ipAddress: true, adbPort: true }
    });
    for (const d of affected) {
      const serial = d.ipAddress && d.adbPort ? `${d.ipAddress}:${d.adbPort}` : null;
      const isUp = hasSerials ? Boolean(serial && reachable.has(serial)) : true;

      if (isUp) {
        // Credit online time only for devices that were already ONLINE (a freshly
        // promoted device has no measurable online slice yet).
        if (d.status === 'ONLINE') {
          await usageService.accrue(d.id, d.lastSeen, now, d.workspaceId ?? undefined);
        }
        await prisma.device.update({ where: { id: d.id }, data: { status: 'ONLINE', lastSeen: now } }).catch(() => undefined);
        // Fire DEVICE_ONLINE only on a real transition into ONLINE.
        if (d.status !== 'ONLINE') {
          void webhooksService.dispatch('DEVICE_ONLINE', { deviceId: d.id, name: d.name }, d.workspaceId ?? undefined);
        }
      } else if (d.status !== 'OFFLINE') {
        // Serial not reachable → the phone is down. Demote to OFFLINE (also clears
        // a stuck REBOOTING/STARTING). Don't touch lastSeen so "last seen" stays meaningful.
        await prisma.device.update({ where: { id: d.id }, data: { status: 'OFFLINE' } }).catch(() => undefined);
      }
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
        // Append a timeseries point so the device-health charts have history.
        // Best-effort: a failed insert must not break the metrics update.
        await prisma.deviceMetricPoint.create({
          data: {
            deviceId,
            cpuUsage: typeof m.cpuUsage === 'number' ? m.cpuUsage : 0,
            memoryUsage: typeof m.memoryUsage === 'number' ? m.memoryUsage : 0,
            diskUsage: typeof m.diskUsage === 'number' ? m.diskUsage : 0,
            capturedAt: now
          }
        }).catch(() => undefined);
        updated += 1;
      } catch {
        /* device may have been deleted between heartbeats — skip */
      }
    }
    // Opportunistically prune very old points so the table stays bounded (keep
    // ~7 days). Runs at most a fraction of the time to avoid a delete every tick.
    if (updated > 0 && Math.floor(now.getTime() / 1000) % 20 === 0) {
      const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      await prisma.deviceMetricPoint.deleteMany({ where: { capturedAt: { lt: cutoff } } }).catch(() => undefined);
    }
    return { updated };
  }

  // Record an inbound WhatsApp message the agent captured from a device's
  // notifications. The agent identifies the device by ADB serial; we map it back
  // to the workspace-scoped device id (same as updateDeviceMetrics). Then we
  // persist the message and fan out: live WS event, webhook, and Telegram/
  // Slack/Discord notification ("bize bildirim"). Best-effort on the fan-out so
  // a channel failure never drops the message.
  async inboundWhatsapp(
    host: Host,
    input: { serial: string; from: string; text: string; ts?: number | undefined }
  ): Promise<{ stored: boolean; id?: string }> {
    // Resolve the device by exact ADB serial among this host's devices.
    const devices = await prisma.device.findMany({
      where: { hostId: host.id },
      select: { id: true, ipAddress: true, adbPort: true, workspaceId: true, name: true }
    });
    const device = devices.find(
      (d) => d.ipAddress && d.adbPort && `${d.ipAddress}:${d.adbPort}` === input.serial
    );
    if (!device) return { stored: false };

    const waTimestamp = input.ts && input.ts > 0 ? new Date(input.ts) : new Date();
    // Keep the plaintext body for the live fan-out (WS/webhook/notification) but
    // store the message body AES-256-GCM encrypted at rest.
    const plainBody = input.text.slice(0, 4096);
    // Canonical peer so an inbound "+90 546…" and an outbound "905…" share ONE thread.
    const peer = normalizePeer(input.from);
    // Idempotency key: a duplicate agent push (retry/restart re-scrape of the same
    // notification) collides on the unique index and is skipped, so unread never
    // double-counts. Bucketed to the minute so near-identical timestamps still dedup.
    const dedupeKey = sha256(`${device.id}|${peer}|${plainBody}|${Math.floor(waTimestamp.getTime() / 60000)}`);

    let msg;
    try {
      msg = await prisma.whatsappMessage.create({
        data: {
          deviceId: device.id,
          workspaceId: device.workspaceId ?? null,
          direction: 'IN',
          peer,
          body: encryptString(plainBody),
          status: 'DELIVERED',
          dedupeKey,
          waTimestamp
        }
      });
    } catch (e) {
      // Unique violation on dedupeKey → this exact message was already stored.
      // Treat as a successful no-op (don't bump unread, don't re-fan-out).
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
        return { stored: false };
      }
      throw e;
    }

    // Upsert the conversation thread (bumps unread, updates the list preview).
    void whatsappService
      .recordMessage({
        deviceId: device.id,
        workspaceId: device.workspaceId ?? null,
        peer: msg.peer,
        direction: 'IN',
        plainBody,
        at: waTimestamp
      })
      .catch(() => undefined);

    // Live push to dashboards.
    deviceHub.broadcast({
      type: 'whatsapp.message',
      deviceId: device.id,
      payload: { id: msg.id, direction: 'IN', peer: msg.peer, body: plainBody, waTimestamp: msg.waTimestamp.toISOString() },
      timestamp: new Date().toISOString(),
      workspaceId: device.workspaceId ?? undefined
    });

    // Webhook fan-out for external integrations.
    void webhooksService.dispatch(
      'WHATSAPP_MESSAGE',
      { deviceId: device.id, deviceName: device.name, from: msg.peer, text: plainBody, ts: msg.waTimestamp.toISOString() },
      device.workspaceId ?? undefined
    );

    // Push to the operator's notification channels (Telegram/Slack/Discord) with
    // a rich, at-a-glance summary: who wrote, which device, and the message.
    // Telegram gets actionable inline buttons keyed by this message's id so the
    // operator can reply / open / mark-read straight from the notification.
    const when = msg.waTimestamp.toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    void notificationsService
      .dispatch(device.workspaceId ?? '', {
        title: `📩 WhatsApp — ${msg.peer}`,
        detail: `💬 ${plainBody}\n\n📱 Cihaz: ${device.name}\n👤 Gönderen: ${msg.peer}\n🕒 ${when}`.slice(0, 900),
        telegramButtons: [
          [
            { text: '💬 Cevapla', callback_data: `wr:${msg.id}` },
            { text: '👤 Aç', callback_data: `wo:${msg.id}` },
            { text: '✓ Okundu', callback_data: `wk:${msg.id}` }
          ]
        ]
      })
      .catch(() => undefined);

    return { stored: true, id: msg.id };
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

// Turn a completed WhatsApp on-device job into a concise Turkish operator
// notification and fan it out to the workspace's channels (Telegram/Slack/Discord).
// Runs off the job-completion chokepoint so EVERY trigger surface (Telegram bot,
// dashboard, public API) gets a result without each having to poll the job itself.
async function notifyWhatsappJob(
  workspaceId: string,
  type: string,
  payloadRaw: unknown,
  outcome: { status: 'COMPLETED' | 'FAILED'; result?: unknown; error?: string | undefined }
): Promise<void> {
  const pl = (payloadRaw as { to?: string; from?: string; peer?: string } | null) ?? {};
  const res = (outcome.result as Record<string, unknown> | undefined) ?? {};
  const who = String(pl.to || pl.from || pl.peer || '').trim();
  const whoSuffix = who ? ` (${who})` : '';
  const failed = outcome.status === 'FAILED';
  const reason = failed ? String(outcome.error || res.note || res.status || 'bilinmeyen hata') : '';

  // WHATSAPP_SEND is already surfaced as a SENT/FAILED bubble + WHATSAPP_SENT
  // webhook above — skip a duplicate here to avoid double-pinging the operator.
  if (type === 'WHATSAPP_SEND') return;

  let title = '';
  let detail = '';
  switch (type) {
    case 'WHATSAPP_DELETE_MSG': {
      const scope = String(res.scope || (pl as { scope?: string }).scope || '');
      const scopeTr = scope === 'everyone' ? 'herkesten' : 'benden';
      title = failed ? '🗑️ Mesaj silinemedi' : '🗑️ Mesaj silindi';
      detail = failed ? `${whoSuffix.trim()} — ${reason}` : `Son mesaj ${scopeTr} silindi${whoSuffix}.`;
      if (!failed && res.everyoneUnavailable) detail += ' (herkesten sil yoktu, benden silindi)';
      break;
    }
    case 'WHATSAPP_CLEAR_CHAT':
      title = failed ? '🧹 Sohbet temizlenemedi' : '🧹 Sohbet temizlendi';
      detail = failed ? `${whoSuffix.trim()} — ${reason}` : `Sohbet geçmişi temizlendi${whoSuffix}.`;
      break;
    case 'WHATSAPP_BLOCK': {
      const st = String(res.status || '');
      const blocked = /^BLOCKED|ALREADY_BLOCKED/.test(st);
      title = failed ? '🚫 Engelleme başarısız' : (blocked ? '🚫 Kişi engellendi' : '✅ Engel kaldırıldı');
      detail = failed ? `${whoSuffix.trim()} — ${reason}` : `${who || 'Kişi'} için işlem tamam (${st || 'OK'}).`;
      break;
    }
    case 'WHATSAPP_BLOCKLIST': {
      const list = Array.isArray(res.blocked) ? (res.blocked as string[]) : [];
      title = failed ? '📋 Engellenenler alınamadı' : '📋 Engellenen hesaplar';
      detail = failed ? reason : (list.length ? `${list.length} kişi:\n${list.slice(0, 30).join('\n')}` : 'Engellenen kişi yok.');
      break;
    }
    case 'WHATSAPP_MYNUMBER':
      title = failed ? '📱 Numara okunamadı' : '📱 Kendi numaran';
      detail = failed ? reason : String(res.number || 'okunamadı');
      break;
    case 'WHATSAPP_PROFILE': {
      const prof = (res.profile as { profileName?: string; about?: string; phone?: string } | undefined) ?? {};
      title = failed ? '👤 Profil çekilemedi' : '👤 Profil bilgisi';
      detail = failed ? `${whoSuffix.trim()} — ${reason}`
        : [prof.profileName && `İsim: ${prof.profileName}`, prof.about && `Durum: ${prof.about}`, prof.phone && `Numara: ${prof.phone}`, res.avatarBase64 && '(avatar çekildi)']
            .filter(Boolean).join('\n') || `Profil çekildi${whoSuffix}.`;
      break;
    }
    case 'WHATSAPP_SEND_MEDIA':
      title = failed ? '🖼️ Medya gönderilemedi' : '🖼️ Medya gönderildi';
      detail = failed ? `${whoSuffix.trim()} — ${reason}` : `Medya gönderildi${whoSuffix}.`;
      break;
    default:
      return; // unknown WhatsApp job type — nothing to say
  }

  await notificationsService.dispatch(workspaceId, { title, detail });
}
