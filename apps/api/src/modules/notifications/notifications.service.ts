import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, decryptString } from '../../lib/crypto';

export type ChannelType = 'telegram' | 'slack' | 'discord';

const CHANNEL_TYPES: ChannelType[] = ['telegram', 'slack', 'discord'];

type TelegramConfig = { botToken: string; chatId: string };
type SlackConfig = { webhookUrl: string };
type DiscordConfig = { webhookUrl: string };
type ChannelConfig = TelegramConfig | SlackConfig | DiscordConfig;

export type DispatchMessage = { title: string; detail: string };

export type ChannelSummary = {
  id: string;
  type: ChannelType;
  active: boolean;
  configured: true;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function isChannelType(value: string): value is ChannelType {
  return (CHANNEL_TYPES as string[]).includes(value);
}

function validateConfig(type: ChannelType, config: unknown): ChannelConfig {
  if (!config || typeof config !== 'object') {
    throw new AppError('Geçersiz yapılandırma', 400, 'INVALID_CONFIG');
  }
  const c = config as Record<string, unknown>;
  if (type === 'telegram') {
    const botToken = typeof c.botToken === 'string' ? c.botToken.trim() : '';
    const chatId = typeof c.chatId === 'string' ? c.chatId.trim() : '';
    if (!botToken || !chatId) {
      throw new AppError('Telegram için botToken ve chatId gereklidir', 400, 'INVALID_CONFIG');
    }
    return { botToken, chatId };
  }
  // slack | discord — both need a webhookUrl
  const webhookUrl = typeof c.webhookUrl === 'string' ? c.webhookUrl.trim() : '';
  if (!webhookUrl) {
    throw new AppError('Geçerli bir webhook URL gereklidir', 400, 'INVALID_CONFIG');
  }
  return { webhookUrl };
}

export async function getChannels(workspaceId: string): Promise<ChannelSummary[]> {
  const rows = await prisma.notificationChannel.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { type: 'asc' }
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type as ChannelType,
    active: row.active,
    configured: true as const,
    lastTestedAt: row.lastTestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export async function saveChannel(
  workspaceId: string,
  type: string,
  config: unknown
): Promise<ChannelSummary> {
  if (!isChannelType(type)) {
    throw new AppError('Desteklenmeyen kanal türü', 400, 'INVALID_CHANNEL_TYPE');
  }
  const validated = validateConfig(type, config);
  const configEnc = encryptString(JSON.stringify(validated));
  const row = await prisma.notificationChannel.upsert({
    where: { workspaceId_type: { workspaceId, type } },
    create: { workspaceId, type, configEnc, active: true },
    update: { configEnc, active: true }
  });
  return {
    id: row.id,
    type: row.type as ChannelType,
    active: row.active,
    configured: true as const,
    lastTestedAt: row.lastTestedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function deleteChannel(workspaceId: string, id: string): Promise<void> {
  const row = await prisma.notificationChannel.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}) }
  });
  if (!row) throw new AppError('Kanal bulunamadı', 404, 'CHANNEL_NOT_FOUND');
  await prisma.notificationChannel.delete({ where: { id: row.id } });
}

// Best-effort POST to a single channel. Never throws; returns ok/error.
async function postToChannel(
  type: ChannelType,
  config: ChannelConfig,
  message: DispatchMessage
): Promise<{ ok: boolean; error?: string }> {
  const text = `${message.title}\n${message.detail}`.trim();
  try {
    let url: string;
    let body: Record<string, unknown>;
    if (type === 'telegram') {
      const cfg = config as TelegramConfig;
      url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
      body = { chat_id: cfg.chatId, text };
    } else if (type === 'slack') {
      url = (config as SlackConfig).webhookUrl;
      body = { text };
    } else {
      url = (config as DiscordConfig).webhookUrl;
      body = { content: text };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

// Broadcast a message to every ACTIVE channel of a workspace. Best-effort:
// per-channel failures are swallowed so alert firing is never blocked.
export async function dispatch(workspaceId: string, message: DispatchMessage): Promise<void> {
  const rows = await prisma.notificationChannel.findMany({
    where: { active: true, ...(workspaceId ? { workspaceId } : {}) }
  });
  await Promise.all(
    rows.map(async (row) => {
      try {
        const config = JSON.parse(decryptString(row.configEnc)) as ChannelConfig;
        await postToChannel(row.type as ChannelType, config, message);
      } catch {
        // swallow — best effort
      }
    })
  );
}

export async function sendTest(
  workspaceId: string,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.notificationChannel.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}) }
  });
  if (!row) throw new AppError('Kanal bulunamadı', 404, 'CHANNEL_NOT_FOUND');

  let result: { ok: boolean; error?: string };
  try {
    const config = JSON.parse(decryptString(row.configEnc)) as ChannelConfig;
    result = await postToChannel(row.type as ChannelType, config, {
      title: 'Test bildirimi',
      detail: 'Fleet bildirim kanalı testi başarılı. Bu mesajı görüyorsanız kanal çalışıyor.'
    });
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }

  await prisma.notificationChannel.update({
    where: { id: row.id },
    data: { lastTestedAt: new Date() }
  });

  return result;
}

export const notificationsService = {
  getChannels,
  saveChannel,
  deleteChannel,
  dispatch,
  sendTest
};
