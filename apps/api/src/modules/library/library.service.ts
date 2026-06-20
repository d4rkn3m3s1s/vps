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
  const asset = await prisma.libraryAsset.findFirst({ where: { id, workspaceId } });
  if (!asset) throw new AppError('Asset not found', 404, 'ASSET_NOT_FOUND');
  await prisma.libraryAsset.delete({ where: { id } });
  return { id };
}
