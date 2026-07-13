import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { assertSafePublicUrl } from '../../lib/urlGuard';
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

// Validate that any group/flow/device the post references belongs to the caller's
// workspace. Without this a post could target another tenant's group, flow, or
// devices by id and have the scheduler drive them. Foreign ids → 404.
async function assertReferencesOwned(
  refs: { groupId?: string | null | undefined; rpaFlowId?: string | null | undefined; deviceIds?: string[] | undefined },
  workspaceId?: string
): Promise<void> {
  if (!workspaceId) return;
  if (refs.groupId) {
    const group = await prisma.deviceGroup.findFirst({ where: { id: refs.groupId, workspaceId } });
    if (!group) throw new AppError('Grup bulunamadı', 404, 'GROUP_NOT_FOUND');
  }
  if (refs.rpaFlowId) {
    const flow = await prisma.rpaFlow.findFirst({ where: { id: refs.rpaFlowId, workspaceId } });
    if (!flow) throw new AppError('RPA akışı bulunamadı', 404, 'FLOW_NOT_FOUND');
  }
  if (refs.deviceIds && refs.deviceIds.length > 0) {
    const owned = await prisma.device.count({ where: { id: { in: refs.deviceIds }, workspaceId } });
    if (owned !== new Set(refs.deviceIds).size) {
      throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    }
  }
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
    // SSRF guard: the host agent fetches mediaUrl server-side, so reject internal targets.
    if (input.mediaUrl) await assertSafePublicUrl(input.mediaUrl);
    // Ownership guard: group/flow/devices must belong to this workspace.
    await assertReferencesOwned(
      { groupId: input.groupId, rpaFlowId: input.rpaFlowId, deviceIds: input.deviceIds },
      ctx.workspaceId
    );

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
    // Workspace-scoped lookup: a foreign post resolves to "not found" rather than
    // relying on a post-hoc check that short-circuits when workspaceId is undefined.
    const post = await prisma.scheduledPost.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!post) throw new AppError('Gönderi bulunamadı', 404, 'POST_NOT_FOUND');
    // SSRF guard on any newly-supplied mediaUrl (agent fetches it server-side).
    if (input.mediaUrl) await assertSafePublicUrl(input.mediaUrl);
    // Ownership guard on any newly-supplied group/flow/devices (cross-tenant).
    await assertReferencesOwned(
      { groupId: input.groupId, rpaFlowId: input.rpaFlowId, deviceIds: input.deviceIds },
      workspaceId
    );
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
    // Workspace-scoped delete: atomic deleteMany so a foreign id deletes nothing
    // (no TOCTOU window, no short-circuit when workspaceId is undefined).
    const post = await prisma.scheduledPost.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    if (!post) throw new AppError('Gönderi bulunamadı', 404, 'POST_NOT_FOUND');
    await prisma.scheduledPost.deleteMany({ where: { id, ...(workspaceId ? { workspaceId } : {}) } });
    return { deleted: true };
  },

  // Resolve the device set for a post: a target group's devices ∪ explicit ids.
  // Scoped to the post's own workspace so a stale/cross-tenant group id can't pull
  // in another tenant's devices at dispatch time.
  async resolveDevices(post: {
    groupId: string | null;
    deviceIds: string[];
    workspaceId?: string | null;
  }): Promise<string[]> {
    const ws = post.workspaceId ?? undefined;
    const ids = new Set<string>(post.deviceIds ?? []);
    if (post.groupId) {
      const devices = await prisma.device.findMany({
        where: { groupId: post.groupId, ...(ws ? { workspaceId: ws } : {}) },
        select: { id: true }
      });
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
        // Atomically claim this post before doing any work: flip SCHEDULED →
        // POSTING first. If a concurrent ticker (multi-instance / overlapping
        // run) already claimed it, count===0 and we skip — otherwise the same
        // post would be dispatched twice (double post). The status is later
        // corrected to POSTED/FAILED below (or by agent.complete for RPA flows).
        const claim = await prisma.scheduledPost.updateMany({
          where: { id: post.id, status: 'SCHEDULED' },
          data: { status: 'POSTING' }
        });
        if (claim.count === 0) continue;

        const deviceIds = await this.resolveDevices(post);
        if (deviceIds.length === 0) {
          await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'FAILED', error: 'Hedef cihaz yok' } });
          continue;
        }
        const flow = post.rpaFlowId ? await prisma.rpaFlow.findUnique({ where: { id: post.rpaFlowId } }) : null;

        for (const deviceId of deviceIds) {
          // Push media first so the posting flow can pick it from the gallery.
          if (post.mediaUrl) {
            // Sanitize the derived filename — it ends up in a device-side path, so
            // strip anything that isn't a safe filename char (no traversal).
            const rawName = post.mediaUrl.split('/').pop() || 'media';
            const fileName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'media';
            await createJobRecord(
              'EMULATOR_PUSH_FILE',
              { deviceId, url: post.mediaUrl, fileName, destination: 'gallery' } as unknown as JobPayload,
              undefined,
              post.workspaceId ?? undefined
            );
          }
          // Then the posting flow (caption available to steps via payload). Tag
          // the job with scheduledPostId so job-completion (agent.complete) can
          // advance this post POSTING → POSTED (or FAILED) for real.
          if (flow) {
            await createJobRecord(
              'RPA_RUN',
              { deviceId, flowId: flow.id, steps: flow.steps, caption: post.caption, scheduledPostId: post.id } as unknown as JobPayload,
              undefined,
              post.workspaceId ?? undefined
            );
          }
        }

        // HONEST status: when a posting flow is attached, the RPA jobs are only
        // QUEUED on the device(s) now — the agent runs them afterwards and may
        // still fail. So this is "POSTING" (in progress), NOT a confirmed "POSTED".
        // Without a flow there is nothing to execute on-device, so the dispatch
        // itself is the terminal action → a real POSTED.
        if (flow) {
          await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'POSTING' } });
        } else {
          await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'POSTED', postedAt: now } });
        }
        dispatched += 1;
      } catch (e) {
        await prisma.scheduledPost
          .update({ where: { id: post.id }, data: { status: 'FAILED', error: e instanceof Error ? e.message : 'hata' } })
          .catch(() => undefined);
      }
    }
    return { dispatched };
  },

  // Called from agent.complete when a posting RPA_RUN job (tagged with
  // scheduledPostId) finishes. Advances the post from POSTING to its real terminal
  // state: the first COMPLETED job marks it POSTED; a FAILED job marks it FAILED.
  // Only acts while the post is still POSTING so we never override a settled state
  // or re-fire on a second device's job.
  async resolvePosting(postId: string, ok: boolean, error?: string): Promise<void> {
    const post = await prisma.scheduledPost.findUnique({ where: { id: postId } });
    if (!post || post.status !== 'POSTING') return;
    if (ok) {
      await prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'POSTED', postedAt: new Date() } });
    } else {
      await prisma.scheduledPost.update({
        where: { id: postId },
        data: { status: 'FAILED', error: error || 'Gönderi akışı cihazda başarısız oldu' }
      });
    }
  }
};
