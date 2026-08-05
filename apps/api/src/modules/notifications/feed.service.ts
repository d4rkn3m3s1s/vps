import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { deviceHub } from '../devices/device.hub';

// Panelin bildirim merkezi için KALICI besleme.
//
// ★2026-07-29 — NEDEN SUNUCUDA: bildirimler eskiden yalnızca tarayıcı belleğinde
// (NotificationCenter'da `useState([])`) tutuluyordu. Sonuçları: (1) sayfa yenilenince
// hepsi kayboluyordu, (2) "okundu" bilgisi uçuyordu, (3) istemci /api/jobs'u fark-alarak
// bildirim üretiyordu ve her mount'ta ilk turu bilerek atıyordu — yani operatör panelde
// DEĞİLKEN biten işler hiç görünmüyordu. Artık kaynak burası; panel açılışta hidrat eder.

export type NotificationKind = 'ok' | 'err' | 'info';

export type CreateNotificationInput = {
  kind: NotificationKind;
  title: string;
  detail?: string;
  refType?: 'job' | 'alert' | 'device';
  refId?: string;
};

// Feed'i şişirmemek için üst sınır: bir workspace'te bu sayıdan fazlası birikirse
// en eskiler budanır. Panel zaten son 50'yi gösteriyor.
const MAX_PER_WORKSPACE = 200;

// Bildirim üret + panele canlı ittir.
//
// ⚠️ Bilerek "best-effort": bildirim yazımı ASLA çağıran iş akışını (job tamamlama,
// alarm fırlatma) bozmamalı. Bu yüzden her hata yutulur ve yalnızca loglanır.
export async function createNotification(
  workspaceId: string | null | undefined,
  input: CreateNotificationInput
): Promise<void> {
  if (!workspaceId) return; // workspace'siz bağlam (servis anahtarı) → besleme yok
  try {
    const row = await prisma.notification.create({
      data: {
        workspaceId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        detail: (input.detail ?? '').slice(0, 500),
        ...(input.refType ? { refType: input.refType } : {}),
        ...(input.refId ? { refId: input.refId } : {})
      },
      select: { id: true, kind: true, title: true, detail: true, refType: true, refId: true, read: true, createdAt: true }
    });

    // Panel bu olayı zaten dinliyor (NotificationCenter → useFleetEvents).
    // deviceId zorunlu alan ama bildirim cihaza bağlı olmayabilir → ilgili cihaz
    // varsa onu ver, yoksa boş bırak (hub bunu tenant bazlı yayınlar).
    deviceHub.broadcast({
      type: 'notification.created',
      deviceId: input.refType === 'device' ? (input.refId ?? '') : '',
      payload: row,
      timestamp: new Date().toISOString(),
      workspaceId
    });

    // Budama: sık yazılan bir feed'in sınırsız büyümesini engelle. Sayım ucuz
    // (workspaceId+createdAt indeksli) ve yalnızca eşik aşılınca silme yapılır.
    const total = await prisma.notification.count({ where: { workspaceId } });
    if (total > MAX_PER_WORKSPACE) {
      const stale = await prisma.notification.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        skip: MAX_PER_WORKSPACE,
        select: { id: true }
      });
      if (stale.length) {
        await prisma.notification.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      }
    }
  } catch (err) {
    logger.warn('notification create failed', { error: (err as Error).message });
  }
}

export async function listNotifications(
  workspaceId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {}
): Promise<{ items: unknown[]; unreadCount: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { workspaceId, ...(opts.unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, kind: true, title: true, detail: true, refType: true, refId: true, read: true, createdAt: true }
    }),
    prisma.notification.count({ where: { workspaceId, read: false } })
  ]);
  return { items, unreadCount };
}

// ids boşsa TÜMÜ okundu işaretlenir (panelde zil açılınca yapılan davranış).
export async function markRead(workspaceId: string, ids?: string[]): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { workspaceId, read: false, ...(ids && ids.length ? { id: { in: ids } } : {}) },
    data: { read: true }
  });
  return res.count;
}

export async function clearNotifications(workspaceId: string): Promise<number> {
  const res = await prisma.notification.deleteMany({ where: { workspaceId } });
  return res.count;
}

// ── Job → bildirim eşlemesi ──────────────────────────────────────────────────
//
// Her job bildirime dönüşmez. WHATSAPP_RECEIPTS gibi yüksek hacimli arka plan
// okumaları feed'i boğar (canlı ölçüm: son 24 saatte 2175 adet) — operatör bunları
// görmek istemez. Yalnızca operatörün başlattığı / sonucunu beklediği işler bildirilir.
const NOISY_JOB_TYPES = new Set([
  'WHATSAPP_RECEIPTS',
  'WHATSAPP_UNREAD',
  'WHATSAPP_READ',
  'WHATSAPP_CONTACTS',
  'WHATSAPP_CHAT_SUMMARY',
  'EMULATOR_SCREENSHOT',
  'DEVICE_HEARTBEAT'
]);

// ★2026-08-05 SESSİZ-BAŞARI kümesi. Bunlar operatörün ELLE başlatmadığı, arka planda
// kendiliğinden dönen rutin işler. BAŞARILI sonuçları hiçbir bilgi taşımıyor ama feed'i
// dolduruyordu — canlı: operatör ekranında "Hesap sağlığı tamamlandı" ve "WHATSAPP_PROFILE
// tamamlandı" satırları saniyeler arayla art arda akıyor, aralarındaki GERÇEK olaylar
// (🚫 BANLANDI, ⚠️ KISITLANDI) kayboluyordu.
// Kural: bu tiplerde YALNIZCA kötü sonuç bildirilir (ban/kısıt/başarısızlık). Böylece
// sinyal korunur, gürültü gider. NOISY_JOB_TYPES'tan farkı: orada tip TAMAMEN susturulur.
const QUIET_WHEN_OK_JOB_TYPES = new Set([
  'WHATSAPP_ACCOUNT_HEALTH',   // otonom sağlık taraması
  'WHATSAPP_PROFILE',          // profil okuma — canlıda saniyeler arayla akıyordu
  'WHATSAPP_SET_NAME',         // profil ismi — toplu akışta sürekli tetikleniyor
  'WHATSAPP_SET_AVATAR',
  'WHATSAPP_MYNUMBER'          // numara okuma — tamamen otomatik
]);

export function shouldNotifyForJob(type: string): boolean {
  return !NOISY_JOB_TYPES.has(type);
}

// Job tipini operatörün okuyabileceği bir başlığa çevir (panelde ham enum görünmesin).
const JOB_LABEL: Record<string, string> = {
  WHATSAPP_SEND: 'WhatsApp mesajı',
  WHATSAPP_SEND_MEDIA: 'WhatsApp medya gönderimi',
  WHATSAPP_SET_NAME: 'WhatsApp profil ismi',
  WHATSAPP_SET_AVATAR: 'WhatsApp profil resmi',
  WHATSAPP_BLOCK: 'WhatsApp engelleme',
  WHATSAPP_MYNUMBER: 'Numara okuma',
  WHATSAPP_ACCOUNT_HEALTH: 'Hesap sağlığı',
  REGISTER_WHATSAPP: 'WhatsApp kaydı',
  PROVISION_DEVICE: 'Cihaz kurulumu',
  RPA_RUN: 'RPA akışı'
};

export function jobNotification(job: {
  id: string;
  type: string;
  status: string;
  error?: string | null;
  result?: unknown;
}): CreateNotificationInput | null {
  if (!shouldNotifyForJob(job.type)) return null;
  const label = JOB_LABEL[job.type] ?? job.type;
  if (job.status === 'COMPLETED') {
    // ★COMPLETED "başarılı" demek DEĞİL: on-device işler result.status ile gerçek
    // sonucu taşır (SENT / ACCOUNT_BANNED / CHAT_NOT_OPENED…). Panelin yalancı
    // "tamamlandı" göstermemesi için bunu ayırt ediyoruz.
    const rstatus = (job.result as { status?: string } | null)?.status;
    const bad = rstatus && !['SENT', 'OK', 'DONE'].includes(rstatus);
    // ★2026-08-05 Rutin arka-plan işlerinin BAŞARILI sonucunu bildirme (bkz.
    // QUIET_WHEN_OK_JOB_TYPES). Kötü sonuç (ban/kısıt/NO_CHAT…) her zaman geçer.
    if (!bad && QUIET_WHEN_OK_JOB_TYPES.has(job.type)) return null;
    return {
      kind: bad ? 'err' : 'ok',
      title: bad ? `${label} — sonuç: ${rstatus}` : `${label} tamamlandı`,
      detail: bad ? String(rstatus) : '',
      refType: 'job',
      refId: job.id
    };
  }
  if (job.status === 'FAILED') {
    return {
      kind: 'err',
      title: `${label} başarısız`,
      detail: job.error ? String(job.error).slice(0, 300) : '',
      refType: 'job',
      refId: job.id
    };
  }
  return null;
}
