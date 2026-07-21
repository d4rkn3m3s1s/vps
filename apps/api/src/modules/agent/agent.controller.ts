import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { agentService } from './agent.service';
import { aiService } from '../ai/ai.service';

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
  kind: z.enum(['PROXY_LEAK', 'AUTO_RECONNECT', 'UNREACHABLE']),
  instance: z.string().min(1).optional(),
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
  res.json({ data: { id: updated.id, status: updated.status, lastSeenAt: updated.lastSeenAt } });
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
