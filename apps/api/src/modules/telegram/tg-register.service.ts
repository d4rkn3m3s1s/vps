// Telegram uçtan uca WhatsApp kaydı — GERÇEK BAĞIMLILIKLAR.
//
// Algoritmanın tamamı tg-register.core.ts'dedir (testlerde aynen sınanır). Bu dosya
// yalnızca çekirdeğe dış dünyayı bağlar:
//   • Telegram Bot API çağrıları (mesaj, düzenleme, fotoğraf, canlı ekran)
//   • Veritabanı sorguları (boşta cihaz, çift kayıt, kayıt işinin ekran kareleri)
//   • Panelin kullandığı servisler (cihaz açma, kayıt, kod, yöntem, tekrar dene, iptal)
//   • Şifreli durum dosyası (oturumlar bot token'ı içerir → diske düz metin yazılmaz)
//
// Eşzamanlılık: FLEET_TG_REG_CONCURRENCY (varsayılan 4) — Telegram'dan /kayitlimit ile
// değiştirilirse o değer durum dosyasında saklanır ve env'in önüne geçer.

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { encryptString, decryptString } from '../../lib/crypto';
import { countryFromPhone } from '../accounts/auto-proxy';
import { batchService } from '../accounts/batch.service';
import { waRegisterService, getLiveRegisterShot } from '../accounts/wa-register.service';
import { provisionService } from '../provision/provision.service';
import {
  createTgRegister,
  BLOCKING_ACCOUNT_STATUSES,
  DUPLICATE_ACCOUNT_STATUSES,
  type InlineButton,
  type TgRegDeps
} from './tg-register.core';

const TICK_MS = 4_000;
const STATE_FILE = process.env.FLEET_TG_REG_STATE ?? path.join(process.cwd(), '.tg-wakayit.json');
const TG_API = 'https://api.telegram.org';

// ── Telegram Bot API ─────────────────────────────────────────────────────────
// (telegram.service.ts'deki yardımcılar modül-içi; oradan içe aktarmak döngüsel bağımlılık
// yaratırdı. Burada ihtiyaç duyulan çağrıların küçük kopyaları var.)

async function tgCall(token: string, method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<any> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(json.description || `telegram ${method} failed`);
  return json.result;
}

function b64Blob(b64: string): { blob: Blob; name: string } | null {
  const bytes = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (!bytes.length) return null;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return { blob: new Blob([bytes], { type: isJpeg ? 'image/jpeg' : 'image/png' }), name: isJpeg ? 'ekran.jpg' : 'ekran.png' };
}

async function tgMultipart(token: string, method: string, form: FormData): Promise<{ ok?: boolean; description?: string; result?: { message_id?: number } }> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  return (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
}

const deps: TgRegDeps = {
  now: () => Date.now(),
  log: (level, msg, meta) => logger[level](msg, meta ?? {}),
  countryFromPhone,

  async send(token, chatId, text, buttons) {
    try {
      const r = (await tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {})
      })) as { message_id?: number };
      return r?.message_id;
    } catch (e) {
      logger.warn('tg-kayit mesaj gonderilemedi', { error: String(e) });
      return undefined;
    }
  },

  async edit(token, chatId, messageId, text, buttons) {
    try {
      await tgCall(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: buttons ?? [] }
      });
      return true;
    } catch (e) {
      const msg = String(e);
      if (/message is not modified|retry after|Too Many Requests/i.test(msg)) return true; // mesaj sağlam; sonraki turda
      logger.warn('tg-kayit durum mesaji duzenlenemedi', { error: msg });
      return false;
    }
  },

  async sendPhoto(token, chatId, b64, caption, opts = {}) {
    const f = b64Blob(b64);
    if (!f) return undefined;
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption.slice(0, 1024));
      form.append('parse_mode', 'HTML');
      if (opts.forceReply) {
        // Kullanıcının Telegram'ı bu mesaja otomatik "yanıtla" moduna geçer — kodu yazmak yeter.
        form.append('reply_markup', JSON.stringify({ force_reply: true, input_field_placeholder: 'Kodu yazın (örn. 123456)' }));
      } else if (opts.buttons?.length) {
        form.append('reply_markup', JSON.stringify({ inline_keyboard: opts.buttons }));
      }
      form.append('photo', f.blob, f.name);
      const json = await tgMultipart(token, 'sendPhoto', form);
      if (!json.ok) { logger.warn('tg-kayit ekran goruntusu gonderilemedi', { error: json.description }); return undefined; }
      return json.result?.message_id;
    } catch (e) {
      logger.warn('tg-kayit ekran goruntusu gonderilemedi', { error: String(e) });
      return undefined;
    }
  },

  async editPhoto(token, chatId, messageId, b64, caption) {
    const f = b64Blob(b64);
    if (!f) return 'skip';
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('message_id', String(messageId));
      form.append('media', JSON.stringify({ type: 'photo', media: 'attach://kare', caption: caption.slice(0, 1024), parse_mode: 'HTML' }));
      form.append('kare', f.blob, f.name);
      const json = await tgMultipart(token, 'editMessageMedia', form);
      if (json.ok) return 'ok';
      const d = String(json.description ?? '');
      if (/not modified|retry after|Too Many Requests/i.test(d)) return 'skip';
      if (/message to edit not found|message can't be edited|MESSAGE_ID_INVALID/i.test(d)) return 'gone';
      logger.warn('tg-kayit canli ekran guncellenemedi', { error: d });
      return 'skip';
    } catch (e) {
      logger.warn('tg-kayit canli ekran guncellenemedi', { error: String(e) });
      return 'skip';
    }
  },

  async editCaption(token, chatId, messageId, caption) {
    await tgCall(token, 'editMessageCaption', { chat_id: chatId, message_id: messageId, caption: caption.slice(0, 1024), parse_mode: 'HTML' }).catch(() => undefined);
  },

  // ── Veri ──
  async occupiedDeviceIds(workspaceId) {
    // GeneratedAccount.deviceId düz alan (Prisma ilişkisi YOK) → dolu cihazlar ayrı sorgulanır.
    const rows = await prisma.generatedAccount.findMany({
      where: { workspaceId, deviceId: { not: null }, status: { in: BLOCKING_ACCOUNT_STATUSES as never } },
      select: { deviceId: true },
      distinct: ['deviceId']
    });
    return rows.map((r) => r.deviceId!).filter(Boolean);
  },

  async onlineDevices(workspaceId, excludeIds) {
    return prisma.device.findMany({
      where: { workspaceId, status: 'ONLINE', protected: false, id: { notIn: excludeIds } },
      select: { id: true, name: true, metadata: true },
      take: 50
    });
  },

  async busyJobCount(deviceId) {
    return prisma.job.count({ where: { deviceId, status: { in: ['PENDING', 'RUNNING'] } } });
  },

  async duplicateAccounts(workspaceId, phonesE164) {
    const rows = await prisma.generatedAccount.findMany({
      where: { workspaceId, platform: 'whatsapp', phoneNumber: { in: phonesE164 }, status: { in: DUPLICATE_ACCOUNT_STATUSES as never } },
      select: { phoneNumber: true, status: true }
    });
    return rows.map((r) => ({ phoneNumber: String(r.phoneNumber ?? ''), status: String(r.status) }));
  },

  async latestRegisterJob(accountId) {
    // payload.accountId ile DOĞRUDAN eşleşme — panelin `take: 30` penceresinden bağımsız
    // (toplu kayıtta 30'dan fazla iş olunca eski hesabın karesi kaybolmasın).
    const job = await prisma.job
      .findFirst({
        where: { type: 'REGISTER_WHATSAPP', payload: { path: ['accountId'], equals: accountId } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, result: true }
      })
      .catch(() => null);
    return job ? { id: job.id, status: String(job.status), result: (job.result ?? {}) as Record<string, unknown> } : null;
  },

  async findAwaitingAccountByPhone(workspaceId, phoneE164) {
    return prisma.generatedAccount.findFirst({
      where: { workspaceId, phoneNumber: phoneE164, status: 'AWAITING_OTP' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceId: true }
    });
  },

  // ── Servisler (panelin kullandıklarının aynısı) ──
  async createInstance(proxyCountry, workspaceId) {
    const r = await provisionService.createInstance({ proxyCountry }, workspaceId);
    return { jobId: r.jobId, deviceId: r.deviceId, name: r.name };
  },
  async provisionStatus(jobId, workspaceId) {
    return provisionService.getStatus(jobId, workspaceId);
  },
  async startRegister(workspaceId, deviceId, phoneE164, name) {
    const acc = (await batchService.startOperatorRegister(workspaceId, deviceId, phoneE164, name, false)) as { accountId?: string; id?: string };
    const accountId = acc.accountId ?? acc.id;
    if (!accountId) throw new Error('Kayıt başlatıldı ama hesap kimliği dönmedi');
    return { accountId };
  },
  async registerStatus(accountId, workspaceId) {
    return waRegisterService.getStatus(accountId, workspaceId);
  },
  async provideOtp(workspaceId, accountId, code) {
    await batchService.provideOperatorOtp(workspaceId, accountId, code);
  },
  async provideMethod(workspaceId, accountId, method) {
    await batchService.provideVerifyMethod(workspaceId, accountId, method);
  },
  async retryRegister(workspaceId, accountId) {
    await batchService.retryWhatsappRegister(workspaceId, accountId);
  },
  async cancelAccount(workspaceId, accountId) {
    await batchService.cancel(workspaceId, accountId);
  },
  liveShot: (accountId) => getLiveRegisterShot(accountId),

  // ── Şifreli kalıcılık ──
  async save(data) {
    const tmp = `${STATE_FILE}.tmp`;
    await writeFile(tmp, encryptString(data), { mode: 0o600 });
    await rename(tmp, STATE_FILE);
  },
  async load() {
    const raw = await readFile(STATE_FILE, 'utf8').catch(() => null);
    return raw ? decryptString(raw.trim()) : null;
  }
};

const core = createTgRegister(deps, { concurrency: Number(process.env.FLEET_TG_REG_CONCURRENCY ?? 4) });
let started = false;

export const tgRegister = {
  commands: core.commands,
  handleText: core.handleText,
  handleReply: core.handleReply,
  handleCallback: core.handleCallback,
  renderQueue: core.renderQueue,
  cancelDraft: core.cancelDraft,
  start(): void {
    if (started) return;
    started = true;
    void core.restore().then(() => {
      const t = setInterval(() => { void core.tick(); }, TICK_MS);
      t.unref?.();
      logger.info('tg-kayit yoneticisi basladi', { limit: core._inspect().limit, stateFile: STATE_FILE });
    });
  }
};

export type { InlineButton };
