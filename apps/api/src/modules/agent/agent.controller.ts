import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { agentService } from './agent.service';
import { aiService } from '../ai/ai.service';
import { abandonHostClaimedJobs } from '../jobs/jobs.service';

const completeSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
  result: z.unknown().optional(),
  error: z.string().optional()
});

const heartbeatSchema = z.object({
  runningPhones: z.coerce.number().int().nonnegative().optional(),
  capacity: z.coerce.number().int().nonnegative().optional(),
  // ADB serials currently reachable on the host (ip:port). When present, only
  // these phones are marked ONLINE and the rest OFFLINE.
  serials: z.array(z.string()).optional(),
  // Host-level disk/RAM (GB) for the "how many more devices fit" estimate.
  diskTotalGb: z.coerce.number().int().nonnegative().optional(),
  diskFreeGb: z.coerce.number().int().nonnegative().optional(),
  ramFreeGb: z.coerce.number().int().nonnegative().optional(),
  // 1-minute load average (may be fractional) + CPU count → CPU saturation gauge.
  loadAvg1m: z.coerce.number().nonnegative().optional(),
  cpuCores: z.coerce.number().int().positive().optional()
});

const deviceMetricsSchema = z.object({
  devices: z
    .array(
      z.object({
        serial: z.string().min(1),
        cpuUsage: z.coerce.number().min(0).max(100).optional(),
        memoryUsage: z.coerce.number().min(0).max(100).optional(),
        diskUsage: z.coerce.number().min(0).max(100).optional()
      })
    )
    .default([])
});

// Vision fallback: agent sends a downscaled screenshot when its uiautomator dump
// is empty/garbled, and asks where to tap for `target`. The Anthropic key lives
// here (server-side) — the zero-dep agent never holds it. `image` is a base64
// JPEG (no data: prefix), bounded ~1.5MB (a ~400px downscaled JPEG is ~15-40KB;
// the ceiling just protects against a full-res upload).
const visionAnalyzeSchema = z.object({
  image: z.string().min(1).max(1_500_000),
  target: z.string().min(1).max(300),
  hint: z.string().max(300).optional()
});

const whatsappInboundSchema = z.object({
  serial: z.string().min(1),
  from: z.string().min(1),
  text: z.string().min(1),
  ts: z.coerce.number().int().nonnegative().optional()
});

// Agent reports a NEW media file its capture poll found on-device (metadata only).
const mediaCapturedSchema = z.object({
  serial: z.string().min(1),
  path: z.string().min(1),
  size: z.coerce.number().int().nonnegative(),
  kind: z.string().min(1).max(20),
  folder: z.string().max(120).optional(),
  ts: z.coerce.number().int().nonnegative().optional()
});

// Agent reports an outbound delivery receipt read off a sent bubble (✓✓ / blue).
// AGENT SIDE NOT WIRED YET — the endpoint + validation exist so the webhook/enum
// half is deployable; the on-device tick read is the remaining TODO.
const whatsappReceiptSchema = z.object({
  serial: z.string().min(1),
  to: z.string().min(1),
  status: z.enum(['DELIVERED', 'READ']),
  messageId: z.string().min(1).optional(),
  ts: z.coerce.number().int().nonnegative().optional()
});

const healthAlertSchema = z.object({
  // ★2026-07-23 (Faz-4): + PROXY_DEAD (dead redsocks — health-watch already emits it) and
  // HEALTH_WATCH_HEARTBEAT (dead-man's-switch ping). Without these the API 400'd them.
  // 2026-07-28: + CANARY_FAILED (gunluk uctan-uca kurulum dogrulamasi patladi). Bu enum'da
  // OLMADIGI icin canary'nin alarmi 400 ile REDDEDILIYORDU -> operator hicbir sey gormuyordu.
  kind: z.enum(['PROXY_LEAK', 'PROXY_DEAD', 'AUTO_RECONNECT', 'UNREACHABLE', 'HEALTH_WATCH_HEARTBEAT', 'CANARY_FAILED']),
  // notify() always sends "instance":"..." — for HEALTH_WATCH_HEARTBEAT it's "" (empty),
  // so accept empty and normalize to undefined instead of rejecting with a 400.
  instance: z.string().optional().transform((v) => (v && v.length ? v : undefined)),
  deviceId: z.string().min(1).optional(),
  detail: z.string().min(1).max(500),
  fixed: z.coerce.boolean().optional()
});

const progressSchema = z.object({
  step: z.string().min(1),
  percent: z.coerce.number().min(0).max(100).optional(),
  note: z.string().max(500).optional(),
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']).optional(),
  // WhatsApp register: correlates the two register jobs into one panel; shot is a
  // downscaled base64 JPEG for the live "SS göster" toggle (bounded ~700KB).
  accountId: z.string().max(60).optional(),
  shot: z.string().max(700000).optional()
});

function requireHost(req: Request) {
  if (!req.hostAgent) throw new AppError('Host agent not authenticated', 401, 'UNAUTHORIZED');
  return req.hostAgent;
}

// Agent long-polls this for the next job to run. Returns { data: null } when idle.
export async function claimNextJobHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const job = await agentService.claimNext(host);
  res.json({ data: job });
}

// Batch claim: return up to ?max (default 8, capped at 25) PENDING jobs in one
// round-trip so the agent can drain a burst without one poll per job. Falls back
// gracefully — an agent that doesn't send ?max still gets a sane default.
export async function claimJobsBatchHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const raw = Number(req.query.max);
  const max = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
  const jobs = await agentService.claimBatch(host, max);
  res.json({ data: jobs });
}

// ★2026-07-23 (S-1): agent calls this on STARTUP to release the jobs it had claimed
// before it restarted — retryable ones go back to PENDING, stateful ones FAIL. Frees the
// device immediately instead of waiting 4-15min for the reaper. Host-scoped.
export async function abandonClaimedHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const result = await abandonHostClaimedJobs(host.id);
  res.json({ data: result });
}

export async function completeJobHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const jobId = req.params.id;
  if (typeof jobId !== 'string') throw new AppError('Job id is required', 400, 'INVALID_JOB_ID');
  const input = completeSchema.parse(req.body);
  res.json({ data: await agentService.complete(host, jobId, input) });
}

// Agent reports one provision sub-step; we normalize + broadcast it as a
// `provision.progress` WS event so the dashboard wizard updates live.
export async function agentProgressHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const jobId = req.params.id;
  if (typeof jobId !== 'string') throw new AppError('Job id is required', 400, 'INVALID_JOB_ID');
  const input = progressSchema.parse(req.body);
  res.json({ data: await agentService.reportProgress(host, jobId, input) });
}

export async function agentHeartbeatHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = heartbeatSchema.parse(req.body);
  const updated = await agentService.heartbeat(host, input);
  // ★2026-07-24: return this host's KNOWN instance names so the agent's orphan-reaper can
  // destroy Waydroid instances that are running on the host but no longer exist in the DB
  // (e.g. a delete whose DEVICE_DESTROY job was lost, or a legacy device removed before the
  // destroy path existed). The agent only reaps an instance absent from THIS list, and only
  // after a grace window, so a just-provisioned instance not yet in the DB is never killed.
  const instances = await agentService.listHostInstances(host).catch(() => null);
  res.json({
    data: {
      id: updated.id,
      status: updated.status,
      lastSeenAt: updated.lastSeenAt,
      ...(instances ? { instances } : {})
    }
  });
}

// Agent reports per-device CPU/mem/disk; we map serial -> deviceId and persist.
export async function updateDeviceMetricsHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = deviceMetricsSchema.parse(req.body);
  res.json({ data: await agentService.updateDeviceMetrics(host, input) });
}

// Agent pushes an inbound WhatsApp message (captured from device notifications);
// we persist it and fan out to WS / webhook / notification channels.
export async function whatsappInboundHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = whatsappInboundSchema.parse(req.body);
  res.json({ data: await agentService.inboundWhatsapp(host, input) });
}

// Agent's media-capture poll reports a NEW file in the WhatsApp Media folder; we fan
// it out to webhook / notification / WS (metadata only — bytes stay on-device).
export async function mediaCapturedHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = mediaCapturedSchema.parse(req.body);
  res.json({ data: await agentService.mediaCaptured(host, input) });
}

// Agent pushes an outbound delivery receipt (message DELIVERED/READ on the peer's
// phone). We advance the message status + fire WHATSAPP_DELIVERED / WHATSAPP_READ.
// (Agent-side tick read is a TODO; see agentService.recordWhatsappReceipt.)
export async function whatsappReceiptHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = whatsappReceiptSchema.parse(req.body);
  res.json({ data: await agentService.recordWhatsappReceipt(host, input) });
}

// Proactive health-watch alert (wd-health-watch.sh → here). Reports a proxy leak
// (device drifted to the datacenter exit IP) or an auto-reconnect, so operators get a
// Telegram/webhook ping. Requires host-agent auth like every /agent/* route.
export async function healthAlertHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = healthAlertSchema.parse(req.body);
  res.json({ data: await agentService.recordHealthAlert(host, input) });
}

// Vision fallback: locate a tap target on a screenshot the agent couldn't parse
// via uiautomator. Requires host-agent auth (same as every /agent/* route).
export async function visionAnalyzeHandler(req: Request, res: Response): Promise<void> {
  requireHost(req);
  const input = visionAnalyzeSchema.parse(req.body);
  const result = await aiService.locateOnScreen(input.image, input.target, input.hint);
  res.json({ data: result });
}
