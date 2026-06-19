import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { exportAuditLogs, listAuditLogs, type AuditFilter } from './audit.service';

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  action: z.string().optional(),
  search: z.string().optional(),
  actor: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

// Translates the shared query params into an AuditFilter (parsing dates).
function toFilter(req: Request, q: z.infer<typeof querySchema>): AuditFilter {
  const workspaceId = getWorkspaceId(req);
  const filter: AuditFilter = {
    limit: q.limit,
    ...(workspaceId ? { workspaceId } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.search ? { search: q.search } : {}),
    ...(q.actor ? { actorEmail: q.actor } : {})
  };
  if (q.from) {
    const d = new Date(q.from);
    if (!Number.isNaN(d.getTime())) filter.from = d;
  }
  if (q.to) {
    const d = new Date(q.to);
    if (!Number.isNaN(d.getTime())) filter.to = d;
  }
  return filter;
}

export async function listAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const q = querySchema.parse(req.query);
  res.json({ data: await listAuditLogs(toFilter(req, q)) });
}

// Escapes a CSV cell (wraps in quotes, doubles inner quotes) per RFC 4180.
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const q = querySchema.parse(req.query);
  const rows = await exportAuditLogs(toFilter(req, q));

  const header = ['timestamp', 'actor', 'action', 'resourceType', 'resourceId', 'ip', 'requestId'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.user?.email ?? 'system',
        r.action,
        r.resourceType,
        r.resourceId ?? '',
        r.ip ?? '',
        r.requestId ?? ''
      ]
        .map(csvCell)
        .join(',')
    );
  }
  const csv = lines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}
