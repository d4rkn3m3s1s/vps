import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createJobHandler, getJobHandler, getJobsHandler } from './jobs.controller';

export const jobsRouter = Router();

// ★2026-08-12: Aşağıda bir `jobsRouter.use(authenticateJwt)` satırı vardı — ROTALARDAN
// SONRA tanımlıydı, yani ÖLÜ KOD. Express middleware'i sırayla uygular; istek yukarıdaki
// bir rotayla eşleşip yanıtlandığı için o `use()` hiç çalışmıyordu. Zararsızdı ama
// yanıltıcıydı: dosyaya bakan biri "/jobs yüzeyi JWT'ye bağlı" sanıyordu.
// ÖNE TAŞINMADI, SİLİNDİ — GET'ler bilerek `optionalJwt` kullanıyor (servis kimliği
// JWT'siz okuyabilsin diye); öne taşımak o akışı kırardı. Yazma yolu (POST) zaten
// kendi satırında `authenticateJwt` taşıyor.
jobsRouter.get('/', requireApiKey, optionalJwt, asyncHandler(getJobsHandler));
jobsRouter.get('/:id', requireApiKey, optionalJwt, asyncHandler(getJobHandler));
jobsRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createJobHandler));
