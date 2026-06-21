import { prisma } from '../../db/prisma';
import { env } from '../../config/env';

const DEFAULT_SLUG = 'default';

// Idempotent migration/bootstrap: guarantees a Default Workspace exists, the
// admin is a member, and every pre-existing resource (created before multi-tenancy)
// is assigned to it. Safe to run on every startup — it only touches NULL rows.
export async function ensureDefaultWorkspace(): Promise<string> {
  const workspace = await prisma.workspace.upsert({
    where: { slug: DEFAULT_SLUG },
    update: {},
    create: { name: 'Default Workspace', slug: DEFAULT_SLUG }
  });

  // Ensure the default workspace has a (free) subscription row.
  await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: { workspaceId: workspace.id, plan: 'free', status: 'ACTIVE' }
  });

  // Make the bootstrap admin an admin member of the default workspace.
  const admin = await prisma.user.findUnique({ where: { email: env.adminEmail } });
  if (admin) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
      update: {},
      create: { workspaceId: workspace.id, userId: admin.id, role: 'admin' }
    });
  }

  // Backfill any orphaned resources (workspaceId IS NULL) into the default WS.
  const wid = workspace.id;
  await Promise.all([
    prisma.device.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.deviceGroup.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.proxy.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.job.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.rpaFlow.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.scheduledTask.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.webhook.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.host.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.libraryAsset.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } }),
    prisma.socialAccount.updateMany({ where: { workspaceId: null }, data: { workspaceId: wid } })
  ]);

  return workspace.id;
}
