import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { rpaService } from './rpa.service';

const stepSchema = z.object({
  type: z.enum(['tap', 'type', 'wait', 'swipe', 'openApp', 'shell', 'keyevent']),
  x: z.number().optional(),
  y: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  text: z.string().optional(),
  ms: z.number().optional(),
  packageName: z.string().optional(),
  command: z.string().optional(),
  keycode: z.number().optional()
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(stepSchema).default([])
});

const updateSchema = createSchema.partial();

const runSchema = z.object({ deviceIds: z.array(z.string()).min(1) });

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Flow id is required', 400, 'INVALID_FLOW_ID');
  return id;
}

export async function listFlowsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await rpaService.list(getWorkspaceId(req)) });
}

export async function getFlowHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await rpaService.get(requireId(req)) });
}

export async function createFlowHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const flow = await rpaService.create(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'rpa.create',
    resourceType: 'rpa_flow',
    resourceId: flow.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { name: input.name, steps: input.steps.length }
  });
  res.status(201).json({ data: flow });
}

export async function updateFlowHandler(req: Request, res: Response): Promise<void> {
  const input = updateSchema.parse(req.body);
  res.json({ data: await rpaService.update(requireId(req), input) });
}

export async function deleteFlowHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await rpaService.remove(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'rpa.delete',
    resourceType: 'rpa_flow',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}

export async function runFlowHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const { deviceIds } = runSchema.parse(req.body);
  const result = await rpaService.run(id, deviceIds);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'rpa.run',
    resourceType: 'rpa_flow',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { devices: deviceIds.length }
  });
  res.status(201).json({ data: result });
}
