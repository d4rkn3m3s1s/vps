import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'workspace';
}

export class WorkspaceService {
  // Workspaces the user belongs to, with their role and a resource count.
  async listForUser(userId: string) {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { workspace: { include: { _count: { select: { members: true, devices: true } } } } }
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      members: m.workspace._count.members,
      devices: m.workspace._count.devices
    }));
  }

  // Creates a workspace and makes the creator its admin.
  async create(userId: string, name: string) {
    let slug = slugify(name);
    // Ensure slug uniqueness.
    if (await prisma.workspace.findUnique({ where: { slug } })) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    }
    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug,
        members: { create: { userId, role: 'admin' } }
      }
    });
    return { id: workspace.id, name: workspace.name, slug: workspace.slug, role: 'admin' };
  }

  // Lightweight lookup used by callers that need the workspace name (e.g. emails).
  async getById(workspaceId: string) {
    return prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, slug: true } });
  }

  // Lists members of a workspace (caller must belong to it — checked in controller).
  async listMembers(workspaceId: string) {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'asc' }
    });
    return members.map((m) => ({ id: m.id, userId: m.userId, email: m.user.email, role: m.role }));
  }

  // Invites an existing user (by email) into a workspace with a role. Requires
  // the target user to already have an account (no email delivery in this build).
  async inviteMember(workspaceId: string, email: string, role: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('No user with that email. Ask them to sign up first.', 404, 'USER_NOT_FOUND');
    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } }
    });
    if (existing) throw new AppError('User is already a member', 409, 'ALREADY_MEMBER');
    const member = await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role }
    });
    return { id: member.id, userId: user.id, email: user.email, role: member.role };
  }

  // Changes an existing member's role. Won't demote the last admin.
  async updateMemberRole(workspaceId: string, memberId: string, role: string) {
    const member = await prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member || member.workspaceId !== workspaceId) {
      throw new AppError('Member not found', 404, 'MEMBER_NOT_FOUND');
    }
    // Demoting an admin to a non-admin role must not leave the workspace adminless.
    if (member.role === 'admin' && role !== 'admin') {
      const admins = await prisma.workspaceMember.count({ where: { workspaceId, role: 'admin' } });
      if (admins <= 1) throw new AppError('Cannot demote the last admin', 409, 'LAST_ADMIN');
    }
    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
      include: { user: { select: { id: true, email: true } } }
    });
    return { id: updated.id, userId: updated.userId, email: updated.user.email, role: updated.role };
  }

  // Renames a workspace (re-slugs to keep the slug readable but unique).
  async updateWorkspace(workspaceId: string, name: string) {
    let slug = slugify(name);
    const clash = await prisma.workspace.findUnique({ where: { slug } });
    if (clash && clash.id !== workspaceId) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    }
    const ws = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name, slug }
    });
    return { id: ws.id, name: ws.name, slug: ws.slug };
  }

  async removeMember(workspaceId: string, memberId: string) {
    const member = await prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member || member.workspaceId !== workspaceId) {
      throw new AppError('Member not found', 404, 'MEMBER_NOT_FOUND');
    }
    // Don't allow removing the last admin.
    if (member.role === 'admin') {
      const admins = await prisma.workspaceMember.count({ where: { workspaceId, role: 'admin' } });
      if (admins <= 1) throw new AppError('Cannot remove the last admin', 409, 'LAST_ADMIN');
    }
    await prisma.workspaceMember.delete({ where: { id: memberId } });
  }

  // Returns the workspace's settings row, creating defaults on first read.
  async getSettings(workspaceId: string) {
    return prisma.workspaceSettings.upsert({
      where: { workspaceId },
      update: {},
      create: { workspaceId }
    });
  }

  async updateSettings(
    workspaceId: string,
    data: {
      require2fa?: boolean | undefined;
      restrictInvites?: boolean | undefined;
      strongPasswords?: boolean | undefined;
      sessionExpiryHrs?: number | undefined;
    }
  ) {
    // Strip undefined keys so Prisma's strict input types accept the partial.
    const clean: {
      require2fa?: boolean;
      restrictInvites?: boolean;
      strongPasswords?: boolean;
      sessionExpiryHrs?: number;
    } = {};
    if (data.require2fa !== undefined) clean.require2fa = data.require2fa;
    if (data.restrictInvites !== undefined) clean.restrictInvites = data.restrictInvites;
    if (data.strongPasswords !== undefined) clean.strongPasswords = data.strongPasswords;
    if (data.sessionExpiryHrs !== undefined) clean.sessionExpiryHrs = data.sessionExpiryHrs;

    return prisma.workspaceSettings.upsert({
      where: { workspaceId },
      update: clean,
      create: { workspaceId, ...clean }
    });
  }

  async assertMember(workspaceId: string, userId: string): Promise<string> {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    if (!m) throw new AppError('Not a member of this workspace', 403, 'FORBIDDEN');
    return m.role;
  }
}

export const workspaceService = new WorkspaceService();
