import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { assertSafePublicUrl } from '../../lib/urlGuard';
import { createJobRecord } from '../jobs/jobs.service';

export type PushFileInput = {
  deviceIds: string[];
  // Either a direct URL or a Library asset id.
  url?: string | undefined;
  libraryAssetId?: string | undefined;
  // Destination on the phone: gallery (DCIM), downloads, or a raw path.
  destination?: 'gallery' | 'downloads' | undefined;
  fileName?: string | undefined;
};

export class FilesService {
  // Pushes a file to each selected cloud phone by recording one job per device.
  async push(input: PushFileInput, workspaceId?: string) {
    if (input.deviceIds.length === 0) {
      throw new AppError('At least one device is required', 400, 'NO_DEVICES');
    }

    let url = input.url;
    let fileName = input.fileName;

    if (input.libraryAssetId) {
      // Workspace-scoped: cannot pull another tenant's library asset by id.
      const asset = await prisma.libraryAsset.findFirst({
        where: { id: input.libraryAssetId, ...(workspaceId ? { workspaceId } : {}) }
      });
      if (!asset) throw new AppError('Library asset not found', 404, 'ASSET_NOT_FOUND');
      url = asset.url ?? url;
      fileName = fileName ?? asset.name;
    }

    if (!url) throw new AppError('A file URL or library asset is required', 400, 'NO_SOURCE');
    // SSRF guard: the host agent fetches this URL server-side. Skip the check for
    // library-asset URLs (those are operator-curated, not arbitrary user input).
    if (input.url && !input.libraryAssetId) await assertSafePublicUrl(input.url);

    // Validate devices exist AND belong to the caller's workspace (prevents
    // pushing files onto another tenant's devices).
    const devices = await prisma.device.findMany({
      where: { id: { in: input.deviceIds }, ...(workspaceId ? { workspaceId } : {}) },
      select: { id: true }
    });
    const known = new Set(devices.map((d) => d.id));
    const missing = input.deviceIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new AppError(`Unknown device(s): ${missing.join(', ')}`, 404, 'DEVICE_NOT_FOUND');
    }

    const destination = input.destination ?? 'gallery';
    const jobs = await Promise.all(
      input.deviceIds.map((deviceId) =>
        createJobRecord(
          'EMULATOR_PUSH_FILE',
          {
            deviceId,
            url,
            fileName: fileName ?? 'file',
            destination
          },
          undefined,
          workspaceId
        )
      )
    );

    return { pushed: jobs.length, jobIds: jobs.map((j) => j.id) };
  }
}

export const filesService = new FilesService();
