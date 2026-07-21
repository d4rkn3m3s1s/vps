import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { jobQueue } from './queue';
import { deviceHub } from '../devices/device.hub';
import { AppError } from '../../lib/errors';
import { EXCLUSIVE_JOB_TYPES, type JobPayload, type JobType } from './job.types';
import { waRegisterService } from '../accounts/wa-register.service';
import { encryptString } from '../../lib/crypto';
import { webhooksService } from '../webhooks/webhooks.service';

// Local copy of whatsapp.service.normalizePeer's phone-canonicalisation, inlined
// to avoid a jobs↔whatsapp import cycle (whatsapp.service already imports
// createJobRecord from here). Keeps a reaper-written OUT row in the SAME thread as
// the agent-written ones: digits only, drop a leading "00", cap length.
function canonicalPeer(peer: string): string {
  const raw = peer.trim();
  const digits = raw.replace(/\D/g, '');
  const looksLikePhone = digits.length >= 7 && /^[\d\s+()\-.]+$/.test(raw);
  if (!looksLikePhone) return raw.slice(0, 256);
  return digits.replace(/^00(?=\d)/, '').slice(0, 256);
}

// Human labels for the "device busy" message so the operator sees WHAT is running.
const JOB_LABELS: Partial<Record<JobType, string>> = {
  REGISTER_WHATSAPP: 'WhatsApp kaydı',
  REGISTER_INSTAGRAM: 'Instagram kaydı',
  WHATSAPP_SEND: 'WhatsApp mesaj gönderimi',
  WHATSAPP_SEND_MEDIA: 'WhatsApp medya gönderimi',
  WHATSAPP_PROFILE: 'WhatsApp profil işlemi',
  RPA_RUN: 'RPA otomasyonu',
  AGENT_RUN: 'AI ajan',
  APP_EXPLORE: 'Uygulama keşfi',
  APPLY_FINGERPRINT: 'Kimlik değiştirme',
  PROVISION_DEVICE: 'Cihaz kurulumu',
  PROVISION_INTEGRITY: 'Bütünlük kontrolü',
  EMULATOR_SNAPSHOT_CREATE: 'Anlık görüntü alma',
  EMULATOR_SNAPSHOT_RESTORE: 'Anlık görüntü geri yükleme',
  EMULATOR_RESET: 'Sıfırlama',
  EMULATOR_SET_PROXY: 'Proxy ayarlama',
  DEVICE_WAKE: 'Cihaz uyandırma',
  DEVICE_SLEEP: 'Cihaz uyutma'
};

// Short, serialisable messaging jobs that the operator fires back-to-back (send /
// send-media). Unlike REGISTER/PROVISION (which are long single-shot flows that a
// second job must NOT interleave with), two of these on the same device are SAFE
// to queue: the host agent runs one job per device at a time, so a second send
// just waits its turn. So instead of rejecting the 2nd rapid send with DEVICE_BUSY
// (which — with no retry — silently dropped the message: the #1 root cause of
// "sometimes it doesn't send"), we let it through as PENDING and let the agent
// drain the queue. A depth cap still stops a runaway flood. See createJobRecord.
const QUEUEABLE_JOB_TYPES: ReadonlySet<JobType> = new Set<JobType>([
  'WHATSAPP_SEND',
  'WHATSAPP_SEND_MEDIA'
]);
// Max PENDING+RUNNING queueable jobs allowed to pile up on one device before we
// start rejecting — keeps a stuck agent from letting hundreds of sends accumulate.
const QUEUE_DEPTH_CAP = 8;

// Device-exclusivity guard. If the given device already has an active
// (PENDING/RUNNING) exclusive job, reject with DEVICE_BUSY so the operator queues
// work serially instead of flooding the device with overlapping ADB/UI drives.
// EXCEPTION: when BOTH the incoming job and the active one are QUEUEABLE messaging
// jobs, we do NOT reject — we allow it to queue (up to QUEUE_DEPTH_CAP), because
// the agent serialises them anyway and dropping the message is worse than a short
// wait. deviceId is read from payload.deviceId OR the emulatorId argument.
async function assertDeviceIdle(
  type: JobType,
  deviceId: string | undefined,
  workspaceId?: string,
  tx: Prisma.TransactionClient = prisma
): Promise<void> {
  if (!deviceId || !EXCLUSIVE_JOB_TYPES.has(type)) return;
  const active = await tx.job.findFirst({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      type: { in: [...EXCLUSIVE_JOB_TYPES] },
      ...(workspaceId ? { workspaceId } : {}),
      // Prefer the indexed deviceId column; keep emulatorId + the legacy JSON
      // path as fallbacks so jobs written before the backfill are still matched.
      OR: [{ deviceId }, { emulatorId: deviceId }, { payload: { path: ['deviceId'], equals: deviceId } }]
    },
    select: { id: true, type: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
  if (!active) return;

  // Queue instead of reject: incoming AND active are both short messaging jobs.
  // The agent will drain them one at a time; we only guard against an unbounded
  // pile-up (e.g. a wedged agent that never drains).
  if (QUEUEABLE_JOB_TYPES.has(type) && QUEUEABLE_JOB_TYPES.has(active.type as JobType)) {
    const depth = await tx.job.count({
      where: {
        status: { in: ['PENDING', 'RUNNING'] },
        type: { in: [...QUEUEABLE_JOB_TYPES] },
        ...(workspaceId ? { workspaceId } : {}),
        OR: [{ deviceId }, { emulatorId: deviceId }, { payload: { path: ['deviceId'], equals: deviceId } }]
      }
    });
    if (depth < QUEUE_DEPTH_CAP) return; // room in the queue → allow (PENDING)
    throw new AppError(
      `Cihazda çok fazla bekleyen mesaj var (${depth}). Kuyruk boşalınca tekrar deneyin.`,
      409,
      'DEVICE_QUEUE_FULL'
    );
  }

  const label = JOB_LABELS[active.type as JobType] ?? active.type;
  throw new AppError(
    `Cihaz meşgul — "${label}" işlemi sürüyor. Bitince tekrar deneyin.`,
    409,
    'DEVICE_BUSY'
  );
}

export async function createJob(type: JobType, payload: JobPayload, emulatorId?: string): Promise<{ id: string }> {
  const job = await prisma.job.create({
    data: {
      type,
      status: 'PENDING',
        payload: payload as Prisma.InputJsonValue,
        ...(emulatorId ? { emulatorId } : {})
    }
  });

  await jobQueue.add(type, payload, {
    jobId: job.id,
    removeOnComplete: 100,
    removeOnFail: 100
  });

  return { id: job.id };
}

// Creates a persisted job record WITHOUT enqueuing to BullMQ. Used by dashboard
// actions (app install, automation task) so they appear in the Jobs list even
// when no worker is attached to execute emulator side-effects.
export async function createJobRecord(
  type: JobType,
  payload: JobPayload,
  emulatorId?: string,
  workspaceId?: string,
  opts?: { skipBusyCheck?: boolean }
) {
  // `Job.emulatorId` is a FK to the Emulator table, but most modern flows address
  // a Device (Device.id), which is NOT an Emulator row — passing it here triggers
  // a Job_emulatorId_fkey violation. So only set emulatorId when it truly matches
  // an Emulator; otherwise fold the id into payload.deviceId (which the host agent
  // already uses to claim jobs) so the link is preserved without breaking the FK.
  let validEmulatorId: string | undefined;
  let finalPayload = payload;
  // Skip the Emulator lookup entirely when the payload ALREADY carries a deviceId:
  // in that case the id-fold branch below can never fire, and no caller passes a
  // real Emulator id together with a payload.deviceId — so the lookup would be a
  // pure wasted query. This is the hot path for every device-scoped dispatch
  // (all WhatsApp actions, RPA, snapshots, catalog installs) which pass the id via
  // payload.deviceId; only legacy emulator-lifecycle flows (e.g. EMULATOR_START
  // with an empty payload) still need the FK resolution.
  const payloadHasDeviceId = Boolean((payload as Record<string, unknown>).deviceId);
  if (emulatorId && !payloadHasDeviceId) {
    const exists = await prisma.emulator.findUnique({ where: { id: emulatorId }, select: { id: true } });
    if (exists) {
      validEmulatorId = emulatorId;
    } else {
      finalPayload = { ...(payload as Record<string, unknown>), deviceId: emulatorId } as unknown as JobPayload;
    }
  }
  // Queue/limit guard: block a second device-exclusive job on a busy device.
  // OTP-continuation jobs (skipBusyCheck) are the SAME flow's second pass and must
  // not be rejected as "busy".
  const targetDeviceId =
    ((finalPayload as Record<string, unknown>).deviceId as string | undefined) ?? emulatorId;
  const jobData = {
    type,
    status: 'PENDING' as const,
    payload: finalPayload as Prisma.InputJsonValue,
    // Mirror the target device into the indexed first-class column so the idle
    // guard + agent claim don't have to filter on a JSON path.
    ...(targetDeviceId ? { deviceId: targetDeviceId } : {}),
    ...(validEmulatorId ? { emulatorId: validEmulatorId } : {}),
    ...(workspaceId ? { workspaceId } : {})
  };

  let job;
  if (!opts?.skipBusyCheck && targetDeviceId && EXCLUSIVE_JOB_TYPES.has(type)) {
    // Close the check-then-act race: two concurrent dispatches for the same
    // device could both pass assertDeviceIdle and each create an exclusive job.
    // Serialize the idle-check + create under a per-device advisory lock inside
    // one transaction so the second dispatch sees the first job and is rejected
    // with DEVICE_BUSY.
    job = await prisma.$transaction(async (dtx) => {
      await dtx.$executeRaw`SELECT pg_advisory_xact_lock(838383, hashtext(${targetDeviceId}))`;
      await assertDeviceIdle(type, targetDeviceId, workspaceId, dtx);
      return dtx.job.create({ data: jobData });
    });
  } else {
    job = await prisma.job.create({ data: jobData });
  }

  // Real-time push so the Jobs view + notifications update instantly.
  deviceHub.broadcast({
    type: 'job.created',
    deviceId: ((finalPayload as Record<string, unknown>).deviceId as string | undefined) ?? emulatorId ?? '',
    payload: { id: job.id, type: job.type, status: job.status },
    timestamp: new Date().toISOString(),
    workspaceId: workspaceId ?? undefined
  });

  return job;
}

// Newest jobs for a workspace. `limit` is applied in the DB (not in JS) so we
// never load an entire job history into memory — a busy workspace can accumulate
// hundreds of thousands of rows. Capped at 500 as a hard safety ceiling.
export async function listJobs(workspaceId?: string, limit = 100) {
  return prisma.job.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 500)
  });
}

// ── Stale-job reaper ───────────────────────────────────────────────────────
// Safety net for the "spinner that never resolves" bug: a device-exclusive job
// can sit PENDING forever if nothing ever claims it (agent died/ADB dropped
// AFTER dispatch — assertDeviceReady catches the case at dispatch time, this
// catches it after). We fail such jobs so the UI shows an honest error instead
// of spinning. Thresholds are generous so a genuinely slow run isn't killed:
//   - PENDING never claimed for > 6 min  → agent isn't picking it up
//   - RUNNING with no completion for > 15 min → agent hung mid-run
//   - RUNNING short messaging job (send/media) with no completion for > 4 min →
//     these normally take 15-30s; 15 min of "sending…" is a stale-agent lie, so
//     they get a much tighter cap and turn into an honest FAILED bubble sooner.
// For REGISTER_WHATSAPP we also flip the account + push a FAILED progress event
// so the live panel turns red with a clear reason. For WHATSAPP_SEND we write the
// same FAILED bubble + broadcast counter that agent.complete() would have, so a
// reaper-killed message leaves a visible trace in the chat thread (it previously
// only flipped the Job to FAILED — the thread showed nothing).
const PENDING_STALE_MS = 6 * 60 * 1000;
const RUNNING_STALE_MS = 15 * 60 * 1000;
const RUNNING_STALE_SHORT_MS = 4 * 60 * 1000; // send/media: tight cap
const SHORT_RUNNING_TYPES: ReadonlySet<JobType> = new Set<JobType>(['WHATSAPP_SEND', 'WHATSAPP_SEND_MEDIA']);

export async function reapStaleJobs(): Promise<number> {
  const now = Date.now();
  const pendingCutoff = new Date(now - PENDING_STALE_MS);
  const runningCutoff = new Date(now - RUNNING_STALE_MS);
  const runningShortCutoff = new Date(now - RUNNING_STALE_SHORT_MS);
  const stale = await prisma.job.findMany({
    where: {
      OR: [
        // Broadcast sends are queued intentionally: createBroadcast dispatches up to
        // 1000 WHATSAPP_SEND jobs a few seconds apart, but the agent runs them one per
        // device (~20s each), so the tail legitimately sits PENDING for hours. Exempt
        // any job carrying a broadcastId from the PENDING reaper — else the reaper
        // false-FAILs hundreds of valid recipients (inflating failCount + writing
        // FAILED bubbles for messages that were never even attempted).
        {
          status: 'PENDING',
          createdAt: { lt: pendingCutoff },
          NOT: { payload: { path: ['broadcastId'], not: Prisma.DbNull } }
        },
        // Long RUNNING jobs (not short messaging types) — generous 15 min cap.
        {
          status: 'RUNNING',
          type: { notIn: [...SHORT_RUNNING_TYPES] },
          OR: [{ startedAt: { lt: runningCutoff } }, { startedAt: null, createdAt: { lt: runningCutoff } }]
        },
        // Short messaging jobs — tight 4 min cap.
        {
          status: 'RUNNING',
          type: { in: [...SHORT_RUNNING_TYPES] },
          OR: [{ startedAt: { lt: runningShortCutoff } }, { startedAt: null, createdAt: { lt: runningShortCutoff } }]
        }
      ]
    },
    select: { id: true, type: true, status: true, payload: true, workspaceId: true },
    // Bound the scan so one bad tick (mass agent/ADB outage) can't pull every
    // stale job into memory at once; the rest are reaped on the next tick.
    take: 500
  });
  if (stale.length === 0) return 0;

  const reason =
    'Cihaz/aracı zaman aşımına uğradı — iş kuyrukta beklerken hiç çalıştırılmadı (agent veya ADB bağlantısı kopmuş olabilir).';
  for (const job of stale) {
    // Conditional flip: only mark FAILED if the job is STILL in its stale state.
    // If the agent's complete() won the race in the meantime, this is a no-op and
    // its terminal status stands (paired with complete()'s RUNNING-only guard).
    // Also clear claimedByHostId so a re-dispatch isn't blocked by a dead claim.
    const reaped = await prisma.job
      .updateMany({
        where: { id: job.id, status: job.status },
        data: { status: 'FAILED', error: reason, finishedAt: new Date(), claimedByHostId: null }
      })
      .catch(() => ({ count: 0 }));
    if (reaped.count === 0) continue; // complete() beat us; leave its result alone

    const deviceId = (job.payload as { deviceId?: string } | null)?.deviceId;
    const accountId = (job.payload as { accountId?: string } | null)?.accountId;

    // Broadcast a job update so the Jobs view + any card badge refresh.
    deviceHub.broadcast({
      type: 'job.updated',
      deviceId: deviceId ?? '',
      payload: { id: job.id, type: job.type, status: 'FAILED', error: reason },
      timestamp: new Date().toISOString(),
      workspaceId: job.workspaceId ?? undefined
    });

    // Device provisioning: clear the device's metadata.provisionStatus so the card
    // stops showing a frozen "Kuruluyor". reapStaleJobs previously only flipped the Job
    // to FAILED — the Device row kept provisionStatus:'PROVISIONING', so the panel still
    // rendered "Kuruluyor" forever after a killed/orphaned provision. Now we mark it
    // FAILED to match the terminal job. (The provision cancel endpoint does the same.)
    if (job.type === 'PROVISION_DEVICE' && deviceId) {
      const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } }).catch(() => null);
      const meta = (dev?.metadata ?? {}) as Record<string, unknown>;
      await prisma.device
        .update({ where: { id: deviceId }, data: { metadata: { ...meta, provisionStatus: 'FAILED' } as object } })
        .catch(() => undefined);
    }

    // WhatsApp send/media: the agent's complete() path writes a FAILED bubble +
    // broadcast counter + webhook when a send fails; the reaper bypasses complete(),
    // so a reaper-killed send left NO trace in the chat thread. Mirror that here so
    // the operator sees a "gönderilemedi" bubble instead of the message vanishing.
    if ((job.type === 'WHATSAPP_SEND' || job.type === 'WHATSAPP_SEND_MEDIA') && deviceId) {
      const pl = (job.payload as { to?: string; message?: string; broadcastId?: string } | null) ?? {};
      if (pl.to && pl.message) {
        const outPeer = canonicalPeer(String(pl.to));
        const outBody = String(pl.message).slice(0, 4096);
        const outAt = new Date();
        await prisma.whatsappMessage
          .create({
            data: {
              deviceId,
              workspaceId: job.workspaceId ?? null,
              direction: 'OUT',
              peer: outPeer,
              body: encryptString(outBody),
              read: true,
              status: 'FAILED',
              statusAt: outAt,
              failReason: reason.slice(0, 200),
              waTimestamp: outAt
            }
          })
          .catch(() => undefined);
        // Denormalise the FAILED status onto the thread (list tick) without pulling
        // in whatsappService (import-cycle): upsert the conversation row directly.
        await prisma.whatsappConversation
          .upsert({
            where: { deviceId_peer: { deviceId, peer: outPeer } },
            create: {
              deviceId,
              workspaceId: job.workspaceId ?? null,
              peer: outPeer,
              lastMessageBody: encryptString(outBody),
              lastDirection: 'OUT',
              lastMessageAt: outAt,
              lastStatus: 'FAILED',
              unreadCount: 0
            },
            update: {
              lastMessageBody: encryptString(outBody),
              lastDirection: 'OUT',
              lastMessageAt: outAt,
              lastStatus: 'FAILED',
              ...(job.workspaceId ? { workspaceId: job.workspaceId } : {})
            }
          })
          .catch(() => undefined);
        void webhooksService.dispatch(
          'WHATSAPP_FAILED',
          { deviceId, to: outPeer, status: 'FAILED', failReason: reason, ts: outAt.toISOString() },
          job.workspaceId ?? undefined
        );
        if (pl.broadcastId) {
          await prisma.whatsappBroadcast
            .update({ where: { id: pl.broadcastId }, data: { failCount: { increment: 1 } } })
            .catch(() => undefined);
        }
      }
    }

    // WhatsApp registration: fail the account + push a FAILED step to the panel.
    if (job.type === 'REGISTER_WHATSAPP' && accountId) {
      await prisma.generatedAccount
        .update({ where: { id: accountId }, data: { status: 'FAILED', error: reason } })
        .catch(() => undefined);
      await waRegisterService
        .reportProgress(
          { accountId, deviceId: deviceId ?? '', jobId: job.id, step: 'queued', status: 'FAILED', note: `❌ ${reason}` },
          job.workspaceId ?? undefined
        )
        .catch(() => undefined);
      // Clear the device's WA-registration badge so the card stops showing "sürüyor".
      if (deviceId) {
        const dev = await prisma.device.findUnique({ where: { id: deviceId }, select: { metadata: true } }).catch(() => null);
        const meta = (dev?.metadata ?? {}) as Record<string, unknown>;
        if (meta.waRegisterAccountId === accountId) {
          delete meta.waRegisterStatus;
          delete meta.waRegisterAccountId;
          delete meta.waRegisterPhone;
          delete meta.waRegisterJobId;
          await prisma.device.update({ where: { id: deviceId }, data: { metadata: meta as object } }).catch(() => undefined);
        }
      }
    }
  }
  return stale.length;
}

// Object-level authorization: a job is only returned when it belongs to the
// caller's workspace. Passing workspaceId=undefined (e.g. an internal caller
// with no tenant context) keeps the old unscoped behavior; the HTTP handler
// always passes the caller's workspace so foreign job ids 404 instead of
// leaking their payload/result (which can contain decrypted secrets).
export async function getJob(id: string, workspaceId?: string) {
  return prisma.job.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}) }
  });
}
