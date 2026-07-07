import type { Prisma } from '@prisma/client';
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
  // Build a workspace-scope filter for ProfilePermission. The row has no direct
  // workspaceId, so a permission belongs to a workspace when its device OR group
  // belongs to that workspace. Returns {} when no workspace context (unscoped).
  private async workspaceScope(workspaceId?: string): Promise<Prisma.ProfilePermissionWhereInput> {
    if (!workspaceId) return {};
    const [devices, groups] = await Promise.all([
      prisma.device.findMany({ where: { workspaceId }, select: { id: true } }),
      prisma.deviceGroup.findMany({ where: { workspaceId }, select: { id: true } })
    ]);
    return {
      OR: [
        { deviceId: { in: devices.map((d) => d.id) } },
        { groupId: { in: groups.map((g) => g.id) } }
      ]
    };
  }

  async listForUser(userId: string, workspaceId?: string) {
    const scope = await this.workspaceScope(workspaceId);
    return prisma.profilePermission.findMany({
      where: { userId, ...scope },
      orderBy: { createdAt: 'desc' }
    });
  }

  async list(workspaceId?: string) {
    const scope = await this.workspaceScope(workspaceId);
    return prisma.profilePermission.findMany({ where: scope, orderBy: { createdAt: 'desc' } });
  }

  async grant(input: PermissionInput, workspaceId?: string) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    // Scope group/device to the granting admin's workspace so a grant can't bind
    // to another tenant's group/device by id.
    if (input.groupId) {
      const group = await prisma.deviceGroup.findFirst({ where: { id: input.groupId, ...(workspaceId ? { workspaceId } : {}) } });
      if (!group) throw new AppError('Group not found', 404, 'GROUP_NOT_FOUND');
    }
    if (input.deviceId) {
      const device = await prisma.device.findFirst({ where: { id: input.deviceId, ...(workspaceId ? { workspaceId } : {}) } });
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

  async revoke(id: string, workspaceId?: string) {
    // Workspace-scoped via the permission's device/group so a foreign tenant's
    // grant can't be revoked by id.
    const scope = await this.workspaceScope(workspaceId);
    const perm = await prisma.profilePermission.findFirst({ where: { id, ...scope } });
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

  // Does this user have ANY profile-permission grants? Used to decide whether
  // granular restriction applies. A user with zero grants is unrestricted (sees
  // their whole workspace) — grants act as an allowlist only once they exist, so
  // adding RBAC never silently locks out existing operators.
  async hasAnyGrants(userId: string): Promise<boolean> {
    const count = await prisma.profilePermission.count({ where: { userId } });
    return count > 0;
  }

  // Filters a device list down to what a user may VIEW. Admins and users with no
  // grants pass through unchanged; restricted users keep only granted devices.
  async filterVisibleDevices<T extends { id: string; groupId: string | null }>(
    userId: string,
    role: string,
    devices: T[]
  ): Promise<T[]> {
    if (role === 'admin') return devices;
    if (!(await this.hasAnyGrants(userId))) return devices;
    const perms = await prisma.profilePermission.findMany({ where: { userId, canView: true } });
    const grantedDeviceIds = new Set(perms.filter((p) => p.deviceId).map((p) => p.deviceId as string));
    const grantedGroupIds = new Set(perms.filter((p) => p.groupId).map((p) => p.groupId as string));
    return devices.filter(
      (d) => grantedDeviceIds.has(d.id) || (d.groupId !== null && grantedGroupIds.has(d.groupId))
    );
  }

  // Throws 403 if the user may not perform `action` on the device. No-op for
  // admins and for users with no grants (unrestricted).
  async assertDeviceAccess(
    userId: string,
    role: string,
    deviceId: string,
    action: 'view' | 'control' | 'delete'
  ): Promise<void> {
    if (role === 'admin') return;
    if (!(await this.hasAnyGrants(userId))) return;
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { groupId: true } });
    const ok = await this.canAccess(userId, role, deviceId, device?.groupId ?? null, action);
    if (!ok) {
      throw new AppError(`You don't have ${action} permission for this device`, 403, 'PROFILE_FORBIDDEN');
    }
  }
}

export const permissionsService = new PermissionsService();
