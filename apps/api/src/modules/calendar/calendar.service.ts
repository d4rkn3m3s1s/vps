import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';

export type ScheduledPostInput = {
  caption: string;
  platform: string;
  mediaUrl?: string | undefined;
  groupId?: string | undefined;
  deviceIds?: string[] | undefined;
  rpaFlowId?: string | undefined;
  scheduledFor: string | Date;
};

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

export const calendarService = {
  async list(workspaceId?: string) {
    return prisma.scheduledPost.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { scheduledFor: 'asc' }
    });
  },

  async create(input: ScheduledPostInput, ctx: { workspaceId?: string | undefined; userId?: string | undefined }) {
    if (!input.caption?.trim() && !input.mediaUrl) {
      throw new AppError('Başlık veya medya gerekli', 400, 'EMPTY_POST');
    }
    const when = toDate(input.scheduledFor);
    if (Number.isNaN(when.getTime())) throw new AppError('Geçersiz zaman', 400, 'INVALID_TIME');

    const data: Prisma.ScheduledPostCreateInput = {
      caption: input.caption?.trim() ?? '',
      platform: input.platform || 'other',
      ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      deviceIds: input.deviceIds ?? [],
      ...(input.rpaFlowId ? { rpaFlowId: input.rpaFlowId } : {}),
      scheduledFor: when,
      status: 'SCHEDULED',
      ...(ctx.userId ? { createdById: ctx.userId } : {}),
      ...(ctx.workspaceId ? { workspace: { connect: { id: ctx.workspaceId } } } : {})
    };
    return prisma.scheduledPost.create({ data });
  },

  async update(
    id: string,
    input: {
      caption?: string | undefined;
      platform?: string | undefined;
      mediaUrl?: string | undefined;
      groupId?: string | undefined;
      deviceIds?: string[] | undefined;
      rpaFlowId?: string | undefined;
      scheduledFor?: string | Date | undefined;
      status?: 'SCHEDULED' | 'CANCELED' | undefined;
    },
    workspaceId?: string
  ) {
    const post = await prisma.scheduledPost.findUnique({ where: { id } });
    if (!post) throw new AppError('Gönderi bulunamadı', 404, 'POST_NOT_FOUND');
    if (workspaceId && post.workspaceId && post.workspaceId !== workspaceId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    const data: Prisma.ScheduledPostUpdateInput = {};
    if (input.caption !== undefined) data.caption = input.caption.trim();
    if (input.platform !== undefined) data.platform = input.platform;
    if (input.mediaUrl !== undefined) data.mediaUrl = input.mediaUrl || null;
    if (input.groupId !== undefined) data.groupId = input.groupId || null;
    if (input.deviceIds !== undefined) data.deviceIds = input.deviceIds;
    if (input.rpaFlowId !== undefined) data.rpaFlowId = input.rpaFlowId || null;
    if (input.scheduledFor !== undefined) data.scheduledFor = toDate(input.scheduledFor);
    if (input.status !== undefined) data.status = input.status;
    return prisma.scheduledPost.update({ where: { id }, data });
  },

  async remove(id: string, workspaceId?: string) {
    const post = await prisma.scheduledPost.findUnique({ where: { id } });
    if (!post) throw new AppError('Gönderi bulunamadı', 404, 'POST_NOT_FOUND');
    if (workspaceId && post.workspaceId && post.workspaceId !== workspaceId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    await prisma.scheduledPost.delete({ where: { id } });
    return { deleted: true };
  },

  // Resolve the device set for a post: a target group's devices ∪ explicit ids.
  async resolveDevices(post: { groupId: string | null; deviceIds: string[] }): Promise<string[]> {
    const ids = new Set<string>(post.deviceIds ?? []);
    if (post.groupId) {
      const devices = await prisma.device.findMany({ where: { groupId: post.groupId }, select: { id: true } });
      for (const d of devices) ids.add(d.id);
    }
    return Array.from(ids);
  },

  // Ticked on an interval. For each SCHEDULED post whose time has passed, push
  // its media to every target device (if any) and dispatch the posting RPA
  // flow with the caption injected. Marks the post POSTED or FAILED.
  async dispatchDue(now: Date = new Date()): Promise<{ dispatched: number }> {
    const due = await prisma.scheduledPost.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: now } }
    });

    let dispatched = 0;
    for (const post of due) {
      try {
        const deviceIds = await this.resolveDevices(post);
        if (deviceIds.length === 0) {
          await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'FAILED', error: 'Hedef cihaz yok' } });
          continue;
        }
        const flow = post.rpaFlowId ? await prisma.rpaFlow.findUnique({ where: { id: post.rpaFlowId } }) : null;

        for (const deviceId of deviceIds) {
          // Push media first so the posting flow can pick it from the gallery.
          if (post.mediaUrl) {
            const fileName = post.mediaUrl.split('/').pop() || 'media';
            await createJobRecord(
              'EMULATOR_PUSH_FILE',
              { deviceId, url: post.mediaUrl, fileName, destination: 'gallery' } as unknown as JobPayload,
              undefined,
              post.workspaceId ?? undefined
            );
          }
          // Then the posting flow (caption available to steps via payload).
          if (flow) {
            await createJobRecord(
              'RPA_RUN',
              { deviceId, flowId: flow.id, steps: flow.steps, caption: post.caption } as unknown as JobPayload,
              undefined,
              post.workspaceId ?? undefined
            );
          }
        }

        await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'POSTED', postedAt: now } });
        dispatched += 1;
      } catch (e) {
        await prisma.scheduledPost
          .update({ where: { id: post.id }, data: { status: 'FAILED', error: e instanceof Error ? e.message : 'hata' } })
          .catch(() => undefined);
      }
    }
    return { dispatched };
  }
};
