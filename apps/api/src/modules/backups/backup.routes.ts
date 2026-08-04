import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  backupStatusHandler,
  createDownloadLinkHandler,
  deleteBackupHandler,
  downloadBackupHandler,
  listBackupsHandler,
  startBackupHandler,
} from './backup.controller';

export const backupsRouter = Router();

// Yedek TÜM kiracıların verisini ve şifrelenmiş sırları içerir → yalnızca admin.
// (Diğer modüllerin aksine workspace'e göre daraltılamaz; kapsam platformun tamamı.)
backupsRouter.get('/', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(listBackupsHandler));
backupsRouter.get('/status', requireApiKey, authenticateJwt, requireAdmin, backupStatusHandler);
backupsRouter.post('/run', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(startBackupHandler));

// Kimlik jetondan gelir: tarayıcı bu adresi düz bir bağlantı olarak açar ve
// Authorization başlığı gönderemez. Jeton kısa ömürlü + HMAC imzalı.
//
// ⚠️ Bu uç AYRICA `/api-download/backup` altında da yayınlanır (aşağıdaki
// `backupDownloadRouter`). Sebep: ters vekil (Caddy) yalnızca belirli ön ekleri
// API'ye iletir; `/backups/*` PANELE gider (orada aynı adlı sayfa var) ve
// tarayıcı indirme bağlantısını açtığında 404 alırdı — canlıda görüldü.
backupsRouter.get('/download', asyncHandler(downloadBackupHandler));

backupsRouter.post('/:file/link', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(createDownloadLinkHandler));
backupsRouter.delete('/:file', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(deleteBackupHandler));

/**
 * Tarayıcının indirme için gittiği GERÇEK yol.
 *
 * Ayrı bir ön ek olmasının sebebi tamamen yönlendirme: ters vekil `/backups/*`'ı
 * panele iletiyor (panelde aynı adlı sayfa var), dolayısıyla indirme oraya
 * düşüp 404 veriyordu. `/api-download/*` yalnızca API'ye gider ve panelde
 * karşılığı yoktur, bu yüzden çakışma imkânsızdır.
 *
 * Güvenlik aynı: kimlik HMAC imzalı, 10 dakikalık jetondan gelir.
 */
export const backupDownloadRouter = Router();
backupDownloadRouter.get('/backup', asyncHandler(downloadBackupHandler));
