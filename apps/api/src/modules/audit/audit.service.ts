import type { JsonValue } from '@prisma/client/runtime/library';
import { prisma } from '../../db/prisma';

export type AuditEvent = {
  userId?: string | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | undefined;
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  metadata?: JsonValue | undefined;
  workspaceId?: string | undefined;
};

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: event.action,
      resourceType: event.resourceType,
      ...(event.userId ? { userId: event.userId } : {}),
      ...(event.resourceId ? { resourceId: event.resourceId } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.ip ? { ip: event.ip } : {}),
      ...(event.userAgent ? { userAgent: event.userAgent } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
      ...(event.workspaceId ? { workspaceId: event.workspaceId } : {})
    }
  });
}

export type AuditFilter = {
  workspaceId?: string | undefined;
  action?: string | undefined;
  search?: string | undefined;
  actorEmail?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
};

// Builds the Prisma `where` shared by list + export so both apply identical
// filters (the only difference is the row cap).
//
// Every clause is collected under a SINGLE `AND` array. This is deliberate: the
// workspace-scoping filter and the free-text search filter each need their own
// `OR`, and two `OR` keys in one object literal silently collapse to the last one
// (a JS duplicate-key), which used to let the search `OR` overwrite the workspace
// `OR` — leaking every tenant's audit rows the moment anything was typed in search.
// AND-of-ORs keeps both constraints. Workspace scoping is now STRICT (only this
// workspace's rows); the old `{ workspaceId: null }` branch is dropped because it
// exposed pre-multi-tenancy auth rows (emails/IPs) to every tenant.
function buildWhere(filter: AuditFilter) {
  const { workspaceId, action, search, actorEmail, from, to } = filter;
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  const and: Record<string, unknown>[] = [];
  if (workspaceId) and.push({ workspaceId });
  if (action) and.push({ action: { contains: action, mode: 'insensitive' as const } });
  if (actorEmail) and.push({ user: { email: { contains: actorEmail, mode: 'insensitive' as const } } });
  if (from || to) and.push({ createdAt });
  if (search) {
    and.push({
      OR: [
        { action: { contains: search, mode: 'insensitive' as const } },
        { resourceType: { contains: search, mode: 'insensitive' as const } }
      ]
    });
  }
  return and.length ? { AND: and } : {};
}

export async function listAuditLogs(filter: AuditFilter = {}) {
  const { limit = 50 } = filter;
  return prisma.auditLog.findMany({
    where: buildWhere(filter),
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, email: true, role: true } } }
  });
}

// Returns rows for CSV export (no row cap beyond a safety ceiling).
export async function exportAuditLogs(filter: AuditFilter = {}) {
  return prisma.auditLog.findMany({
    where: buildWhere(filter),
    take: 10000,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { email: true } } }
  });
}
