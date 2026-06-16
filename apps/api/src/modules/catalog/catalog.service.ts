import type { JobType, ListingCategory, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { createJobRecord } from '../jobs/jobs.service';
import { APP_CATALOG, AUTOMATION_TEMPLATES, MARKETPLACE_LISTINGS } from './catalog.seed';

export class CatalogService {
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
  async installApp(packageName: string, deviceIds: string[]) {
    const app = await prisma.appCatalogItem.findUnique({ where: { packageName } });
    const jobs = await Promise.all(
      deviceIds.map((deviceId) =>
        createJobRecord('EMULATOR_INSTALL_APK', {
          deviceId,
          packageName,
          apkPath: app?.apkUrl ?? undefined
        })
      )
    );
    if (app) {
      await prisma.appCatalogItem.update({ where: { id: app.id }, data: { installs: { increment: deviceIds.length } } });
    }
    return { installed: jobs.length, jobIds: jobs.map((j) => j.id) };
  }

  // ---------- Automation templates ----------
  async listTemplates() {
    await this.seedTemplates();
    return prisma.automationTemplate.findMany({ orderBy: [{ recommended: 'desc' }, { title: 'asc' }] });
  }

  private async seedTemplates(): Promise<void> {
    if ((await prisma.automationTemplate.count()) > 0) return;
    await prisma.automationTemplate.createMany({
      data: AUTOMATION_TEMPLATES.map((t) => ({
        title: t.title,
        description: t.description,
        platform: t.platform,
        color: t.color,
        jobType: t.jobType as JobType,
        payload: t.payload as Prisma.InputJsonValue,
        recommended: t.recommended
      }))
    });
  }

  // Runs a template against devices: one job per device using the template's
  // job type + payload, plus a uses counter.
  async useTemplate(templateId: string, deviceIds: string[]) {
    const tpl = await prisma.automationTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) return { used: 0, jobIds: [] as string[] };
    const jobs = await Promise.all(
      deviceIds.map((deviceId) =>
        createJobRecord(tpl.jobType, { ...(tpl.payload as Record<string, unknown>), deviceId })
      )
    );
    await prisma.automationTemplate.update({ where: { id: tpl.id }, data: { uses: { increment: deviceIds.length } } });
    return { used: jobs.length, jobIds: jobs.map((j) => j.id), template: tpl.title };
  }

  // ---------- Marketplace ----------
  async listListings() {
    await this.seedListings();
    return prisma.marketplaceListing.findMany({ orderBy: { installs: 'desc' } });
  }

  private async seedListings(): Promise<void> {
    if ((await prisma.marketplaceListing.count()) > 0) return;
    await prisma.marketplaceListing.createMany({
      data: MARKETPLACE_LISTINGS.map((l) => ({
        title: l.title,
        description: l.description,
        category: l.category as ListingCategory,
        icon: l.icon,
        price: l.price,
        installs: l.installs
      }))
    });
  }

  async installListing(id: string) {
    const listing = await prisma.marketplaceListing.findUnique({ where: { id } });
    if (!listing) return null;
    return prisma.marketplaceListing.update({ where: { id }, data: { installs: { increment: 1 } } });
  }
}

export const catalogService = new CatalogService();
