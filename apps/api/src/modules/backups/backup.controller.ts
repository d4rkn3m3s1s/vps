import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import {
  DOWNLOAD_PATH,
  createDownloadToken,
  deleteBackup,
  getBackupStatus,
  getDiskInfo,
  listBackups,
  resolveBackupFile,
  startBackup,
  verifyDownloadToken,
} from './backup.service';

const fileSchema = z.object({ file: z.string().min(1).max(200) });

export async function listBackupsHandler(_req: Request, res: Response): Promise<void> {
  const [files, disk] = await Promise.all([listBackups(), getDiskInfo()]);
  res.json({ data: { files, disk, status: getBackupStatus() } });
}

export function backupStatusHandler(_req: Request, res: Response): void {
  res.json({ data: getBackupStatus() });
}

export async function startBackupHandler(req: Request, res: Response): Promise<void> {
  try {
    await startBackup();
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    throw new AppError(e.message, e.statusCode ?? 500, 'BACKUP_START_FAILED');
  }
  await writeAuditLog({
    ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    action: 'backup.start',
    resourceType: 'backup',
    ...(req.requestId ? { requestId: req.requestId } : {}),
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') as string } : {}),
  });
  res.status(202).json({ data: getBackupStatus() });
}

/**
 * Kısa ömürlü, imzalı bir indirme bağlantısı üretir.
 *
 * Neden iki adım: 859 MB'lık dosya panelin Next.js katmanından geçirilseydi
 * bellek ve zaman aşımı riski olurdu. Tarayıcı bunun yerine dosyayı doğrudan
 * API'den çeker; jeton hem dosya adını hem son kullanma anını imzalar.
 */
export async function createDownloadLinkHandler(req: Request, res: Response): Promise<void> {
  const { file } = fileSchema.parse(req.params);
  const found = await resolveBackupFile(file);
  if (!found) throw new AppError('Yedek dosyası bulunamadı', 404, 'BACKUP_NOT_FOUND');

  const token = createDownloadToken(file);
  await writeAuditLog({
    ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    action: 'backup.download',
    resourceType: 'backup',
    resourceId: file,
    ...(req.requestId ? { requestId: req.requestId } : {}),
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') as string } : {}),
    metadata: { sizeBytes: found.size },
  });
  res.json({ data: { url: `${DOWNLOAD_PATH}?token=${token}`, expiresInSec: 600, sizeBytes: found.size } });
}

/**
 * Asıl indirme. Kimlik JETONDAN gelir (JWT değil) — tarayıcı bu adrese
 * `Authorization` başlığı gönderemez, çünkü basit bir `window.location` ile açılır.
 *
 * Dosya belleğe ALINMAZ: `createReadStream` ile akıtılır ve `Range` desteklenir,
 * böylece kopan indirme baştan başlamaz.
 */
export async function downloadBackupHandler(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const fileName = token ? verifyDownloadToken(token) : null;
  if (!fileName) throw new AppError('İndirme bağlantısı geçersiz veya süresi dolmuş', 403, 'BACKUP_TOKEN_INVALID');

  const found = await resolveBackupFile(fileName);
  if (!found) throw new AppError('Yedek dosyası bulunamadı', 404, 'BACKUP_NOT_FOUND');

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Accept-Ranges', 'bytes');
  // Ara vekiller yedeği ÖNBELLEĞE ALMAMALI (hem büyük hem sırlar içerir).
  res.setHeader('Cache-Control', 'no-store, private');

  const range = req.headers.range;
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : found.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= found.size) {
      res.status(416).setHeader('Content-Range', `bytes */${found.size}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${found.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(found.fullPath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(found.size));
  createReadStream(found.fullPath).pipe(res);
}

export async function deleteBackupHandler(req: Request, res: Response): Promise<void> {
  const { file } = fileSchema.parse(req.params);
  const ok = await deleteBackup(file);
  if (!ok) throw new AppError('Yedek dosyası bulunamadı', 404, 'BACKUP_NOT_FOUND');
  await writeAuditLog({
    ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    action: 'backup.delete',
    resourceType: 'backup',
    resourceId: file,
    ...(req.requestId ? { requestId: req.requestId } : {}),
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') as string } : {}),
  });
  res.json({ data: { deleted: file } });
}
