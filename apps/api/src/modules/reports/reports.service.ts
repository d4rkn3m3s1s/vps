import { prisma } from '../../db/prisma';

// Workspace-scoped operational summary over a date range. Powers the Reports
// page + CSV/JSON export. All counts are restricted to the active workspace.
export class ReportsService {
  async summary(workspaceId: string, from: Date, to: Date) {
    const range = { gte: from, lte: to };
    const ws = { workspaceId };

    const [
      deviceTotal,
      deviceOnline,
      jobsTotal,
      jobsCompleted,
      jobsFailed,
      jobsPending,
      jobsInRange,
      proxies,
      members,
      alertEvents,
      byType,
      sendJobs
    ] = await Promise.all([
      prisma.device.count({ where: ws }),
      prisma.device.count({ where: { ...ws, status: 'ONLINE' } }),
      prisma.job.count({ where: ws }),
      prisma.job.count({ where: { ...ws, status: 'COMPLETED' } }),
      prisma.job.count({ where: { ...ws, status: 'FAILED' } }),
      prisma.job.count({ where: { ...ws, status: { in: ['PENDING', 'RUNNING'] } } }),
      prisma.job.count({ where: { ...ws, createdAt: range } }),
      prisma.proxy.count({ where: ws }),
      prisma.workspaceMember.count({ where: ws }),
      prisma.alertEvent.count({ where: { ...ws, createdAt: range } }),
      prisma.job.groupBy({ by: ['type'], where: { ...ws, createdAt: range }, _count: { _all: true } }),
      // ★2026-08-04 GERÇEK GÖNDERİM ORANI (analytics'te 30 Tem'de düzeltilmişti,
      // reports'ta EDİLMEMİŞTİ — panel raporları başarıyı ŞİŞİRİYORDU).
      // `Job.status === 'COMPLETED'` yalnızca "iş koştu, ajan rapor döndü" demek;
      // mesajın gidip gitmediği `result.status`ta ('SENT' / 'CHAT_NOT_OPENED' /
      // 'ACCOUNT_RESTRICTED' / 'ACCOUNT_LOGGED_OUT'…). İkisi ayrılmazsa %96 başarı
      // görünürken gerçek oran %7 olabiliyor (canlı ölçüm, 30 Tem).
      prisma.job.findMany({
        where: { ...ws, type: 'WHATSAPP_SEND', createdAt: range },
        select: { result: true }
      })
    ]);

    // "İş koştu" oranı — altyapının çalışıp çalışmadığını gösterir.
    const total = jobsCompleted + jobsFailed;
    const successRate = total > 0 ? Math.round((jobsCompleted / total) * 100) : 0;

    // "Mesaj gerçekten gitti" oranı — operatörün asıl önemsediği sayı.
    const sendDelivered = sendJobs.filter((j) => {
      const rs = String(((j.result ?? {}) as Record<string, unknown>).status ?? '');
      return rs === 'SENT' || rs === 'OK' || rs === 'DELIVERED';
    }).length;
    const sendRate = sendJobs.length > 0 ? Math.round((sendDelivered / sendJobs.length) * 100) : 0;

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      devices: { total: deviceTotal, online: deviceOnline },
      jobs: {
        total: jobsTotal,
        completed: jobsCompleted,
        failed: jobsFailed,
        pending: jobsPending,
        inRange: jobsInRange,
        /** İŞ ÇALIŞMA oranı (COMPLETED/COMPLETED+FAILED) — gönderim başarısı DEĞİL. */
        successRate,
        /** Aralıktaki WhatsApp gönderim işi sayısı. */
        sendTotal: sendJobs.length,
        /** Bunlardan kaçı GERÇEKTEN teslim edildi (result.status). */
        sendDelivered,
        /** GERÇEK gönderim oranı — operatörün asıl önemsediği sayı. */
        sendRate
      },
      proxies,
      members,
      alertEvents,
      jobsByType: byType.map((b) => ({ type: b.type, count: b._count._all })).sort((a, b) => b.count - a.count)
    };
  }

  // Flat rows for CSV export: one row per job in range. Capped so a huge range can't
  // OOM the process — but we surface `truncated` + `total` so the caller can WARN the
  // operator that the CSV is incomplete instead of silently handing back a partial file
  // that disagrees with the dashboard's job counts.
  async jobRows(workspaceId: string, from: Date, to: Date) {
    const CAP = 50_000;
    const where = { workspaceId, createdAt: { gte: from, lte: to } };
    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      // ★2026-08-12 `select` EKLENDİ — API'yi ÇÖKERTİYORDU (CSV indir butonu).
      // `select` olmadığı için TÜM kolonlar çekiliyordu, `result` JSON'u dâhil.
      // Üstteki yorum "capped so a huge range can't OOM" diyor ama sınır SATIR
      // SAYISI (50.000); sorun satır BOYUTUYDU. CANLI ÖLÇÜM (30 günlük pencere):
      //   45.500 satır → result 410 MB · payload 12 MB · error 114 kB
      // Yani 410 MB gereksiz yere belleğe çekiliyordu ve süreç SIGABRT ile ölüyordu.
      // ★`result` aşağıdaki satır eşlemesinde HİÇ KULLANILMIYOR — bu yüzden select
      // eklemek davranışı değiştirmez, yalnızca gereksiz veriyi keser.
      // (Aynı hata analytics.service.ts'te de vardı; 12 Ağu'da orada da düzeltildi.)
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: CAP,
        select: {
          id: true, type: true, status: true, payload: true,
          emulatorId: true, createdAt: true, finishedAt: true, error: true
        }
      })
    ]);
    const rows = jobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      deviceId: (j.payload as { deviceId?: string } | null)?.deviceId ?? j.emulatorId ?? '',
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? '',
      error: j.error ?? ''
    }));
    return { rows, total, truncated: total > CAP };
  }
}

export const reportsService = new ReportsService();
