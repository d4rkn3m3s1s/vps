import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

type GrantRow = {
  expiresAt: Date | null;
  revokedAt: Date | null;
  grantedToId: string;
  grantedById: string;
  [k: string]: unknown;
};

// Decorate a grant with both parties' emails and a derived "active" flag.
function decorate(g: GrantRow, emailById: Map<string, string>) {
  const now = Date.now();
  const expired = g.expiresAt ? g.expiresAt.getTime() <= now : false;
  return {
    ...g,
    granteeEmail: emailById.get(g.grantedToId) ?? null,
    granterEmail: emailById.get(g.grantedById) ?? null,
    active: !g.revokedAt && !expired
  };
}

// Grants reference users by id; we hydrate emails via a second lookup (the
// User relation isn't modeled on DeviceGrant to keep the schema lean).
async function hydrate<T extends GrantRow>(grants: T[]) {
  const ids = Array.from(new Set(grants.flatMap((g) => [g.grantedToId, g.grantedById])));
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u.email]));
  return grants.map((g) => decorate(g, byId));
}

export const grantService = {
  // All grants issued on a device (newest first). Scope the device to the caller's
  // workspace first so a foreign device's grants (and their party emails) can't be
  // enumerated by id.
  async listForDevice(deviceId: string, workspaceId?: string) {
    const device = await prisma.device.findFirst({ where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    const grants = await prisma.deviceGrant.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' } });
    return hydrate(grants);
  },

  // Grants the current user RECEIVED (devices lent to them), active only.
  async listReceived(userId: string) {
    const now = new Date();
    const grants = await prisma.deviceGrant.findMany({
      where: { grantedToId: userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' },
      include: { device: { select: { id: true, name: true, status: true } } }
    });
    const ids = Array.from(new Set(grants.flatMap((g) => [g.grantedToId, g.grantedById])));
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u.email]));
    return grants.map((g) => ({ ...decorate(g, byId), device: g.device }));
  },

  // Lend a device to another user (by email) with VIEW or CONTROL access and an
  // optional expiry (hours from now). Distinct from the standing workspace ACL.
  async grant(
    deviceId: string,
    input: { email: string; access?: 'VIEW' | 'CONTROL' | undefined; expiresInHours?: number | undefined },
    ctx: { granterId: string; workspaceId?: string | undefined }
  ) {
    // Scope the device to the granter's workspace so you can only lend devices you
    // actually own.
    const device = await prisma.device.findFirst({ where: { id: deviceId, ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}) } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    const grantee = await prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (!grantee) throw new AppError('No user with that email', 404, 'USER_NOT_FOUND');
    if (grantee.id === ctx.granterId) throw new AppError('You already own this device', 400, 'SELF_GRANT');

    const expiresAt =
      typeof input.expiresInHours === 'number' && input.expiresInHours > 0
        ? new Date(Date.now() + input.expiresInHours * 3_600_000)
        : null;

    const grant = await prisma.deviceGrant.create({
      data: {
        deviceId,
        grantedToId: grantee.id,
        grantedById: ctx.granterId,
        access: input.access ?? 'VIEW',
        ...(expiresAt ? { expiresAt } : {}),
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {})
      }
    });
    return (await hydrate([grant]))[0];
  },

  // Revoke (deauthorize) a grant immediately. Workspace-scoped so one tenant can't
  // revoke another tenant's grant by id.
  async revoke(grantId: string, workspaceId?: string) {
    const grant = await prisma.deviceGrant.findFirst({ where: { id: grantId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!grant) throw new AppError('Grant not found', 404, 'GRANT_NOT_FOUND');
    await prisma.deviceGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
    return { revoked: true };
  },

  // Permanently transfer a device to another workspace (by slug or id). The
  // device's farm account / fingerprint travel with it; standing grants are
  // revoked since the prior workspace no longer owns it.
  async transfer(deviceId: string, targetWorkspace: string, workspaceId?: string, userId?: string) {
    // You can only transfer a device your workspace currently owns.
    const device = await prisma.device.findFirst({ where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) } });
    if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    const ws = await prisma.workspace.findFirst({ where: { OR: [{ id: targetWorkspace }, { slug: targetWorkspace }] } });
    if (!ws) throw new AppError('Target workspace not found', 404, 'WORKSPACE_NOT_FOUND');
    // ★The caller must be a MEMBER of the target workspace. Without this, an (admin-role)
    // user could transfer a device — with its farm account + encrypted credential vault +
    // TOTP — into ANY workspace by id/slug, including one they don't belong to, silently
    // exfiltrating it. Verify membership before reassigning ownership.
    if (userId) {
      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId: ws.id, userId },
        select: { id: true }
      });
      if (!member) throw new AppError('Hedef workspace üyesi değilsiniz', 403, 'NOT_TARGET_MEMBER');
    }

    await prisma.$transaction([
      prisma.device.update({ where: { id: deviceId }, data: { workspaceId: ws.id, groupId: null } }),
      prisma.deviceGrant.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
    return { transferredTo: ws.id, workspaceName: ws.name };
  }
};
