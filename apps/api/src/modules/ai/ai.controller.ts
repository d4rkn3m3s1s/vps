import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { aiService } from './ai.service';

const generateSchema = z.object({ prompt: z.string().min(3).max(2000) });
const querySchema = z.object({ query: z.string().min(3).max(500) });

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

// AI Insights: anomalies + prioritized recommendations from fleet signals.
export async function insightsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = getWorkspaceId(req);
  const data = await aiService.generateInsights(workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'ai.insights.generate',
    resourceType: 'fleet',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { anomalies: data.anomalies.length, recommendations: data.recommendations.length }
  });
  res.json({ data });
}

// Natural-language fleet query → classified safe read-only result.
export async function queryHandler(req: Request, res: Response): Promise<void> {
  const { query } = querySchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  const data = await aiService.queryFleet(workspaceId, query);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'ai.fleet.query',
    resourceType: 'fleet',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { type: data.type, rows: data.result.length }
  });
  res.json({ data });
}
