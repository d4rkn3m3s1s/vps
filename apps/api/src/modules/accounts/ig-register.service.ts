import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { deviceHub } from '../devices/device.hub';

// ── Live Instagram-registration progress (mirrors wa-register.service) ──────────
//
// The host agent's registerInstagram reports each step to /agent/jobs/:id/progress;
// agent.service routes REGISTER_INSTAGRAM progress here. We broadcast an
// `instagram.register.progress` WS event (dashboard modal watches live) and
// persist the log on the GeneratedAccount row. Unlike WhatsApp, Instagram's OTP
// arrives by email and the agent reads it from catchmail automatically, so there
// is NO operator-OTP step — the flow is fully autonomous up to a CAPTCHA/SMS wall.

export type IgStepKey =
  | 'queued'
  | 'perms'
  | 'launch'
  | 'signup'
  | 'email'
  | 'code_wait'
  | 'code'
  | 'password'
  | 'birthday'
  | 'name'
  | 'username'
  | 'terms'
  | 'done'
  | 'wall';

export type IgStep = { key: IgStepKey; label: string; percent: number };

// Step plan + target percentages. The agent reports these keys; we broadcast the
// agent's percent when present, else this fallback.
export const IG_REGISTER_STEPS: IgStep[] = [
  { key: 'queued', label: 'Kuyruğa alındı', percent: 3 },
  { key: 'perms', label: 'İzinler veriliyor', percent: 8 },
  { key: 'launch', label: 'Instagram açılıyor', percent: 18 },
  { key: 'signup', label: 'E-posta ile kayıt', percent: 28 },
  { key: 'email', label: 'E-posta giriliyor', percent: 38 },
  { key: 'code_wait', label: 'Doğrulama kodu bekleniyor (e-posta)', percent: 48 },
  { key: 'code', label: 'Kod giriliyor', percent: 56 },
  { key: 'password', label: 'Şifre oluşturuluyor', percent: 64 },
  { key: 'birthday', label: 'Doğum tarihi', percent: 72 },
  { key: 'name', label: 'İsim giriliyor', percent: 80 },
  { key: 'username', label: 'Kullanıcı adı', percent: 88 },
  { key: 'terms', label: 'Şartlar kabul (hesap oluşturuluyor)', percent: 94 },
  { key: 'done', label: 'Hesap oluşturuldu', percent: 100 },
  // `wall` is a terminal-but-not-success step: IG demanded captcha / SMS.
  { key: 'wall', label: 'Doğrulama duvarı (captcha/SMS)', percent: 100 }
];

export type IgProgressStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export type IgRegisterProgress = {
  accountId: string;
  deviceId: string;
  jobId: string;
  step: IgStepKey;
  label: string;
  percent: number;
  status: IgProgressStatus;
  note?: string | undefined;
  // Optional downscaled base64 JPEG screenshot for the "SS göster" toggle.
  shot?: string | undefined;
};

function stepFor(key: string): IgStep {
  return IG_REGISTER_STEPS.find((s) => s.key === key) ?? IG_REGISTER_STEPS[0]!;
}

export class IgRegisterService {
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
  ): Promise<IgRegisterProgress> {
    const st = stepFor(input.step);
    const status: IgProgressStatus =
      input.status === 'COMPLETED' || input.status === 'FAILED' ? input.status : 'RUNNING';
    const percent =
      typeof input.percent === 'number' && input.percent >= 0 && input.percent <= 100
        ? Math.round(input.percent)
        : st.percent;
    const event: IgRegisterProgress = {
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
    // Persist WITHOUT the (large) shot; the live screenshot is only pushed over WS.
    const { shot: _omit, ...persisted } = event;
    void _omit;
    if (input.accountId) await this.appendLog(input.accountId, persisted).catch(() => undefined);
    return event;
  }

  // Append to GeneratedAccount.registerLog = { log: [...capped], lastProgress }.
  private async appendLog(accountId: string, event: Omit<IgRegisterProgress, 'shot'>): Promise<void> {
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
    await prisma.generatedAccount.update({
      where: { id: accountId },
      data: { registerLog: { log: trimmed, lastProgress: event } as Prisma.InputJsonValue }
    });
  }

  // Coarse phase for polling / integrations:
  //   starting → running → waiting_wall → opened  (or failed).
  // waiting_wall = account was created but IG demanded captcha/SMS (needs a human).
  private phaseFor(accountStatus: string, step?: string): 'starting' | 'running' | 'waiting_wall' | 'opened' | 'failed' {
    if (accountStatus === 'ACTIVE') return 'opened';
    if (accountStatus === 'FAILED') return 'failed';
    if (accountStatus === 'AWAITING_MANUAL' || step === 'wall') return 'waiting_wall';
    if (step && step !== 'queued') return 'running';
    return 'starting';
  }

  // Modal restore + external polling: persisted log + last progress + coarse phase.
  async getStatus(
    accountId: string,
    workspaceId?: string
  ): Promise<{
    accountId: string;
    deviceId: string;
    status: string;
    phase: 'starting' | 'running' | 'waiting_wall' | 'opened' | 'failed';
    percent: number;
    steps: IgStep[];
    lastProgress: Omit<IgRegisterProgress, 'shot'> | null;
    log: unknown[];
  }> {
    const acc = await prisma.generatedAccount.findFirst({
      where: { id: accountId, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true, status: true, deviceId: true, registerLog: true }
    });
    if (!acc) throw new Error('account not found');
    const rl = (acc.registerLog ?? {}) as Record<string, unknown>;
    const last = (rl.lastProgress as Omit<IgRegisterProgress, 'shot'>) ?? null;
    return {
      accountId: acc.id,
      deviceId: acc.deviceId ?? '',
      status: acc.status,
      phase: this.phaseFor(acc.status, last?.step),
      percent: last?.percent ?? 0,
      steps: IG_REGISTER_STEPS,
      lastProgress: last,
      log: Array.isArray(rl.log) ? (rl.log as unknown[]) : []
    };
  }

  private broadcast(event: IgRegisterProgress, workspaceId?: string): void {
    deviceHub.broadcast({
      type: 'instagram.register.progress',
      deviceId: event.deviceId,
      payload: event,
      timestamp: new Date().toISOString(),
      ...(workspaceId ? { workspaceId } : {})
    });
  }
}

export const igRegisterService = new IgRegisterService();
