import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { batchService } from './batch.service';

function id(req: Request): string {
  const v = req.params.id;
  if (typeof v !== 'string' || !v) throw new AppError('id gereklidir', 400, 'INVALID_ID');
  return v;
}

const createSchema = z.object({
  platform: z.enum(['whatsapp', 'instagram', 'facebook']),
  count: z.coerce.number().int().min(1).max(50),
  countryCode: z.string().length(2).optional()
});

export async function createBatchHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  res.status(201).json({ data: await batchService.createBatch(getWorkspaceId(req), input) });
}

export async function listAccountsHandler(req: Request, res: Response): Promise<void> {
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
  res.json({ data: await batchService.list(getWorkspaceId(req), batchId) });
}

export async function getAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.get(getWorkspaceId(req), id(req)) });
}

export async function provisionAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.provision(getWorkspaceId(req), id(req)) });
}

export async function pollOtpHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.pollOtp(getWorkspaceId(req), id(req)) });
}

const provisionBatchSchema = z.object({ batchId: z.string().min(1) });
export async function provisionBatchHandler(req: Request, res: Response): Promise<void> {
  const { batchId } = provisionBatchSchema.parse(req.body);
  res.json({ data: await batchService.provisionBatch(getWorkspaceId(req), batchId) });
}

const registerSchema = z.object({ deviceId: z.string().min(1) });
export async function registerAccountHandler(req: Request, res: Response): Promise<void> {
  const { deviceId } = registerSchema.parse(req.body);
  res.json({ data: await batchService.registerAccount(getWorkspaceId(req), id(req), deviceId) });
}

export async function cancelAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.cancel(getWorkspaceId(req), id(req)) });
}

export async function deleteAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.remove(getWorkspaceId(req), id(req)) });
}
