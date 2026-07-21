import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { deviceHub } from '../devices/device.hub';
import { AppError } from '../../lib/errors';

// ── Live WhatsApp-registration progress (mirrors provision.service) ─────────────
//
// The host agent's registerWhatsApp reports each step to /agent/jobs/:id/progress;
// agent.service routes REGISTER_WHATSAPP progress here. We broadcast a
// `whatsapp.register.progress` WS event (so the dashboard modal watches live) and
// persist the log on the GeneratedAccount row (NOT the Job — Job.result is
// overwritten on completion). Correlation is by accountId: the flow spans two jobs
// (number-entry, then OTP) that both carry accountId, giving one continuous panel.

export type WaStepKey =
  | 'queued'
  | 'perms'
  | 'a11y'
  | 'launch'
  | 'eula'
  | 'register'
  | 'number'
  | 'submit'
  | 'verify'
  | 'otp_wait'
  | 'otp'
  | 'profile'
  | 'done';

export type WaStep = { key: WaStepKey; label: string; percent: number };

// Step plan + target percentages. The agent reports these keys; we broadcast the
// agent's percent when present, else this fallback.
export const WA_REGISTER_STEPS: WaStep[] = [
  { key: 'queued', label: 'Kuyruğa alındı', percent: 3 },
  { key: 'perms', label: 'İzinler veriliyor', percent: 8 },
  { key: 'a11y', label: 'Erişilebilirlik + klavye', percent: 15 },
  { key: 'launch', label: 'WhatsApp açılıyor', percent: 25 },
  { key: 'eula', label: 'EULA / uyarılar', percent: 35 },
  { key: 'register', label: 'Yeni hesap kaydı (⋮ menü)', percent: 50 },
  { key: 'number', label: 'Numara giriliyor', percent: 62 },
  { key: 'submit', label: 'Numara onayı (Next → Yes)', percent: 72 },
  { key: 'verify', label: 'Doğrulama yöntemi (SMS)', percent: 80 },
  { key: 'otp_wait', label: 'SMS kodu bekleniyor', percent: 85 },
  { key: 'otp', label: 'SMS kodu giriliyor', percent: 90 },
  { key: 'profile', label: 'Profil ismi', percent: 96 },
  { key: 'done', label: 'Kayıt tamamlandı (sohbet ekranı)', percent: 100 }
];

export type WaProgressStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export type WaRegisterProgress = {
  accountId: string;
  deviceId: string;
  jobId: string;
  step: WaStepKey;
  label: string;
  percent: number;
  status: WaProgressStatus;
  note?: string | undefined;
  // Optional downscaled base64 JPEG screenshot for the "SS göster" toggle.
  shot?: string | undefined;
};

function stepFor(key: string): WaStep {
  return WA_REGISTER_STEPS.find((s) => s.key === key) ?? WA_REGISTER_STEPS[0]!;
}

export class WaRegisterService {
  async reportProgress(
    input: {
      accountId: string;
      deviceId: string;
      jobId: string;
      step: string;
      percent?: number | undefined;
      status?: string | undefined;
      note?: string | undefined;
      shot?: string | undefined;
    },
    workspaceId?: string
  ): Promise<WaRegisterProgress> {
    const st = stepFor(input.step);
    const status: WaProgressStatus =
      input.status === 'COMPLETED' || input.status === 'FAILED' ? input.status : 'RUNNING';
    const percent =
      typeof input.percent === 'number' && input.percent >= 0 && input.percent <= 100
        ? Math.round(input.percent)
        : st.percent;
    const event: WaRegisterProgress = {
      accountId: input.accountId,
      deviceId: input.deviceId,
      jobId: input.jobId,
      step: st.key,
      label: st.label,
      percent,
      status,
      ...(input.note ? { note: input.note } : {}),
      ...(input.shot ? { shot: input.shot } : {})
    };
    this.broadcast(event, workspaceId);
    // Persist WITHOUT the (large) shot so the account row stays small; the live
    // screenshot is only pushed over the WS, not stored.
    const { shot: _omit, ...persisted } = event;
    void _omit;
    if (input.accountId) await this.appendLog(input.accountId, persisted).catch(() => undefined);
    // ★A parked OTP_WAIT account whose device later hit the registration wall (the agent's
    // otpWatch reports step=device_wall, status=FAILED AFTER the register job already
    // COMPLETED into OTP_WAIT). The job-complete path can't flip it (that job is done), so
    // do it here: move the account off AWAITING_OTP to FAILED with the wall reason, so the
    // panel stops showing "SMS bekleniyor" forever.
    if (input.accountId && status === 'FAILED' && input.step === 'device_wall') {
      await prisma.generatedAccount
        .updateMany({
          where: { id: input.accountId, status: 'AWAITING_OTP' },
          data: { status: 'FAILED', error: (input.note ?? 'WhatsApp kaydı engellendi (device wall)').slice(0, 500) }
        })
        .catch(() => undefined);
      // ALSO clear the device's stale metadata.waRegisterStatus (it was left at
      // AWAITING_OTP when the register job parked into OTP_WAIT). Without this the
      // profile CARD keeps showing "kayıt sürüyor" even though the account is FAILED —
      // the card reads metadata.waRegisterStatus, not the account row. Merge-update so
      // the other metadata keys (instance/proxy/provision) are preserved.
      if (input.deviceId) {
        const dev = await prisma.device.findUnique({ where: { id: input.deviceId }, select: { metadata: true } }).catch(() => null);
        if (dev) {
          const md = { ...((dev.metadata as Record<string, unknown>) ?? {}), waRegisterStatus: 'FAILED' };
          await prisma.device.update({ where: { id: input.deviceId }, data: { metadata: md as Prisma.InputJsonValue } }).catch(() => undefined);
        }
      }
    }
    return event;
  }

  // A heartbeat frame is the agent's ~5s live-thumbnail tick: it carries the current
  // step/percent + the note '🎥 canlı' (and, over WS, a shot) purely to keep the panel's
  // live view fresh. It is NOT a state transition. Recognizing it lets us keep it OUT of
  // the persisted lastProgress/log so it can't overwrite a meaningful parked-state note
  // (e.g. the "🔀 Doğrulama yöntemi seçin…" method-select prompt or "📲 SMS kodu
  // bekleniyor") — which was making the panel miss the method-select UI and fall back to
  // a plain OTP box. The live frame still reaches the panel via the WS broadcast above.
  private isHeartbeatFrame(event: { note?: string | undefined }): boolean {
    return (event.note ?? '') === '🎥 canlı';
  }

  // A '📸 <label>' frame is a screenshot snapshot, NOT a state change. It should appear in
  // the log but must NOT become lastProgress — otherwise a '📸 choose_verify' arriving
  // after the "🔀 Doğrulama yöntemi seçin" prompt would clobber the parked-state note the
  // panel keys the method-select buttons off of (bug reported live: buttons vanished).
  private isSnapFrame(event: { note?: string | undefined }): boolean {
    return (event.note ?? '').startsWith('📸');
  }

  // Append to GeneratedAccount.registerLog = { log: [...capped], lastProgress }.
  private async appendLog(accountId: string, event: Omit<WaRegisterProgress, 'shot'>): Promise<void> {
    // Heartbeat frames are transient live-view ticks — never persist them at all.
    if (this.isHeartbeatFrame(event)) return;
    const acc = await prisma.generatedAccount.findUnique({ where: { id: accountId }, select: { registerLog: true } });
    if (!acc) return;
    const cur = (acc.registerLog ?? {}) as Record<string, unknown>;
    const log = Array.isArray(cur.log) ? (cur.log as unknown[]) : [];
    log.push({
      ts: new Date().toISOString(),
      step: event.step,
      percent: event.percent,
      status: event.status,
      ...(event.note ? { note: event.note } : {})
    });
    const trimmed = log.slice(-200);
    // Snap frames go into the log but PRESERVE the existing lastProgress (don't overwrite
    // it with the screenshot note). Everything else updates lastProgress normally.
    const nextLastProgress = this.isSnapFrame(event) ? (cur.lastProgress ?? event) : event;
    await prisma.generatedAccount.update({
      where: { id: accountId },
      data: { registerLog: { log: trimmed, lastProgress: nextLastProgress } as Prisma.InputJsonValue }
    });
  }

  // Simple, integration-friendly phase for polling. Maps the fine-grained step +
  // account status to the state-machine an external API caller cares about:
  //   starting → waiting_phone → waiting_sms → opened  (or failed).
  // (waiting_phone = agent is at the number-entry screen; waiting_sms = it's
  // parked on the SMS-code screen; opened = account is live.)
  private phaseFor(accountStatus: string, step?: string): 'starting' | 'waiting_phone' | 'waiting_sms' | 'opened' | 'failed' {
    if (accountStatus === 'ACTIVE') return 'opened';
    if (accountStatus === 'FAILED') return 'failed';
    if (accountStatus === 'AWAITING_OTP' || step === 'otp_wait') return 'waiting_sms';
    if (step === 'number' || step === 'submit' || step === 'register') return 'waiting_phone';
    return 'starting';
  }

  // Modal restore + external polling: persisted log + last progress + a coarse
  // `phase` for integrations.
  async getStatus(
    accountId: string,
    workspaceId?: string
  ): Promise<{
    accountId: string;
    deviceId: string;
    status: string;
    phase: 'starting' | 'waiting_phone' | 'waiting_sms' | 'opened' | 'failed';
    percent: number;
    steps: WaStep[];
    lastProgress: Omit<WaRegisterProgress, 'shot'> | null;
    log: unknown[];
    startedAt: string | null;
  }> {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id: accountId, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, status: true, deviceId: true, registerLog: true }
    });
    // AppError (not a bare Error) so an unknown/foreign accountId returns 404, not a
    // 500. The public /register/:id/status endpoint is polled in a loop; a wrong id
    // previously threw a plain Error → 500 INTERNAL + 5xx log noise on every poll.
    if (!acc) throw new AppError('Hesap bulunamadı', 404, 'ACCOUNT_NOT_FOUND');
    const rl = (acc.registerLog ?? {}) as Record<string, unknown>;
    const last = (rl.lastProgress as Omit<WaRegisterProgress, 'shot'>) ?? null;
    const log = Array.isArray(rl.log) ? (rl.log as unknown[]) : [];
    // The FIRST log line's ts is when this registration actually began, so the modal
    // shows the real elapsed time no matter WHEN the operator opens it — it was
    // previously counting from modal-open, which reset to 00:00 on every reopen.
    const first = log[0] as { ts?: string } | undefined;
    return {
      accountId: acc.id,
      deviceId: acc.deviceId ?? '',
      status: acc.status,
      phase: this.phaseFor(acc.status, last?.step),
      percent: last?.percent ?? 0,
      steps: WA_REGISTER_STEPS,
      lastProgress: last,
      log,
      startedAt: (first?.ts as string) ?? null
    };
  }

  private broadcast(event: WaRegisterProgress, workspaceId?: string): void {
    deviceHub.broadcast({
      type: 'whatsapp.register.progress',
      deviceId: event.deviceId,
      payload: event,
      timestamp: new Date().toISOString(),
      ...(workspaceId ? { workspaceId } : {})
    });
  }
}

export const waRegisterService = new WaRegisterService();
