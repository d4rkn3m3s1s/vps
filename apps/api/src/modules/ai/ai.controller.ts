import type { Request, Response } from 'express';
import { z } from 'zod';
import { writeAuditLog } from '../audit/audit.service';
import { aiService } from './ai.service';

const generateSchema = z.object({ prompt: z.string().min(3).max(2000) });

// Whether the AI builder is usable (key present), so the UI can show/hide it.
export async function aiStatusHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: { configured: aiService.configured() } });
}

// Natural language → RPA flow draft (not persisted; the client reviews + saves).
export async function generateFlowHandler(req: Request, res: Response): Promise<void> {
  const { prompt } = generateSchema.parse(req.body);
  const data = await aiService.generateFlow(prompt);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'ai.flow.generate',
    resourceType: 'rpa_flow',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { steps: data.steps.length }
  });
  res.json({ data });
}
