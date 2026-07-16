import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { createJobRecord, getJob, listJobs } from './jobs.service';
import { JobTypes } from './job.types';

const jobQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25)
});

const createJobSchema = z.object({
  type: z.enum(JobTypes),
  emulatorId: z.string().optional(),
  payload: z.record(z.any()).optional()
});

function requireJobId(req: Request): string {
  const jobId = req.params.id;
  if (typeof jobId !== 'string') {
    throw new AppError('Job id is required', 400, 'INVALID_JOB_ID');
  }

  return jobId;
}

export async function getJobsHandler(req: Request, res: Response): Promise<void> {
  const { limit } = jobQuerySchema.parse(req.query);
  // Limit is applied in the DB query (take), not by slicing a full fetch.
  const jobs = await listJobs(getWorkspaceId(req), limit);
  res.json({ data: jobs });
}

export async function getJobHandler(req: Request, res: Response): Promise<void> {
  const job = await getJob(requireJobId(req), getWorkspaceId(req));
  if (!job) {
    res.status(404).json({ error: 'JOB_NOT_FOUND', message: 'Job not found' });
    return;
  }

  res.json({ data: job });
}


export async function createJobHandler(req: Request, res: Response): Promise<void> {
  const input = createJobSchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  // Dashboard sends a Device id (or none). Job.emulatorId is a FK to the
  // Emulator table, so we carry the target id in the payload instead of as the
  // FK to avoid a foreign-key violation.
  const payload = { ...(input.payload ?? {}), ...(input.emulatorId ? { deviceId: input.emulatorId } : {}) };
  // Cross-tenant guard: a job targeting a device id (or carrying a deviceId in
  // its payload) must target a device in the CALLER's workspace — otherwise an
  // attacker could run arbitrary shell/RPA on another tenant's phone via POST /jobs.
  const targetDeviceId = input.emulatorId ?? (typeof (input.payload as { deviceId?: unknown })?.deviceId === 'string' ? (input.payload as { deviceId: string }).deviceId : undefined);
  if (targetDeviceId) {
    // Fail-CLOSED: a device-targeting job REQUIRES a workspace. A workspace-less token
    // (issued when the user has no active workspace) would otherwise create a
    // workspaceId=null job that the agent's claimNext guard lets run on ANY device
    // (that guard is intentionally lax for legacy/internal jobs). Requiring the
    // workspace here closes the root of the apks/RPA cross-tenant fail-open.
    if (!workspaceId) throw new AppError('Workspace required', 403, 'WORKSPACE_REQUIRED');
    const owned = await prisma.device.findFirst({ where: { id: targetDeviceId, workspaceId }, select: { id: true } });
    if (!owned) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
  }
  // Cross-tenant WRITE guard: a payload.accountId is written back at completion time
  // (agent.complete → generatedAccount.update). Verify it belongs to the caller's
  // workspace, else an attacker could flip another tenant's account to FAILED by
  // targeting their own device with payload.accountId=<victim account>.
  const payloadAccountId = typeof (payload as { accountId?: unknown }).accountId === 'string' ? (payload as { accountId: string }).accountId : undefined;
  if (payloadAccountId && workspaceId) {
    const ownedAcc = await prisma.generatedAccount.findFirst({ where: { id: payloadAccountId, workspaceId }, select: { id: true } });
    if (!ownedAcc) throw new AppError('Account not found', 404, 'ACCOUNT_NOT_FOUND');
  }
  const job = await createJobRecord(input.type, payload, undefined, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'job.create',
    resourceType: 'job',
    resourceId: job.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { type: input.type }
  });
  res.status(201).json({ data: job });
}
