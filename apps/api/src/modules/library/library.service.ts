import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import type { LibraryAssetType } from '@prisma/client';

export async function listAssets(workspaceId: string) {
  return prisma.libraryAsset.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export async function createAsset(
  workspaceId: string,
  input: {
    name: string;
    type?: LibraryAssetType | undefined;
    sizeBytes?: number | undefined;
    url?: string | undefined;
    tags?: string[] | undefined;
  }
) {
  return prisma.libraryAsset.create({
    data: {
      workspaceId,
      name: input.name,
      ...(input.type ? { type: input.type } : {}),
      ...(typeof input.sizeBytes === 'number' ? { sizeBytes: input.sizeBytes } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.tags ? { tags: input.tags } : {})
    }
  });
}

export async function deleteAsset(workspaceId: string, id: string) {
  // Scope the lookup to the caller's workspace so one tenant can't delete
  // another's asset by guessing its id.
  // Atomic, workspace-scoped delete: deleteMany with the workspace filter means a
  // row outside the caller's workspace is simply never matched (no TOCTOU window).
  const { count } = await prisma.libraryAsset.deleteMany({ where: { id, workspaceId } });
  if (count === 0) throw new AppError('Asset not found', 404, 'ASSET_NOT_FOUND');
  return { id };
}
