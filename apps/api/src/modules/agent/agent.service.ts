import type { AlertTrigger, GeneratedAccountStatus, Host } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';

// Best-effort side-effect logger. Use in place of `.catch(() => undefined)` on
// post-completion downstream writes so a failure leaves a diagnosable trail
// (which step, which job) instead of vanishing — without aborting the others.
const quiet = (step: string, jobId?: string) => (err: unknown) => {
  logger.warn('post-complete side-effect failed', {
    step,
    ...(jobId ? { jobId } : {}),
    error: err instanceof Error ? err.message : String(err)
  });
};
import { decryptString, encryptString, sha256 } from '../../lib/crypto';
import { webhooksService } from '../webhooks/webhooks.service';
import { deviceHub } from '../devices/device.hub';
import { alertsService } from '../alerts/alerts.service';
import { snapshotService } from '../snapshots/snapshot.service';
import { calendarService } from '../calendar/calendar.service';
import { notificationsService } from '../notifications/notifications.service';
import { whatsappService, normalizePeer, type WaAccountHealth } from '../whatsapp/whatsapp.service';
import { provisionService } from '../provision/provision.service';
import { waRegisterService } from '../accounts/wa-register.service';
import { igRegisterService } from '../accounts/ig-register.service';

// Classify a WhatsApp inbound notice as an account-health signal (or null if it's
// a normal peer message). WhatsApp surfaces account trouble as system notifications
// that the inbox poll captures verbatim — we key off the stable English strings
// (WhatsApp's own copy) to detect them. Ordered hardest→softest so "can't use"
// (ban) wins over a generic match. Returns the target health state or null.
function classifyWaSystemNotice(text: string): WaAccountHealth | null {
  const t = (text || '').toLowerCase();
  if (!t) return null;
  // Logged out / number moved elsewhere → needs re-registration.
  if (/logged out of whatsapp|you're logged out|no longer registered|register(ed)? on another/i.test(t)) {
    return 'LOGGED_OUT';
  }
  // Hard ban / suspension.
  if (/can.?t use whatsapp|account.*(banned|suspended)|violat|terms of service/i.test(t)) {
    return 'BANNED';
  }
  // Temporary restriction / review.
  if (/temporarily (banned|restricted)|account.*(in )?review|try again later|restricted/i.test(t)) {
    return 'RESTRICTED';
  }
  return null;
}

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
      select: { id: true, ipAddress: true, adbPort: true, workspaceId: true }
    });
    if (devices.length === 0) return null;

    const deviceIds = devices.map((d) => d.id);
    const serialById = new Map(
      devices.map((d) => [d.id, d.ipAddress && d.adbPort ? `${d.ipAddress}:${d.adbPort}` : null])
    );
    // Tenant guard: the device a job targets must belong to the SAME workspace
    // as the job. Without this, a cross-tenant job whose payload names another
    // tenant's device (or a device later transferred between workspaces) would
    // execute arbitrary shell/RPA on the victim's phone. Closes the whole class
    // at the single claim chokepoint.
    const workspaceByDevice = new Map(devices.map((d) => [d.id, d.workspaceId]));

    // Find a candidate PENDING job whose target device is one of THIS host's
    // devices — narrowed in the DB (indexed deviceId column, with emulatorId and
    // the legacy payload.deviceId path as fallbacks) instead of pulling the 25
    // globally-oldest jobs and filtering in JS. The old approach could starve a
    // host whose oldest 25 jobs all belonged to other hosts.
    const candidates = await prisma.job.findMany({
      where: {
        status: 'PENDING',
        claimedByHostId: null,
        OR: [
          { deviceId: { in: deviceIds } },
          { emulatorId: { in: deviceIds } },
          { AND: [{ deviceId: null }, { emulatorId: null }] } // pre-backfill: fall back to JS payload check
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: 25
    });

    for (const job of candidates) {
      const payload = (job.payload as Record<string, unknown>) ?? {};
      const deviceId = (payload.deviceId as string | undefined) ?? job.emulatorId ?? undefined;
      if (!deviceId || !deviceIds.includes(deviceId)) continue;

      // Cross-tenant guard: refuse to run a job on a device that belongs to a
      // different workspace than the job. (Jobs created without a workspace —
      // legacy/internal — are allowed through unchanged.)
      if (job.workspaceId && workspaceByDevice.get(deviceId) !== job.workspaceId) continue;

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

  // Batch claim: hand the agent up to `max` PENDING jobs in ONE round-trip instead
  // of one-job-per-poll. This kills the poll-Hz bottleneck — a burst of N root-DB
  // read jobs (each ~100ms of work) was previously gated by N sequential
  // /agent/jobs/next round-trips (≈ N × POLL_MS wall-clock); now the agent drains
  // them in ⌈N/max⌉ round-trips and runs them concurrently up to its own cap.
  //
  // Same tenant + race guards as claimNext, PLUS one extra invariant: AT MOST ONE
  // job per device per batch. On-device work is serialised per phone (the agent
  // runs one job at a time on a given serial), so claiming 10 jobs for the same
  // device would just make 9 of them sit RUNNING-but-waiting and inflate the
  // stale-reaper's workload. One-per-device keeps the batch spread across phones,
  // which is exactly where the parallelism is. The remaining same-device jobs stay
  // PENDING and get claimed on the next poll once the device frees.
  async claimBatch(host: Host, max: number): Promise<AgentJob[]> {
    const cap = Math.min(Math.max(1, max | 0), 25);
    const devices = await prisma.device.findMany({
      where: { hostId: host.id },
      select: { id: true, ipAddress: true, adbPort: true, workspaceId: true }
    });
    if (devices.length === 0) return [];

    const deviceIds = devices.map((d) => d.id);
    const serialById = new Map(
      devices.map((d) => [d.id, d.ipAddress && d.adbPort ? `${d.ipAddress}:${d.adbPort}` : null])
    );
    const workspaceByDevice = new Map(devices.map((d) => [d.id, d.workspaceId]));

    // Pull a generous candidate window (more than `cap`) so that after skipping
    // same-device duplicates and lost races we still have enough to fill the batch.
    const candidates = await prisma.job.findMany({
      where: {
        status: 'PENDING',
        claimedByHostId: null,
        OR: [
          { deviceId: { in: deviceIds } },
          { emulatorId: { in: deviceIds } },
          { AND: [{ deviceId: null }, { emulatorId: null }] }
        ]
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(cap * 4, 100)
    });

    const claimedJobs: AgentJob[] = [];
    const claimedDevices = new Set<string>();
    for (const job of candidates) {
      if (claimedJobs.length >= cap) break;
      const payload = (job.payload as Record<string, unknown>) ?? {};
      const deviceId = (payload.deviceId as string | undefined) ?? job.emulatorId ?? undefined;
      if (!deviceId || !deviceIds.includes(deviceId)) continue;
      // One job per device per batch (see method doc).
      if (claimedDevices.has(deviceId)) continue;
      // Cross-tenant guard (same as claimNext).
      if (job.workspaceId && workspaceByDevice.get(deviceId) !== job.workspaceId) continue;

      const claimed = await prisma.job.updateMany({
        where: { id: job.id, status: 'PENDING', claimedByHostId: null },
        data: { status: 'RUNNING', claimedByHostId: host.id, claimedAt: new Date(), startedAt: new Date() }
      });
      if (claimed.count === 0) continue; // lost the race; skip

      claimedDevices.add(deviceId);
      claimedJobs.push({
        id: job.id,
        type: job.type,
        payload: this.materializePayload(payload),
        serial: serialById.get(deviceId) ?? null
      });
    }

    return claimedJobs;
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

    // Terminal-state guard: only a RUNNING job may transition to a terminal
    // state. Without this, a job that reapStaleJobs already marked FAILED (after
    // its stale timeout) would be resurrected to COMPLETED when the agent finally
    // reports back — a lie the operator sees. Conditional update flips only if
    // still RUNNING; count===0 means it was already finalized elsewhere.
    const flipped = await prisma.job.updateMany({
      where: { id: jobId, status: 'RUNNING' },
      data: {
        status: outcome.status,
        finishedAt: new Date(),
        ...(outcome.result !== undefined ? { result: outcome.result as object } : {}),
        ...(outcome.error !== undefined ? { error: outcome.error } : {})
      }
    });
    if (flipped.count === 0) {
      throw new AppError('Job already finalized', 409, 'JOB_ALREADY_FINALIZED');
    }
    const updated = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

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
      void notifyWhatsappJob(updated.workspaceId, updated.type, updated.payload, outcome).catch(quiet('notifyWhatsappJob', updated.id));
    }

    // Snapshot capture jobs carry a snapshotId; reflect the outcome onto the
    // snapshot row (READY + artifactRef/size, or FAILED).
    if (updated.type === 'EMULATOR_SNAPSHOT_CREATE') {
      const snapshotId = (updated.payload as { snapshotId?: string } | null)?.snapshotId;
      if (snapshotId) {
        const r = (outcome.result as { artifactRef?: string; sizeBytes?: number } | undefined) ?? null;
        void snapshotService.onCaptureResult(snapshotId, r, outcome.status === 'COMPLETED').catch(quiet('snapshot.onCaptureResult', updated.id));
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
        // Prefer the agent's human-readable Turkish `note` (e.g. "Bu WhatsApp hesabı
        // incelemede…") over the bare status code so the operator sees WHY it failed —
        // both in the chat thread's fail tag and the Telegram/notification below.
        const statusCode = res.status || outcome.error || 'SEND_FAILED';
        const failReason = ok
          ? null
          : (res.note ? `${res.note} (${statusCode})` : String(statusCode));
        // Await the row create so we can carry its id on the webhook (lets an
        // integrator correlate the SENT event — and any later DELIVERED/READ receipt
        // — with the exact message). Best-effort: a failed create leaves messageId
        // undefined but never blocks the rest of the fan-out.
        const outMsg = await prisma.whatsappMessage
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
              // Give each OUT row a unique dedupeKey so a resend to the same peer with
              // the same text isn't silently dropped by any (peer,text)-based dedup and,
              // more importantly, so the row is always distinct. Was previously unset
              // (null) — combined with the swallowed .catch below, failed inserts made
              // sent messages VANISH from the thread ("apiden atınca kayboluyor").
              dedupeKey: sha256(`out|${pl.deviceId}|${outPeer}|${outBody}|${outAt.getTime()}`),
              ...(failReason ? { failReason: String(failReason).slice(0, 200) } : {}),
              waTimestamp: outAt
            },
            select: { id: true }
          })
          // Log the real reason instead of swallowing it — a silently-dropped insert is
          // exactly how the "vanishing outbound message" bug hid for so long.
          .catch((e) => { logger.warn('outbound WhatsappMessage create failed', { error: String(e), deviceId: pl.deviceId, peer: outPeer }); return null; });
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
          { deviceId: pl.deviceId, to: outPeer, status, ...(outMsg ? { messageId: outMsg.id } : {}), ...(failReason ? { failReason: String(failReason) } : {}), ts: outAt.toISOString() },
          updated.workspaceId ?? undefined
        );
        // Account health: a send that fails because the account is in review or
        // banned tells us the account's health, not just this message's fate. Reflect
        // it onto the GeneratedAccount (BANNED / RESTRICTED) + fire the health webhook
        // so the profile card shows it. Monotonic + idempotent inside setAccountHealth.
        // ACCOUNT_RESTRICTED (VERIFIED LIVE mi9 2026-07-23): the chat opens read-only
        // with a "Your account is restricted. You can't start new chats" banner — the
        // account can still reply in existing threads but can't START new chats, and it's
        // typically the pre-ban state. The agent used to return a misleading
        // CHAT_NOT_OPENED here, leaving the account ACTIVE while it silently failed; now
        // it reports ACCOUNT_RESTRICTED and we stamp the health so the profile card shows
        // ⚠️ KISITLANDI and the alert fires. RESTRICTED rank is below BANNED/LOGGED_OUT so
        // it can't clobber a harder state (setAccountHealth is monotonic + idempotent).
        const HEALTH_STATUSES = new Set(['ACCOUNT_BANNED', 'ACCOUNT_REVIEW', 'ACCOUNT_RESTRICTED']);
        if (!ok && HEALTH_STATUSES.has(String(res.status))) {
          void whatsappService
            .setAccountHealth({
              deviceId: pl.deviceId,
              workspaceId: updated.workspaceId ?? null,
              health: res.status === 'ACCOUNT_BANNED' ? 'BANNED' : 'RESTRICTED',
              ...(res.note ? { note: String(res.note) } : {})
            })
            .catch(() => undefined);
        } else if (!ok && !pl.broadcastId) {
          // ★2026-07-23: a send that failed for a TECHNICAL/non-health reason
          // (CHAT_NOT_OPENED, COMPOSE_FAILED, INVALID_RECIPIENT, a timeout, …) used to
          // vanish into a silent WHATSAPP_FAILED webhook — the operator got NO panel or
          // Telegram notice, so a device stuck failing every send (VERIFIED: mi68/watest47
          // returned CHAT_NOT_OPENED across THREE days, unseen) looked healthy. Health
          // reasons already notify via setAccountHealth's alert engine above; here we
          // surface the technical failures too, so nothing fails quietly. The JOB_FAILED
          // alert only fires for status=FAILED jobs — a COMPLETED job whose result is
          // CHAT_NOT_OPENED never triggered it, which is exactly how this hid.
          // SKIP broadcast members (pl.broadcastId): a 100-recipient broadcast with 30
          // failures would fire 30 notifications = spam. The broadcast tracks its own
          // sent/fail counters + reconciles at the end, so per-recipient noise is wrong
          // there. Only per-device (non-broadcast) sends notify individually.
          const failTitle = res.status === 'INVALID_RECIPIENT'
            ? `📵 WhatsApp: numara ulaşılamadı — ${outPeer}`
            : `⚠️ WhatsApp mesajı gönderilemedi — ${pl.deviceId}`;
          const failDetail = `${res.note ? String(res.note) : String(res.status || 'SEND_FAILED')} (hedef ${outPeer}, cihaz ${pl.deviceId}). Kod: ${res.status || outcome.error || 'SEND_FAILED'}`;
          void notificationsService
            .dispatch(updated.workspaceId ?? '', { title: failTitle, detail: failDetail.slice(0, 900) })
            .catch(() => undefined);
          void alertsService
            .evaluate(updated.workspaceId ?? undefined, 'JOB_FAILED', { title: failTitle, detail: failDetail.slice(0, 900) })
            .catch(() => undefined);
        }
        // Update the parent broadcast's counters if this send belonged to one. These
        // are the SINGLE source of truth for sent/fail — counted on the ACTUAL device
        // outcome here, not when the job was merely queued (the dispatcher no longer
        // writes them). Success advances sentCount; failure advances failCount.
        if (pl.broadcastId) {
          const bid = pl.broadcastId;
          void prisma.whatsappBroadcast
            .update({
              where: { id: bid },
              data: ok ? { sentCount: { increment: 1 } } : { failCount: { increment: 1 } }
            })
            // After the counter advances, reconcile: flip to COMPLETED once every
            // recipient has a terminal outcome (sent+fail >= total). This replaces the
            // old unconditional COMPLETED the dispatcher wrote after merely QUEUING all
            // sends (which showed "done" while sends were still executing).
            .then(() => whatsappService.reconcileBroadcast(bid))
            .catch(() => undefined);
        }
        // Notify the operator (Telegram/Slack/Discord) about STANDALONE send outcomes.
        // Failures ALWAYS notify (with the exact reason: account-review / banned /
        // invalid / not-sent) so nothing is missed. Successes notify only when
        // FLEET_NOTIFY_SEND_OK=1 — the operator asked for a per-message "gönderildi ✅"
        // ping during load-testing, but a 1000-recipient blast would spam the channel,
        // so it's opt-in and skipped for broadcasts. Toggle off after testing.
        const notifyOk = process.env.FLEET_NOTIFY_SEND_OK === '1';
        if (!pl.broadcastId && (!ok || notifyOk)) {
          // `updated` is fetched without the device relation, so look up the name
          // separately (only when we're actually going to notify — cheap, keyed on id).
          const dev = await prisma.device.findUnique({ where: { id: pl.deviceId }, select: { name: true } }).catch(() => null);
          const devName = dev?.name;
          const title = ok
            ? `✅ WhatsApp gönderildi — ${outPeer}`
            : `⚠️ WhatsApp gönderilemedi — ${outPeer}`;
          void notificationsService
            .dispatch(updated.workspaceId ?? '', {
              title,
              detail: [
                ok ? '✅ Gönderildi' : `❌ ${failReason ?? statusCode}`,
                `📞 Alıcı: ${outPeer}`,
                devName ? `📱 Cihaz: ${devName}` : '',
                `💬 ${outBody.slice(0, 200)}`
              ].filter(Boolean).join('\n').slice(0, 900)
            })
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
            case 'RATE_LIMITED':
              // RATE_LIMITED: number temporarily locked ("Send SMS in N hours"). Not
              // a hard failure — the operator can retry later, so surface it like an
              // OTP wait (panel shows the code box) with the wait note in `error`.
              // OTP_WAIT: also carry the agent's note (it distinguishes the channel —
              // plain SMS vs "code went to your other phone" vs a rate-limit wait) so
              // the panel's OTP box shows the RIGHT instruction, not a generic "SMS".
              nextStatus = 'AWAITING_OTP';
              if (res.note) error = String(res.note);
              break;
            case 'AWAITING_MANUAL':
              // e.g. the number is already on another phone's WhatsApp and the code
              // went there (move/other-phone verify) — needs a human, not a failure.
              nextStatus = 'AWAITING_MANUAL';
              error = String(res.note ?? 'manuel adım gerekli');
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
        // The step-by-step screenshots the agent captured (bug-tracking) live on
        // Job.result.shots — the dashboard loads them via the account's last
        // REGISTER_WHATSAPP job to show exactly where a failed run stalled.
        // Log a dropped status transition instead of swallowing it: a silently-failed
        // write here leaves the account stuck in REGISTERING while the job shows terminal
        // — an invisible desync. quiet() leaves a diagnosable trail (job id + step).
        void prisma.generatedAccount
          .update({
            where: { id: accountId },
            data: { status: nextStatus, ...(error !== null ? { error } : { error: null }) }
          })
          .catch(quiet('register.status', updated.id));

        // ── Global "operator action needed" alert ────────────────────────────
        // When a registration lands in a state that needs a human (waiting for the
        // OTP code, a code that went to the number's other phone, a manual step) or
        // outright fails, push an `alert.fired` event so the dashboard shows a global
        // toast — even if the operator already closed the WhatsappRegisterModal.
        // Without this the stall was silent: the modal-only `whatsapp.register.progress`
        // event reaches nobody once the modal is closed. (NotificationCenter listens
        // for `alert.fired` on every page; carrying accountId/deviceId lets a future
        // click re-open the code modal.) VERIFIED context: a Pixel 7 stalled on the
        // "Transfer chat history" screen with no panel signal at all.
        const needsAction = nextStatus === 'AWAITING_OTP' || nextStatus === 'AWAITING_MANUAL';
        if (needsAction || nextStatus === 'FAILED') {
          const phone = ((updated.payload as { phoneNumber?: string } | null)?.phoneNumber)
            ?? (outcome.result as { phoneNumber?: string } | undefined)?.phoneNumber
            ?? '';
          const label = phone ? `WhatsApp ${phone}` : 'WhatsApp kaydı';
          const title = needsAction ? `${label} — müdahale gerekiyor` : `${label} — kayıt başarısız`;
          deviceHub.broadcast({
            type: 'alert.fired',
            deviceId: (updated.payload as { deviceId?: string } | null)?.deviceId ?? '',
            payload: {
              id: updated.id,
              title,
              detail: error ?? (needsAction ? 'Kod veya manuel bir adım bekleniyor.' : 'Kayıt tamamlanamadı.'),
              rule: 'wa-register',
              accountId,
              deviceId: (updated.payload as { deviceId?: string } | null)?.deviceId ?? undefined,
              needsAction
            },
            timestamp: new Date().toISOString(),
            workspaceId: updated.workspaceId ?? undefined
          });
        }

        // Webhook lifecycle events — so external integrators can react to the
        // registration flow event-driven instead of polling the status endpoint. Fires
        // AWAITING_OTP (submit a code / pick a method), REGISTERED (ACTIVE), or
        // REGISTER_FAILED (with the reason). Best-effort, workspace-scoped.
        {
          const devId = (updated.payload as { deviceId?: string } | null)?.deviceId;
          const phone = ((updated.payload as { phoneNumber?: string } | null)?.phoneNumber)
            ?? (outcome.result as { phoneNumber?: string } | undefined)?.phoneNumber ?? '';
          const ev =
            nextStatus === 'AWAITING_OTP' || nextStatus === 'AWAITING_MANUAL' ? 'WHATSAPP_AWAITING_OTP'
            : nextStatus === 'ACTIVE' ? 'WHATSAPP_REGISTERED'
            : nextStatus === 'FAILED' ? 'WHATSAPP_REGISTER_FAILED'
            : null;
          if (ev) {
            void webhooksService.dispatch(
              ev,
              { accountId, deviceId: devId, phoneNumber: phone, status: nextStatus, ...(error ? { error } : {}) },
              updated.workspaceId ?? undefined
            );
          }
        }

        // Keep the device's WA-registration badge (metadata) in sync so the
        // profiles card reflects reality: AWAITING_OTP while waiting for the code,
        // CLEARED on a terminal outcome (ACTIVE/FAILED). Only touch the badge if it
        // belongs to THIS account (a newer registration may have replaced it).
        const devId = (updated.payload as { deviceId?: string } | null)?.deviceId;
        if (devId) {
          void prisma.device
            .findUnique({ where: { id: devId }, select: { metadata: true } })
            .then((dev) => {
              const meta = (dev?.metadata ?? {}) as Record<string, unknown>;
              if (meta.waRegisterAccountId !== accountId) return;
              const terminal = nextStatus === 'ACTIVE' || nextStatus === 'FAILED';
              const nextMeta = { ...meta };
              if (terminal) {
                // On SUCCESS, before clearing the transient badge, persist the number to
                // a DURABLE key so the profile card can show "hangi numara gömülü" long
                // after the run ends. The transient waRegisterPhone is wiped below; this
                // one survives. FAILED clears everything (no number is bound).
                if (nextStatus === 'ACTIVE') {
                  const phone = (meta.waRegisterPhone as string) || '';
                  if (phone) {
                    nextMeta.waRegisteredPhone = phone;
                    nextMeta.waRegisteredAt = new Date().toISOString();
                  }
                }
                delete nextMeta.waRegisterStatus;
                delete nextMeta.waRegisterAccountId;
                delete nextMeta.waRegisterPhone;
                delete nextMeta.waRegisterJobId;
              } else {
                nextMeta.waRegisterStatus = nextStatus; // AWAITING_OTP
              }
              return prisma.device.update({ where: { id: devId }, data: { metadata: nextMeta as object } });
            })
            .catch(() => undefined);
        }
      }
    }

    // Instagram registration: reflect the agent's outcome onto the GeneratedAccount
    // row. Unlike WhatsApp there's no operator-OTP step (the agent reads the email
    // code itself), so the terminal states are: CREATED → ACTIVE, a captcha/SMS
    // wall → AWAITING_MANUAL (needs a human), anything else → FAILED.
    if (updated.type === 'REGISTER_INSTAGRAM') {
      const accountId = (updated.payload as { accountId?: string } | null)?.accountId;
      if (accountId) {
        let nextStatus: GeneratedAccountStatus;
        let error: string | null = null;
        if (outcome.status === 'COMPLETED') {
          const res = (outcome.result as { status?: string; note?: string } | undefined) ?? {};
          switch (res.status) {
            case 'CREATED':
            case 'REGISTERED':
            case 'DONE':
            case 'OK':
              nextStatus = 'ACTIVE';
              break;
            case 'CAPTCHA_WALL':
            case 'SMS_WALL':
              nextStatus = 'AWAITING_MANUAL';
              error = String(res.note ?? res.status);
              break;
            default:
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

        // Keep the device's IG-registration badge in sync (clear on any terminal
        // outcome — ACTIVE, AWAITING_MANUAL, or FAILED all end the live panel).
        const devId = (updated.payload as { deviceId?: string } | null)?.deviceId;
        if (devId) {
          void prisma.device
            .findUnique({ where: { id: devId }, select: { metadata: true } })
            .then((dev) => {
              const meta = (dev?.metadata ?? {}) as Record<string, unknown>;
              if (meta.igRegisterAccountId !== accountId) return;
              const nextMeta = { ...meta };
              delete nextMeta.igRegisterStatus;
              delete nextMeta.igRegisterAccountId;
              delete nextMeta.igRegisterEmail;
              delete nextMeta.igRegisterJobId;
              return prisma.device.update({ where: { id: devId }, data: { metadata: nextMeta as object } });
            })
            .catch(() => undefined);
        }
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
          // Event-driven provisioning: fire DEVICE_PROVISIONED so integrators know the
          // device is WhatsApp-ready without polling the provision-status endpoint.
          void webhooksService.dispatch(
            'DEVICE_PROVISIONED',
            { deviceId, ipAddress: r.ip, adbPort: r.adbPort, instance: r.instance },
            updated.workspaceId ?? undefined
          );
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

    // Wake / sleep finished: reflect the real instance state onto the device.
    if (updated.type === 'DEVICE_WAKE' || updated.type === 'DEVICE_SLEEP') {
      const deviceId = (updated.payload as { deviceId?: string } | null)?.deviceId;
      if (deviceId) {
        if (updated.type === 'DEVICE_WAKE' && outcome.status === 'COMPLETED') {
          const r = (outcome.result as { ip?: string; adbPort?: number } | undefined) ?? {};
          await prisma.device
            .update({
              where: { id: deviceId },
              data: {
                status: 'ONLINE',
                ...(r.ip ? { ipAddress: r.ip } : {}),
                ...(r.adbPort ? { adbPort: r.adbPort } : {}),
                lastSeen: new Date()
              }
            })
            .catch(() => undefined);
        } else if (updated.type === 'DEVICE_SLEEP' && outcome.status === 'COMPLETED') {
          await prisma.device.update({ where: { id: deviceId }, data: { status: 'OFFLINE' } }).catch(() => undefined);
        } else if (outcome.status === 'FAILED') {
          await prisma.device.update({ where: { id: deviceId }, data: { status: 'ERROR' } }).catch(() => undefined);
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
    input: { step: string; percent?: number | undefined; note?: string | undefined; status?: string | undefined; accountId?: string | undefined; shot?: string | undefined }
  ): Promise<{ ok: true }> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    if (job.claimedByHostId !== host.id) {
      throw new AppError('Job was not claimed by this host', 403, 'JOB_NOT_CLAIMED');
    }
    const payload = (job.payload ?? {}) as { deviceId?: string; accountId?: string };
    const deviceId = payload.deviceId ?? '';
    // Route by job type: WhatsApp registration progress → its own service (keyed by
    // accountId, may carry a screenshot); everything else → provision progress.
    if (job.type === 'REGISTER_WHATSAPP') {
      const accountId = input.accountId ?? payload.accountId ?? '';
      await waRegisterService.reportProgress(
        {
          accountId,
          deviceId,
          jobId,
          step: input.step,
          ...(input.percent !== undefined ? { percent: input.percent } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.shot !== undefined ? { shot: input.shot } : {})
        },
        job.workspaceId ?? undefined
      );
      return { ok: true };
    }
    if (job.type === 'REGISTER_INSTAGRAM') {
      const accountId = input.accountId ?? payload.accountId ?? '';
      await igRegisterService.reportProgress(
        {
          accountId,
          deviceId,
          jobId,
          step: input.step,
          ...(input.percent !== undefined ? { percent: input.percent } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.shot !== undefined ? { shot: input.shot } : {})
        },
        job.workspaceId ?? undefined
      );
      return { ok: true };
    }
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
    input: { runningPhones?: number | undefined; capacity?: number | undefined; serials?: string[] | undefined; diskTotalGb?: number | undefined; diskFreeGb?: number | undefined; ramFreeGb?: number | undefined; loadAvg1m?: number | undefined; cpuCores?: number | undefined }
  ) {
    const updated = await prisma.host.update({
      where: { id: host.id },
      data: {
        status: 'ONLINE',
        lastSeenAt: new Date(),
        ...(typeof input.runningPhones === 'number' ? { runningPhones: input.runningPhones } : {}),
        ...(typeof input.capacity === 'number' ? { capacity: input.capacity } : {}),
        ...(typeof input.diskTotalGb === 'number' ? { diskTotalGb: input.diskTotalGb } : {}),
        ...(typeof input.diskFreeGb === 'number' ? { diskFreeGb: input.diskFreeGb } : {}),
        ...(typeof input.ramFreeGb === 'number' ? { ramFreeGb: input.ramFreeGb } : {}),
        ...(typeof input.loadAvg1m === 'number' ? { loadAvg1m: input.loadAvg1m } : {}),
        ...(typeof input.cpuCores === 'number' ? { cpuCores: input.cpuCores } : {})
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
        // ERROR is included so a device flagged by an interrupted wake/action
        // heals back to ONLINE the moment it reports as ADB-reachable again (else
        // the stale ERROR badge sticks forever even though the phone is fine).
        status: hasSerials
          ? { in: ['OFFLINE', 'ONLINE', 'STARTING', 'STOPPING', 'REBOOTING', 'UPDATING', 'ERROR'] }
          : { in: ['OFFLINE', 'ONLINE'] }
      },
      select: { id: true, name: true, status: true, lastSeen: true, workspaceId: true, ipAddress: true, adbPort: true }
    });
    // Every device lands in exactly ONE of two buckets — up (→ONLINE + lastSeen) or
    // down (→OFFLINE). Rather than N per-device UPDATEs (100+ round-trips on a big
    // host), collect the two id sets and issue at most TWO bulk updateMany calls.
    // (The old per-device online-minute metering that needed the prior lastSeen was
    // removed with the usage module, so a bulk write is now correct.)
    const upIds: string[] = [];
    const downIds: string[] = [];
    const newlyOnline: Array<{ id: string; name: string; workspaceId: string | null }> = [];
    for (const d of affected) {
      const serial = d.ipAddress && d.adbPort ? `${d.ipAddress}:${d.adbPort}` : null;
      const isUp = hasSerials ? Boolean(serial && reachable.has(serial)) : true;
      if (isUp) {
        upIds.push(d.id);
        if (d.status !== 'ONLINE') newlyOnline.push({ id: d.id, name: d.name, workspaceId: d.workspaceId ?? null });
      } else if (d.status !== 'OFFLINE') {
        downIds.push(d.id);
      }
    }
    // Two bulk writes instead of N. lastSeen advances only for reachable devices; the
    // down set keeps its lastSeen so "last seen" stays meaningful.
    if (upIds.length) {
      await prisma.device.updateMany({ where: { id: { in: upIds } }, data: { status: 'ONLINE', lastSeen: now } }).catch(() => undefined);
    }
    if (downIds.length) {
      await prisma.device.updateMany({ where: { id: { in: downIds } }, data: { status: 'OFFLINE' } }).catch(() => undefined);
    }
    // Fire DEVICE_ONLINE only on a real OFF→ON transition (unchanged semantics).
    for (const d of newlyOnline) {
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
    // ── SCALE: batch the writes instead of 2×N sequential queries per heartbeat ──
    // The old loop did `await device.update` + `await metricPoint.create` PER device,
    // serially — at 500 devices that's 1000 round-trips every heartbeat and the tick
    // falls behind. Now: all metric points go in ONE createMany, and the per-device
    // updates (which carry different values so can't be a single query) run with bounded
    // concurrency instead of strictly serial.
    const targets = input.devices
      .map((m) => ({ m, deviceId: serialToId.get(m.serial) }))
      .filter((t): t is { m: (typeof input.devices)[number]; deviceId: string } => Boolean(t.deviceId));

    // 1) One bulk insert for the timeseries points (best-effort).
    if (targets.length > 0) {
      await prisma.deviceMetricPoint
        .createMany({
          data: targets.map(({ m, deviceId }) => ({
            deviceId,
            cpuUsage: typeof m.cpuUsage === 'number' ? m.cpuUsage : 0,
            memoryUsage: typeof m.memoryUsage === 'number' ? m.memoryUsage : 0,
            diskUsage: typeof m.diskUsage === 'number' ? m.diskUsage : 0,
            capturedAt: now
          }))
        })
        .catch(() => undefined);
    }

    // 2) Per-device updates with bounded concurrency (chunks of 25).
    let updated = 0;
    const CHUNK = 25;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      const results = await Promise.all(
        slice.map(({ m, deviceId }) =>
          prisma.device
            .update({
              where: { id: deviceId },
              data: {
                lastSeen: now,
                ...(typeof m.cpuUsage === 'number' ? { cpuUsage: m.cpuUsage } : {}),
                ...(typeof m.memoryUsage === 'number' ? { memoryUsage: m.memoryUsage } : {}),
                ...(typeof m.diskUsage === 'number' ? { diskUsage: m.diskUsage } : {})
              }
            })
            .then(() => true)
            .catch(() => false) // device may have been deleted between heartbeats — skip
        )
      );
      updated += results.filter(Boolean).length;
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

    // ── WhatsApp SYSTEM notice, not a peer message ───────────────────────────
    // The notification poll also picks up WhatsApp's own account notices (banned /
    // logged-out / can't-use). These arrive shaped like an inbound message but are
    // health signals, not conversation content — so route them to setAccountHealth
    // and DON'T store them as a chat message (that would pollute the thread + unread
    // badge). Match on the body text; the `from` varies ("WhatsApp" / a header).
    const noticeHealth = classifyWaSystemNotice(input.text);
    if (noticeHealth) {
      await whatsappService
        .setAccountHealth({
          deviceId: device.id,
          workspaceId: device.workspaceId ?? null,
          health: noticeHealth,
          note: input.text.slice(0, 200)
        })
        .catch(() => undefined);
      return { stored: false };
    }

    // The agent sends `ts`: for notification-path messages it's WhatsApp's own
    // `when=` (the message's REAL arrival time, ms-precise AND stable across agent
    // restarts); for foreground-scrape messages the agent has no timestamp so it
    // sends Date.now() (which differs every push/restart). We distinguish the two:
    // a "real" ts is used ms-precise in the dedup key (restart-proof + lets two
    // distinct same-text replies in the same minute keep separate keys); a
    // scrape/now ts falls back to the old minute-bucket (best we can do without a
    // real message time). This fixes the load-test bug where every agent restart
    // re-pushed the same old notifications as "new" (minute-bucket drifted each time).
    const hasRealTs = Boolean(input.ts && input.ts > 0);
    const waTimestamp = hasRealTs ? new Date(input.ts as number) : new Date();
    // Keep the plaintext body for the live fan-out (WS/webhook/notification) but
    // store the message body AES-256-GCM encrypted at rest.
    const plainBody = input.text.slice(0, 4096);
    // Canonical peer so an inbound "+90 546…" and an outbound "905…" share ONE thread.
    const peer = normalizePeer(input.from);
    // Idempotency key: a duplicate agent push collides on the unique index and is
    // skipped, so unread never double-counts. Real ts → ms-precise (stable); scrape
    // ts → minute-bucket (near-identical timestamps still dedup within the minute).
    const dedupeStamp = hasRealTs ? String(waTimestamp.getTime()) : `m${Math.floor(waTimestamp.getTime() / 60000)}`;
    const dedupeKey = sha256(`${device.id}|${peer}|${plainBody}|${dedupeStamp}`);

    // Safety net independent of the timestamp: if this EXACT (device, peer, text)
    // was already stored very recently, skip it. WhatsApp's `when=` can occasionally
    // drift and the agent's in-memory seen-set resets on every restart — during load
    // testing that re-pushed the same old notification repeatedly. A short recency
    // guard collapses those without blocking a genuine repeat (a real user re-sending
    // "ok" 30s+ later still lands, since we only look back a few seconds).
    const RECENT_DUP_MS = 8000;
    const recentDup = await prisma.whatsappMessage.findFirst({
      where: {
        deviceId: device.id,
        peer,
        direction: 'IN',
        createdAt: { gte: new Date(Date.now() - RECENT_DUP_MS) }
      },
      select: { id: true, body: true }
    }).catch(() => null);
    if (recentDup) {
      // Body is encrypted; compare by decrypting the small recent candidate.
      const prevPlain = (() => { try { return decryptString(recentDup.body); } catch { return ''; } })();
      if (prevPlain === plainBody) return { stored: false };
    }

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

    // Webhook fan-out for external integrations. Carry the stored messageId so an
    // integrator can correlate the webhook with GET /whatsapp/thread rows and
    // dedupe on it (previously the payload had no stable id to key on).
    void webhooksService.dispatch(
      'WHATSAPP_MESSAGE',
      { deviceId: device.id, deviceName: device.name, messageId: msg.id, from: msg.peer, text: plainBody, ts: msg.waTimestamp.toISOString() },
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

  // Auto-capture: the agent's media poll found a NEW file in the device's WhatsApp
  // Media folder (opt-in FLEET_WA_CAPTURE=1). We fan it out to the operator's webhook
  // + notification channels so they learn about it the moment it lands — before a
  // view-once is opened or a message deleted. We report METADATA only (the bytes stay
  // on-device; the operator pulls them with fetch-media). No DB row / no thread change.
  async mediaCaptured(
    host: Host,
    input: { serial: string; path: string; size: number; kind: string; folder?: string | undefined; ts?: number | undefined }
  ): Promise<{ ok: boolean }> {
    const devices = await prisma.device.findMany({
      where: { hostId: host.id },
      select: { id: true, ipAddress: true, adbPort: true, workspaceId: true, name: true }
    });
    const device = devices.find(
      (d) => d.ipAddress && d.adbPort && `${d.ipAddress}:${d.adbPort}` === input.serial
    );
    if (!device) return { ok: false };
    const fileName = String(input.path).split('/').pop() || '';
    const at = input.ts && input.ts > 0 ? new Date(input.ts) : new Date();

    // Live push to dashboards.
    deviceHub.broadcast({
      type: 'whatsapp.media',
      deviceId: device.id,
      payload: { path: input.path, fileName, size: input.size, kind: input.kind, folder: input.folder ?? '' },
      timestamp: new Date().toISOString(),
      workspaceId: device.workspaceId ?? undefined
    });

    // Webhook fan-out — external integrators subscribe to WHATSAPP_MEDIA_CAPTURED.
    void webhooksService.dispatch(
      'WHATSAPP_MEDIA_CAPTURED',
      { deviceId: device.id, deviceName: device.name, fileName, path: input.path, size: input.size, kind: input.kind, folder: input.folder ?? '', ts: at.toISOString() },
      device.workspaceId ?? undefined
    );

    // Notification channels (Telegram/Slack/Discord) — at-a-glance.
    const kindEmoji = input.kind === 'image' ? '🖼️' : input.kind === 'video' ? '🎬' : input.kind === 'audio' ? '🎤' : input.kind === 'document' ? '📄' : '📎';
    const when = at.toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    void notificationsService
      .dispatch(device.workspaceId ?? '', {
        title: `${kindEmoji} WhatsApp medya yakalandı — ${device.name}`,
        detail: `${kindEmoji} ${input.kind} · ${fileName}\n📁 ${input.folder ?? ''}\n📦 ${(input.size / 1024).toFixed(0)} KB\n🕒 ${when}`.slice(0, 900)
      })
      .catch(() => undefined);

    return { ok: true };
  }

  // Record an outbound delivery receipt the agent read off a sent bubble's tick
  // glyph (✓✓ = DELIVERED, blue = READ). Resolves the device by ADB serial among
  // this host's devices (same mapping as inboundWhatsapp/updateDeviceMetrics), then
  // advances the message status + fires the WHATSAPP_DELIVERED/WHATSAPP_READ webhook
  // via whatsappService.advanceOutboundReceipt (monotonic + idempotent).
  //
  // ⚠️ AGENT SIDE NOT WIRED YET. This is the API endpoint the agent will call once
  // it can read tick state on-device; see advanceOutboundReceipt's TODO(agent). The
  // route (/agent/whatsapp/receipt) + this handler exist so the webhook/enum half is
  // deployable now and only the on-device tick read remains.
  async recordWhatsappReceipt(
    host: Host,
    input: { serial: string; to: string; status: 'DELIVERED' | 'READ'; messageId?: string | undefined; ts?: number | undefined }
  ): Promise<{ advanced: boolean; messageId: string | null }> {
    const devices = await prisma.device.findMany({
      where: { hostId: host.id },
      select: { id: true, ipAddress: true, adbPort: true, workspaceId: true }
    });
    const device = devices.find(
      (d) => d.ipAddress && d.adbPort && `${d.ipAddress}:${d.adbPort}` === input.serial
    );
    if (!device) return { advanced: false, messageId: null };

    return whatsappService.advanceOutboundReceipt({
      deviceId: device.id,
      workspaceId: device.workspaceId ?? null,
      peer: input.to,
      status: input.status,
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.ts && input.ts > 0 ? { at: new Date(input.ts) } : {})
    });
  }

  // Proactive health-watch alert from the host-side wd-health-watch.sh script: a
  // device's real exit IP drifted to the datacenter (proxy leak, imminent ban) or a
  // device went unreachable and was auto-reconnected. We surface it through the SAME
  // channels operators already watch — a webhook event + an alert-rule evaluation
  // (Telegram/Slack/Discord) — instead of the script needing the encrypted channel
  // config. Best-effort: an unresolved device still logs + webhooks.
  async recordHealthAlert(
    host: { id: string; workspaceId: string | null },
    input: { kind: string; instance?: string | undefined; deviceId?: string | undefined; detail: string; fixed?: boolean | undefined }
  ): Promise<{ ok: true }> {
    // ★2026-07-23 (M-3): the monitor's dead-man's-switch heartbeat. wd-health-watch sends
    // this once per run; we stamp Host.lastHealthWatchAt so the offline tick can detect a
    // monitor that has stopped reporting (stale >20min = the proactive layer is down).
    if (input.kind === 'HEALTH_WATCH_HEARTBEAT') {
      await prisma.host.update({ where: { id: host.id }, data: { lastHealthWatchAt: new Date() } }).catch(() => undefined);
      return { ok: true };
    }
    // Resolve the device by explicit id or by metadata.instance so the alert links to it.
    let device: { id: string; name: string; workspaceId: string | null } | null = null;
    if (input.deviceId) {
      device = await prisma.device
        .findUnique({ where: { id: input.deviceId }, select: { id: true, name: true, workspaceId: true } })
        .catch(() => null);
    }
    if (!device && input.instance) {
      device = await prisma.device
        .findFirst({
          where: { metadata: { path: ['instance'], equals: input.instance } },
          select: { id: true, name: true, workspaceId: true }
        })
        .catch(() => null);
    }
    const wsId = device?.workspaceId ?? host.workspaceId ?? undefined;
    const label = device?.name || input.instance || input.deviceId || 'cihaz';
    // ★2026-07-23 (M-6): route each health-watch kind to its OWN AlertTrigger instead of
    // funnelling everything into DEVICE_OFFLINE. Before, an operator couldn't make a
    // proxy-specific rule, and a PROXY_DEAD (redsocks down = active ban risk, the #1 cause
    // of bans) hid inside device-offline noise — and if no DEVICE_OFFLINE rule existed, it
    // fired NOTHING. Also: `fixed === false` means the leak/dead-proxy is STILL live (the
    // device is exiting from the datacenter IP right now) → mark it urgent so it stands out.
    const isProxyKind = input.kind === 'PROXY_LEAK' || input.kind === 'PROXY_DEAD';
    const unresolved = input.fixed === false; // still leaking / still down → needs a human NOW
    const urgent = unresolved ? '🔴 DÜZELTİLEMEDİ — ' : '';
    const title =
      input.kind === 'PROXY_LEAK'
        ? `${urgent}⚠️ Proxy sızıntısı: ${label}${input.fixed ? ' (otomatik düzeltildi)' : ''}`
        : input.kind === 'PROXY_DEAD'
          ? `${urgent}⚠️ Proxy öldü (redsocks): ${label}${input.fixed ? ' (yeniden başlatıldı)' : ''}`
          : input.kind === 'AUTO_RECONNECT'
            ? `🔄 Cihaz yeniden bağlandı: ${label}`
            : input.kind === 'UNREACHABLE'
              ? `⛔ Cihaz erişilemiyor: ${label}`
              : `Sağlık uyarısı: ${label}`;

    logger.warn('health-watch alert', { kind: input.kind, device: label, detail: input.detail, fixed: input.fixed });

    void webhooksService
      .dispatch(
        'WHATSAPP_ACCOUNT_HEALTH',
        {
          kind: input.kind,
          deviceId: device?.id ?? input.deviceId ?? null,
          instance: input.instance ?? null,
          detail: input.detail,
          fixed: Boolean(input.fixed),
          ts: new Date().toISOString()
        },
        wsId
      )
      .catch(() => undefined);

    // Pick the trigger by kind. AUTO_RECONNECT is informational (self-healed) → no alert.
    const trigger: AlertTrigger | null = isProxyKind
      ? 'PROXY_UNHEALTHY'
      : input.kind === 'UNREACHABLE'
        ? 'DEVICE_OFFLINE'
        : null;
    if (trigger) {
      void alertsService
        .evaluate(wsId, trigger, { title, detail: input.detail })
        .catch(() => undefined);
      // An UNRESOLVED proxy problem is an active ban risk — push it unconditionally too
      // (a leaked device shouldn't wait for the operator to have pre-made a rule).
      if (unresolved && isProxyKind) {
        void notificationsService
          .dispatch(wsId ?? '', { title, detail: input.detail.slice(0, 900) })
          .catch(() => undefined);
      }
    }

    return { ok: true };
  }

  // Decrypt any secret fields so the agent receives ready-to-use values. The
  // proxy password is stored AES-256-GCM encrypted; the agent never sees the key.
  // Handles BOTH the top-level SET_PROXY payload (payload.passwordEnc) and the
  // nested PROVISION_DEVICE proxy object (payload.proxy.passwordEnc) so neither ever
  // stores/serves plaintext (GET /jobs/:id) — the plaintext exists only in the
  // materialized copy the agent claims.
  private materializePayload(payload: Record<string, unknown>): Record<string, unknown> {
    // Decrypt any "<field>Enc" secret into "<field>" and strip the ciphertext, so the
    // stored payload / GET /jobs/:id only ever holds ciphertext — the plaintext exists
    // only in the materialized copy the agent claims. Covers proxy passwords AND the
    // register secrets (OTP code, account password) that were previously carried in the
    // clear in Job.payload and leaked via GET /jobs/:id.
    const encPairs: Array<[string, string]> = [
      ['passwordEnc', 'password'],
      ['otpCodeEnc', 'otpCode'],
      ['accountPasswordEnc', 'accountPassword']
    ];
    const decEnc = (obj: Record<string, unknown>): Record<string, unknown> => {
      for (const [encKey, plainKey] of encPairs) {
        if (typeof obj[encKey] === 'string' && obj[encKey]) {
          try {
            obj[plainKey] = decryptString(obj[encKey] as string);
          } catch {
            /* leave it absent if decryption fails */
          }
          delete obj[encKey];
        }
      }
      return obj;
    };
    const out = decEnc({ ...payload });
    if (out.proxy && typeof out.proxy === 'object') {
      out.proxy = decEnc({ ...(out.proxy as Record<string, unknown>) });
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
