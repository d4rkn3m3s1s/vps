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
      ...(event.metadata ? { metadata: event.metadata } : {})
    }
  });
}

export async function listAuditLogs(limit = 50) {
  return prisma.auditLog.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true
        }
      }
    }
  });
}
