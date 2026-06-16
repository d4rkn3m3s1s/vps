import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

export type PermissionInput = {
  userId: string;
  groupId?: string | undefined;
  deviceId?: string | undefined;
  canView?: boolean | undefined;
  canControl?: boolean | undefined;
  canDelete?: boolean | undefined;
};

export class PermissionsService {
  async listForUser(userId: string) {
    return prisma.profilePermission.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async list() {
    return prisma.profilePermission.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async grant(input: PermissionInput) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    if (input.groupId) {
      const group = await prisma.deviceGroup.findUnique({ where: { id: input.groupId } });
      if (!group) throw new AppError('Group not found', 404, 'GROUP_NOT_FOUND');
    }
    if (input.deviceId) {
      const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
      if (!device) throw new AppError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }

    const data = {
      canView: input.canView ?? true,
      canControl: input.canControl ?? false,
      canDelete: input.canDelete ?? false
    };

    // Nullable fields in a compound unique can't be used in Prisma's unique
    // `where`, so we look up the existing grant manually then create/update.
    const existing = await prisma.profilePermission.findFirst({
      where: {
        userId: input.userId,
        groupId: input.groupId ?? null,
        deviceId: input.deviceId ?? null
      }
    });

    if (existing) {
      return prisma.profilePermission.update({ where: { id: existing.id }, data });
    }

    return prisma.profilePermission.create({
      data: { userId: input.userId, groupId: input.groupId ?? null, deviceId: input.deviceId ?? null, ...data }
    });
  }

  async revoke(id: string) {
    const perm = await prisma.profilePermission.findUnique({ where: { id } });
    if (!perm) throw new AppError('Permission not found', 404, 'PERMISSION_NOT_FOUND');
    return prisma.profilePermission.delete({ where: { id } });
  }

  // Effective access check: admins bypass; otherwise look for a matching grant.
  async canAccess(userId: string, role: string, deviceId: string, groupId: string | null, action: 'view' | 'control' | 'delete'): Promise<boolean> {
    if (role === 'admin') return true;
    const perms = await prisma.profilePermission.findMany({
      where: {
        userId,
        OR: [{ deviceId }, ...(groupId ? [{ groupId }] : [])]
      }
    });
    if (perms.length === 0) return false;
    return perms.some((p) => {
      if (action === 'view') return p.canView;
      if (action === 'control') return p.canControl;
      return p.canDelete;
    });
  }
}

export const permissionsService = new PermissionsService();
