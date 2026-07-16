import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { assertSafePublicUrl } from '../../lib/urlGuard';
import { createJobRecord } from '../jobs/jobs.service';
import { APP_CATALOG } from './catalog.seed';

export class CatalogService {
  // Verify every requested device belongs to the caller's workspace before we
  // dispatch install/automation jobs against them. Without this, a client could
  // pass foreign device ids and drive/install onto another tenant's phones.
  private async assertDevicesOwned(deviceIds: string[], workspaceId?: string): Promise<void> {
    if (deviceIds.length === 0 || !workspaceId) return;
    const owned = await prisma.device.findMany({
      where: { id: { in: deviceIds }, workspaceId },
      select: { id: true }
    });
    if (owned.length !== new Set(deviceIds).size) {
      throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    }
  }

  // ---------- Applications ----------
  async listApps() {
    await this.seedApps();
    return prisma.appCatalogItem.findMany({ orderBy: { name: 'asc' } });
  }

  private async seedApps(): Promise<void> {
    if ((await prisma.appCatalogItem.count()) > 0) return;
    await prisma.appCatalogItem.createMany({ data: APP_CATALOG });
  }

  // Installs an app onto each device: records an INSTALL_APK job + bumps counter.
  // The agent's installApk requires a real apkPath/apkUrl, so we resolve one from
  // (in priority) the caller-supplied apkUrl, else the catalog item's apkUrl. If
  // neither exists we throw a clear error instead of dispatching a job that would
  // fail at the agent with "apkPath is required".
  async installApp(packageName: string, deviceIds: string[], apkUrl?: string, workspaceId?: string) {
    const app = await prisma.appCatalogItem.findUnique({ where: { packageName } });
    const resolvedApk = apkUrl || app?.apkUrl || null;
    if (!resolvedApk) {
      throw new AppError(
        `"${packageName}" için APK bağlantısı yok. Lütfen bir APK indirme URL'si girin (Play Store paketleri doğrudan kurulamaz).`,
        422,
        'APK_URL_REQUIRED'
      );
    }
    if (deviceIds.length === 0) {
      throw new AppError('En az bir cihaz seçin.', 422, 'NO_DEVICES');
    }
    // SSRF guard: the host agent fetches apkPath server-side, so a user-supplied
    // APK URL must not point at internal/loopback/metadata addresses.
    await assertSafePublicUrl(resolvedApk);
    await this.assertDevicesOwned(deviceIds, workspaceId);
    const jobs = await Promise.all(
      deviceIds.map((deviceId) =>
        createJobRecord('EMULATOR_INSTALL_APK', { deviceId, packageName, apkPath: resolvedApk }, undefined, workspaceId)
      )
    );
    if (app) {
      await prisma.appCatalogItem.update({ where: { id: app.id }, data: { installs: { increment: deviceIds.length } } });
    }
    return { installed: jobs.length, jobIds: jobs.map((j) => j.id) };
  }

  // (Automation templates + Marketplace listings were removed — the seeded templates
  // were all "just open the app" no-ops and the marketplace listings were APK-less
  // placeholders whose "Kur" only bumped a counter. Real app installs go through
  // installApp / the /apks Fleet-APK path instead.)
}

export const catalogService = new CatalogService();
