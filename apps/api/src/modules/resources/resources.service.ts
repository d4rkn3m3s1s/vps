import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

// Default FAQ entries seeded per workspace on first read, so the Resources page
// is never empty but operators can edit/add/remove their own afterwards.
const DEFAULT_GUIDES: Array<{ question: string; answer: string }> = [
  {
    question: '“Başlat” neden bir telefonu PENDING durumunda tutuyor?',
    answer:
      'Bulut telefonlar KVM destekli bir sunucuda çalışır. Bir Android sunucu bağlanana kadar işler kaydedilir ancak çalıştırılmaz. Sunucu kurulum rehberine bakın.'
  },
  {
    question: 'Nasıl proxy eklerim?',
    answer:
      'Proxyler → Proxy ekle bölümüne gidin. Sunucu/port/kimlik bilgilerini girin, ardından çıkış IP’sini doğrulamak için Kontrol et’e basın.'
  },
  {
    question: 'API anahtarlarım nerede?',
    answer:
      'API anahtarları kullanıcı başına verilir. Arka uç yazma işlemleri, API anahtarınızdan otomatik olarak alınan bir JWT gerektirir.'
  },
  {
    question: 'Senkronizatör nasıl çalışır?',
    answer:
      'İki veya daha fazla telefon seçin, birini lider olarak işaretleyin; sunucu bağlandıktan sonra liderin girişleri gerçek zamanlı olarak takipçilere yansıtılır.'
  }
];

export const resourcesService = {
  async listGuides(workspaceId: string) {
    await this.seedIfEmpty(workspaceId);
    return prisma.resourceGuide.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });
  },

  // Idempotent: only seeds when this workspace has no guides yet.
  async seedIfEmpty(workspaceId: string): Promise<void> {
    const count = await prisma.resourceGuide.count({ where: { workspaceId } });
    if (count > 0) return;
    await prisma.resourceGuide.createMany({
      data: DEFAULT_GUIDES.map((g, i) => ({ ...g, workspaceId, sortOrder: i }))
    });
  },

  async createGuide(
    workspaceId: string,
    input: { question: string; answer: string; sortOrder?: number | undefined }
  ) {
    return prisma.resourceGuide.create({
      data: {
        workspaceId,
        question: input.question,
        answer: input.answer,
        ...(typeof input.sortOrder === 'number' ? { sortOrder: input.sortOrder } : {})
      }
    });
  },

  async updateGuide(
    workspaceId: string,
    id: string,
    input: { question?: string | undefined; answer?: string | undefined; sortOrder?: number | undefined }
  ) {
    const existing = await prisma.resourceGuide.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new AppError('Guide not found', 404, 'GUIDE_NOT_FOUND');
    return prisma.resourceGuide.update({
      where: { id },
      data: {
        ...(input.question !== undefined ? { question: input.question } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(typeof input.sortOrder === 'number' ? { sortOrder: input.sortOrder } : {})
      }
    });
  },

  async deleteGuide(workspaceId: string, id: string) {
    const existing = await prisma.resourceGuide.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new AppError('Guide not found', 404, 'GUIDE_NOT_FOUND');
    await prisma.resourceGuide.delete({ where: { id } });
    return { id };
  }
};
