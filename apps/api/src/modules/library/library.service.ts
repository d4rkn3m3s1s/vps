import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import type { LibraryAssetType } from '@prisma/client';

export async function listAssets() {
  return prisma.libraryAsset.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createAsset(input: {
  name: string;
  type?: LibraryAssetType | undefined;
  sizeBytes?: number | undefined;
  url?: string | undefined;
  tags?: string[] | undefined;
}) {
  return prisma.libraryAsset.create({
    data: {
      name: input.name,
      ...(input.type ? { type: input.type } : {}),
      ...(typeof input.sizeBytes === 'number' ? { sizeBytes: input.sizeBytes } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.tags ? { tags: input.tags } : {})
    }
  });
}

export async function deleteAsset(id: string) {
  const asset = await prisma.libraryAsset.findUnique({ where: { id } });
  if (!asset) throw new AppError('Asset not found', 404, 'ASSET_NOT_FOUND');
  await prisma.libraryAsset.delete({ where: { id } });
  return { id };
}
