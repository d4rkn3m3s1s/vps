import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { getJob } from '../jobs/jobs.service';
import { deviceAgentService } from './device-agent.service';

const runSchema = z.object({
  deviceId: z.string().min(1),
  goal: z.string().min(3).max(1000),
  maxTurns: z.number().int().min(1).max(30).optional(),
  stealth: z.boolean().optional(),
  useVision: z.boolean().optional()
});

const exploreSchema = z.object({
  deviceId: z.string().min(1),
  packageName: z.string().min(1).max(200),
  maxScreens: z.number().int().min(1).max(60).optional()
});

const listQuerySchema = z.object({ deviceId: z.string().optional() });

// Whether the AI agent is usable (Anthropic key present), so the UI can gate it.
export async function statusHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: { configured: deviceAgentService.configured() } });
}

export async function startRunHandler(req: Request, res: Response): Promise<void> {
  const parsed = runSchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  const data = await deviceAgentService.startRun({
    deviceId: parsed.deviceId,
    goal: parsed.goal,
    ...(workspaceId ? { workspaceId } : {}),
    ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    ...(parsed.maxTurns !== undefined ? { maxTurns: parsed.maxTurns } : {}),
    ...(parsed.stealth !== undefined ? { stealth: parsed.stealth } : {}),
    ...(parsed.useVision !== undefined ? { useVision: parsed.useVision } : {})
  });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'deviceAgent.run.start',
    resourceType: 'device',
    resourceId: parsed.deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { goal: parsed.goal.slice(0, 200), stealth: Boolean(parsed.stealth) }
  });
  res.status(201).json({ data });
}

export async function listRunsHandler(req: Request, res: Response): Promise<void> {
  const { deviceId } = listQuerySchema.parse(req.query);
  const workspaceId = getWorkspaceId(req);
  const data = await deviceAgentService.listRuns(workspaceId, deviceId);
  res.json({ data });
}

export async function getRunHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  const data = await deviceAgentService.getRun(workspaceId, String(req.params.id));
  res.json({ data });
}

export async function cancelRunHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  await deviceAgentService.cancelRun(workspaceId, String(req.params.id));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'deviceAgent.run.cancel',
    resourceType: 'agent_run',
    resourceId: String(req.params.id),
    requestId: req.requestId,
    ip: req.ip
  });
  res.json({ data: { cancelled: true } });
}

export async function exploreHandler(req: Request, res: Response): Promise<void> {
  const parsed = exploreSchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  const data = await deviceAgentService.explore({
    deviceId: parsed.deviceId,
    packageName: parsed.packageName,
    ...(workspaceId ? { workspaceId } : {}),
    ...(parsed.maxScreens !== undefined ? { maxScreens: parsed.maxScreens } : {})
  });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'deviceAgent.explore',
    resourceType: 'device',
    resourceId: parsed.deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { packageName: parsed.packageName }
  });
  res.status(201).json({ data });
}

// Persist an AppMap from a completed APP_EXPLORE job, then return it. The
// dashboard polls the job via /jobs/:id and calls this once COMPLETED.
export async function saveMapHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  const deviceId = String(req.body?.deviceId ?? '');
  const jobId = String(req.body?.jobId ?? '');
  if (!deviceId || !jobId) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'deviceId ve jobId gerekli' } });
    return;
  }
  // Ensure the job belongs to this workspace before persisting.
  const job = await getJob(jobId);
  if (!job || (workspaceId && job.workspaceId && job.workspaceId !== workspaceId)) {
    res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'İş bulunamadı' } });
    return;
  }
  const data = await deviceAgentService.saveMapFromJob(workspaceId, deviceId, jobId);
  res.json({ data });
}

export async function getMapHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  const data = await deviceAgentService.getMap(workspaceId, String(req.params.deviceId));
  res.json({ data });
}

const convertSchema = z.object({ name: z.string().max(80).optional() });

// Turn a finished agent run into a reusable RPA flow.
export async function convertToRpaHandler(req: Request, res: Response): Promise<void> {
  const { name } = convertSchema.parse(req.body ?? {});
  const workspaceId = getWorkspaceId(req);
  const data = await deviceAgentService.convertToRpa(workspaceId, String(req.params.id), name);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'deviceAgent.run.toRpa',
    resourceType: 'agent_run',
    resourceId: String(req.params.id),
    requestId: req.requestId,
    ip: req.ip,
    metadata: { flowId: data.flowId, steps: data.steps }
  });
  res.status(201).json({ data });
}
