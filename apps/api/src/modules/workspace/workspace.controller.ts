import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { isServiceAuth } from '../../lib/serviceAuth';
import { writeAuditLog } from '../audit/audit.service';
import { switchWorkspace } from '../auth/auth.service';
import { sendMail } from '../mail/mail.service';
import { inviteEmail } from '../mail/mail.templates';
import { workspaceService } from './workspace.service';

const createSchema = z.object({ name: z.string().min(1).max(60) });
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'operator', 'viewer']).default('operator')
});
const roleSchema = z.object({ role: z.enum(['admin', 'operator', 'viewer']) });
const updateWorkspaceSchema = z.object({ name: z.string().min(1).max(60) });
const settingsSchema = z
  .object({
    require2fa: z.boolean(),
    restrictInvites: z.boolean(),
    strongPasswords: z.boolean(),
    sessionExpiryHrs: z.number().int().min(1).max(720)
  })
  .partial();

function requireUser(req: Request): string {
  if (!req.auth) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  return req.auth.userId;
}

export async function listWorkspacesHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  res.json({ data: await workspaceService.listForUser(userId) });
}

export async function createWorkspaceHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const { name } = createSchema.parse(req.body);
  const ws = await workspaceService.create(userId, name);
  await writeAuditLog({
    userId,
    action: 'workspace.create',
    resourceType: 'workspace',
    resourceId: ws.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { name },
    workspaceId: ws.id
  });
  res.status(201).json({ data: ws });
}

// Re-issues tokens scoped to the chosen workspace.
export async function switchWorkspaceHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id;
  if (typeof workspaceId !== 'string') throw new AppError('Workspace id required', 400, 'INVALID_ID');
  const serviceAuth = await isServiceAuth(req);
  const result = await switchWorkspace(userId, workspaceId, { serviceAuth });
  res.json({ data: result });
}

export async function listMembersHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  await workspaceService.assertMember(workspaceId, userId);
  res.json({ data: await workspaceService.listMembers(workspaceId) });
}

export async function inviteMemberHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  const role = await workspaceService.assertMember(workspaceId, userId);
  // Invite permission is policy-driven: when restrictInvites is on (default),
  // only admins may invite; when off, operators may invite too. Viewers never can.
  const settings = await workspaceService.getSettings(workspaceId);
  const canInvite = settings.restrictInvites ? role === 'admin' : role === 'admin' || role === 'operator';
  if (!canInvite) {
    throw new AppError(
      settings.restrictInvites
        ? 'Only workspace admins can invite members'
        : 'You do not have permission to invite members',
      403,
      'FORBIDDEN'
    );
  }
  const { email, role: memberRole } = inviteSchema.parse(req.body);
  const member = await workspaceService.inviteMember(workspaceId, email, memberRole);

  // Notify the new member by email (best-effort; never blocks the invite).
  const ws = await workspaceService.getById(workspaceId);
  void sendMail(
    inviteEmail({
      to: email,
      workspaceName: ws?.name ?? 'your workspace',
      role: memberRole,
      ...(req.auth?.email ? { inviterEmail: req.auth.email } : {})
    })
  );

  await writeAuditLog({
    userId,
    action: 'workspace.invite',
    resourceType: 'workspace_member',
    resourceId: member.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { email, role: memberRole },
    workspaceId
  });
  res.status(201).json({ data: member });
}

export async function updateMemberHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  const memberId = req.params.memberId as string;
  const role = await workspaceService.assertMember(workspaceId, userId);
  if (role !== 'admin') throw new AppError('Only workspace admins can change roles', 403, 'FORBIDDEN');
  const { role: newRole } = roleSchema.parse(req.body);
  const member = await workspaceService.updateMemberRole(workspaceId, memberId, newRole);
  await writeAuditLog({
    userId,
    action: 'workspace.member.role',
    resourceType: 'workspace_member',
    resourceId: memberId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { role: newRole },
    workspaceId
  });
  res.json({ data: member });
}

export async function getSettingsHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  await workspaceService.assertMember(workspaceId, userId);
  res.json({ data: await workspaceService.getSettings(workspaceId) });
}

export async function updateSettingsHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  const role = await workspaceService.assertMember(workspaceId, userId);
  if (role !== 'admin') throw new AppError('Only workspace admins can change policy', 403, 'FORBIDDEN');
  const data = settingsSchema.parse(req.body);
  const settings = await workspaceService.updateSettings(workspaceId, data);
  await writeAuditLog({
    userId,
    action: 'workspace.settings',
    resourceType: 'workspace',
    resourceId: workspaceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: data,
    workspaceId
  });
  res.json({ data: settings });
}

export async function updateWorkspaceHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  const role = await workspaceService.assertMember(workspaceId, userId);
  if (role !== 'admin') throw new AppError('Only workspace admins can edit settings', 403, 'FORBIDDEN');
  const { name } = updateWorkspaceSchema.parse(req.body);
  const ws = await workspaceService.updateWorkspace(workspaceId, name);
  await writeAuditLog({
    userId,
    action: 'workspace.update',
    resourceType: 'workspace',
    resourceId: workspaceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { name },
    workspaceId
  });
  res.json({ data: ws });
}

export async function removeMemberHandler(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req);
  const workspaceId = req.params.id as string;
  const memberId = req.params.memberId as string;
  const role = await workspaceService.assertMember(workspaceId, userId);
  if (role !== 'admin') throw new AppError('Only workspace admins can remove members', 403, 'FORBIDDEN');
  await workspaceService.removeMember(workspaceId, memberId);
  res.json({ data: { id: memberId } });
}
