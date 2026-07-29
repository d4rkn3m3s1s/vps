import type { GeneratedAccountStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';

// ★TEK DOĞRULUK KAYNAĞI — bir cihazın WhatsApp durumu.
//
// Bu dosya bilerek bağımlılıksızdır (sadece prisma): device.service, batch.service
// ve public modülü aynı kuralı buradan okur. Kuralın çift yaşaması geçmişte somut
// bir hataya yol açtı — panel kartı "EN YENİ hesap satırı"na bakarken send-guard
// "hiç banlanmış mı" diye bakıyordu, yani panel "sağlıklı" derken API 409 veriyordu
// (2026-07-28, batch.service.ts:448 yorumundaki canlı kanıt). Bir daha ayrışmasın
// diye kategori SADECE burada hesaplanır.

export type DeviceWhatsappCategory = 'empty' | 'manual' | 'registering' | 'whatsapp' | 'blocked';

// Kategoriye girebilecek TÜM hesap durumları. Sorgu filtresi olarak da kullanılır;
// buraya eklenmeyen bir durum "hesap yok" (empty) sayılır.
const CATEGORIZED_STATUSES: GeneratedAccountStatus[] = [
  'IDENTITY_READY',
  'CONTACT_READY',
  'AWAITING_OTP',
  'REGISTERING',
  'ACTIVE',
  'AWAITING_MANUAL',
  'RESTRICTED',
  'BANNED',
  'LOGGED_OUT'
];

// PENDING ve FAILED bilerek DIŞARIDA: ikisi de "kullanılabilir hesap yok" demek,
// yani cihaz boştur (yeni kayıt yapılabilir).
const REGISTERING = new Set<string>(['IDENTITY_READY', 'CONTACT_READY', 'AWAITING_OTP', 'REGISTERING']);
const LIVE = new Set<string>(['ACTIVE', 'AWAITING_MANUAL', 'RESTRICTED']);
const DEAD = new Set<string>(['BANNED', 'LOGGED_OUT']);

// Saf fonksiyon: EN YENİ hesap satırının durumu → kategori.
//
// `isProtected` = Device.protected. ★ELLE KAYDEDİLEN CİHAZLARIN İŞARETİ: operatör
// bir numarayı panel dışında (elle) kaydettiğinde GeneratedAccount satırı oluşmaz,
// ama cihaz "korumalı" işaretlenir (şemadaki tanım: "valuable phones, e.g. one
// holding an active WhatsApp account"). Satır yokluğuna bakıp bu cihazlara 'empty'
// deseydik, gerçekte hesabı OLAN cihazlarda tüm WhatsApp uçları 409 verirdi.
// 28 Tem canlı ölçümü bunu doğruladı: satırsız 14 cihazın protected olan 2'sinde
// (watest34, watest46) WhatsApp cihazda KAYITLI, protected olmayan 12'sinde değil.
export function whatsappCategoryOf(
  status: string | null | undefined,
  isProtected = false
): DeviceWhatsappCategory {
  if (!status) return isProtected ? 'manual' : 'empty';
  if (LIVE.has(status)) return 'whatsapp';
  if (DEAD.has(status)) return 'blocked';
  if (REGISTERING.has(status)) return 'registering';
  // PENDING / FAILED / bilinmeyen = kullanılabilir hesap yok.
  return isProtected ? 'manual' : 'empty';
}

export type DeviceWhatsappState = {
  category: DeviceWhatsappCategory;
  // Hesabın ham durumu (ACTIVE / BANNED / …) — null ise hiç hesap yok.
  status: string | null;
  phone: string | null;
  // Sorun rozeti: sadece RESTRICTED / BANNED / LOGGED_OUT, aksi halde null.
  // (Mevcut `waAccountHealth` alanının kaynağı — davranışı korumak için burada.)
  health: string | null;
};

export const EMPTY_WHATSAPP_STATE: DeviceWhatsappState = {
  category: 'empty',
  status: null,
  phone: null,
  health: null
};

function toState(
  row: { status: string; phoneNumber: string | null } | undefined,
  isProtected: boolean
): DeviceWhatsappState {
  if (!row) {
    return isProtected ? { ...EMPTY_WHATSAPP_STATE, category: 'manual' } : EMPTY_WHATSAPP_STATE;
  }
  return {
    category: whatsappCategoryOf(row.status, isProtected),
    status: row.status,
    phone: row.phoneNumber ?? null,
    health:
      row.status === 'RESTRICTED' || row.status === 'BANNED' || row.status === 'LOGGED_OUT'
        ? row.status
        : null
  };
}

// Çok cihaz için TEK grouped sorgu (N+1 yok). Her cihaz için EN YENİ satır kazanır.
// `protectedIds` verilmezse Device tablosundan tek sorguyla okunur; çağıran zaten
// cihaz satırlarını elinde tutuyorsa (listDevices) geçirerek o sorguyu atlayabilir.
export async function getWhatsappStates(
  deviceIds: string[],
  protectedIds?: Set<string>
): Promise<Map<string, DeviceWhatsappState>> {
  const out = new Map<string, DeviceWhatsappState>();
  if (!deviceIds.length) return out;
  let prot = protectedIds;
  if (!prot) {
    const rows = await prisma.device.findMany({
      where: { id: { in: deviceIds }, protected: true },
      select: { id: true }
    });
    prot = new Set(rows.map((r) => r.id));
  }
  const rows = await prisma.generatedAccount.findMany({
    where: {
      deviceId: { in: deviceIds },
      platform: 'whatsapp',
      status: { in: CATEGORIZED_STATUSES }
    },
    orderBy: { createdAt: 'desc' },
    select: { deviceId: true, phoneNumber: true, status: true }
  });
  // findMany newest-first → cihaz başına İLK görülen satır en yenisidir.
  for (const r of rows) {
    if (r.deviceId && !out.has(r.deviceId)) out.set(r.deviceId, toState(r, prot.has(r.deviceId)));
  }
  // Satırı olmayan ama KORUMALI cihazlar da 'manual' olarak işaretlenmeli — bunlar
  // yukarıdaki döngüye hiç girmez (GeneratedAccount kaydı yok).
  for (const id of deviceIds) {
    if (!out.has(id) && prot.has(id)) out.set(id, { ...EMPTY_WHATSAPP_STATE, category: 'manual' });
  }
  return out;
}

// Tek cihaz. Cihazın workspace'e ait olduğu ÇAĞIRAN tarafından doğrulanmalıdır —
// bu fonksiyon yalnızca hesap durumunu okur, yetki kontrolü yapmaz.
export async function getWhatsappState(deviceId: string): Promise<DeviceWhatsappState> {
  const [device, row] = await Promise.all([
    prisma.device.findUnique({ where: { id: deviceId }, select: { protected: true } }),
    prisma.generatedAccount.findFirst({
      where: {
        deviceId,
        platform: 'whatsapp',
        status: { in: CATEGORIZED_STATUSES }
      },
      orderBy: { createdAt: 'desc' },
      select: { phoneNumber: true, status: true }
    })
  ]);
  return toState(row ?? undefined, device?.protected === true);
}

// ── Yetenek matrisi ────────────────────────────────────────────────────────────
// public.middleware'in 409 kararı ve /v1/devices/:id'nin capabilities listesi AYNI
// tablodan türer; ayrı listeler tutulursa zamanla ayrışırlar.

export type WhatsappAccessMode = 'send' | 'read' | 'register';

export type AccessDecision =
  | { allowed: true; warning?: string }
  | { allowed: false; code: string; message: string };

export type AccessOptions = {
  // Hesap SATIRININ varlığını şart koş (public API'nin varsayılanı: boş cihaz 409).
  //
  // false yapılırsa yalnızca ÖLÜ hesap (BANNED/LOGGED_OUT) reddedilir, "satır yok"
  // geçer. Dashboard'un WhatsApp sayfası bunu kullanır: cihaz seçer, hesap satırı
  // şart koşmaz — canlı filoda DB'de satırı olmayan ama cihazda WhatsApp'ı KAYITLI
  // cihazlar mevcut (28 Tem ölçümü: watest46). Onları kırmamak için iç yol gevşek,
  // public API katı kalır; katı taraftaki kaçış valfi account/health + account/number
  // uçlarıdır (guard'sız — gerçeği cihazdan okuyup DB'yi tazelerler).
  requireAccountRow?: boolean;
};

export function checkWhatsappAccess(
  state: DeviceWhatsappState,
  mode: WhatsappAccessMode,
  opts: AccessOptions = {}
): AccessDecision {
  const { category, status } = state;
  const requireAccountRow = opts.requireAccountRow !== false;

  if (mode === 'register') {
    // Kayıt yalnızca kayıt SÜRERKEN engellenir (çift kayıt cihazı bozar). Canlı
    // hesabı olan cihazda kayıt serbesttir ama mevcut hesabı siler — bu uyarı
    // provision/register akışının kendi veri-kaybı guard'ında zaten veriliyor.
    if (category === 'registering') {
      return {
        allowed: false,
        code: 'REGISTRATION_IN_PROGRESS',
        message: 'Bu cihazda bir WhatsApp kaydı zaten sürüyor — bitmesini bekleyin veya kaydı iptal edin.'
      };
    }
    if (category === 'manual') {
      return {
        allowed: true,
        warning:
          'Bu cihaz KORUMALI (elle kaydedilmiş hesap) — yeni kayıt mevcut hesabı siler. Emin değilseniz önce koruma işaretini kaldırın.'
      };
    }
    return { allowed: true };
  }

  // ★Elle kaydedilmiş, korumalı cihaz: DB'de hesap satırı yok ama cihazda hesap VAR.
  // Uçlar çalışmalı; yalnızca numara/sağlık bilgisi DB'de bilinmediği için uyarılır.
  if (category === 'manual') {
    return {
      allowed: true,
      warning:
        'Cihaz KORUMALI ve hesap elle kaydedilmiş — panelde numara/sağlık kaydı yok. ' +
        'POST /public/v1/whatsapp/account/health ile gerçek durumu cihazdan okuyabilirsiniz.'
    };
  }

  if (category === 'empty') {
    if (!requireAccountRow) return { allowed: true };
    return {
      allowed: false,
      code: 'NO_WHATSAPP_ACCOUNT',
      message:
        'Bu cihazda kayıtlı WhatsApp hesabı görünmüyor (boş cihaz). Önce POST /public/v1/whatsapp/register ' +
        'ile bir numara kaydedin. Cihazda hesap OLDUĞUNU düşünüyorsanız POST /public/v1/whatsapp/account/health ' +
        'çalıştırın — gerçek durumu cihazdan okuyup kaydı tazeler.'
    };
  }

  if (category === 'registering') {
    if (!requireAccountRow) return { allowed: true };
    return {
      allowed: false,
      code: 'REGISTRATION_IN_PROGRESS',
      message:
        'Bu cihazın WhatsApp kaydı henüz tamamlanmadı. GET /public/v1/whatsapp/register/{id}/status ile durumu izleyin.'
    };
  }

  if (category === 'blocked') {
    // ★Okuma serbest: banlı hesabın msgstore.db'si cihazda durur, geçmişi/medyayı
    // çekmek hâlâ geçerli bir iş. Sadece GÖNDERİM reddedilir.
    if (mode === 'read') {
      return {
        allowed: true,
        warning:
          status === 'BANNED'
            ? 'Hesap YASAKLI (ban) — sadece okuma yapılabilir, mesaj gönderilemez.'
            : 'Hesap ÇIKIŞ YAPMIŞ — sadece okuma yapılabilir, yeniden kayıt gerekiyor.'
      };
    }
    return status === 'BANNED'
      ? {
          allowed: false,
          code: 'ACCOUNT_BANNED',
          message: 'Bu cihazın WhatsApp hesabı YASAKLI (ban) — mesaj gönderilemez.'
        }
      : {
          allowed: false,
          code: 'ACCOUNT_LOGGED_OUT',
          message:
            'Bu cihazın WhatsApp hesabı ÇIKIŞ YAPMIŞ / kayıt silinmiş — mesaj gönderilemez, yeniden kayıt gerekir.'
        };
  }

  // category === 'whatsapp'. RESTRICTED bilerek GEÇER: kısıtlı hesap MEVCUT
  // sohbetlere cevap verebiliyor (canlı doğrulandı) — yalnızca yeni sohbet
  // başlatma başarısız olur, o da gönderim sonucunda raporlanır.
  return status === 'RESTRICTED'
    ? { allowed: true, warning: 'Hesap KISITLI — yeni sohbet başlatamayabilir, mevcut sohbetlere cevap verebilir.' }
    : { allowed: true };
}

// /v1/devices/:id için: bu cihazda hangi endpoint grupları çalışır?
//
// ⚠️ Buradaki `mode`, router'da o gruba bağlanan guard ile AYNI olmalıdır — aksi
// halde capabilities "çalışır" derken gerçek çağrı 409 verir. Bu yüzden
// `whatsapp.account` (health + number, guard'SIZ: gerçeği cihazdan okurlar) ile
// `whatsapp.profile` (ad + resim, cihazı sürdükleri için `send` guard'lı) ayrı
// gruplardır; ikisi tek grup olsaydı yasaklı bir cihazda liste yanıltırdı.
export const WHATSAPP_GROUPS = [
  { group: 'whatsapp.register', mode: 'register' as const, label: 'WhatsApp kayıt' },
  { group: 'whatsapp.send', mode: 'send' as const, label: 'Gönderim' },
  { group: 'whatsapp.profile', mode: 'send' as const, label: 'Kendi profilim (ad/resim)' },
  { group: 'whatsapp.chats', mode: 'read' as const, label: 'Sohbetler' },
  { group: 'whatsapp.contacts', mode: 'read' as const, label: 'Kişiler' },
  { group: 'whatsapp.data', mode: 'read' as const, label: 'Veri okuma (root-DB)' }
];

export function capabilitiesOf(state: DeviceWhatsappState): {
  available: string[];
  unavailable: Array<{ group: string; reason: string; code: string }>;
} {
  // Koşulsuz çalışan gruplar: cihaz yönetimi (liste/rename/tag/provision) ve
  // hesap teşhisi (account/health + account/number — router'da guard'ları yoktur).
  const available: string[] = ['devices', 'whatsapp.account'];
  const unavailable: Array<{ group: string; reason: string; code: string }> = [];
  for (const g of WHATSAPP_GROUPS) {
    const d = checkWhatsappAccess(state, g.mode);
    if (d.allowed) available.push(g.group);
    else unavailable.push({ group: g.group, reason: d.message, code: d.code });
  }
  return { available, unavailable };
}
