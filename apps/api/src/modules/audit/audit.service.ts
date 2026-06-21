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
function buildWhere(filter: AuditFilter) {
  const { workspaceId, action, search, actorEmail, from, to } = filter;
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  return {
    // Workspace scoping: show this workspace's logs PLUS legacy/global logs
    // that predate multi-tenancy (workspaceId null).
    ...(workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {}),
    ...(action ? { action: { contains: action, mode: 'insensitive' as const } } : {}),
    ...(actorEmail ? { user: { email: { contains: actorEmail, mode: 'insensitive' as const } } } : {}),
    ...(from || to ? { createdAt } : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: 'insensitive' as const } },
            { resourceType: { contains: search, mode: 'insensitive' as const } }
          ]
        }
      : {})
  };
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
