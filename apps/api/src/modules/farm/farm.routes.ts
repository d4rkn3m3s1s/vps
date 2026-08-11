import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  actionLogHandler,
  bulkHandler,
  createCampaignHandler,
  deleteCampaignHandler,
  exportHandler,
  healthTrendHandler,
  importHandler,
  listAccountsHandler,
  listCampaignsHandler,
  resumeHandler,
  riskHandler,
  summaryHandler,
  tickHandler,
  totpHandler,
  updateCampaignHandler,
  updateCredentialsHandler
} from './farm.controller';

export const farmRouter = Router();

farmRouter.get('/campaigns', requireApiKey, authenticateJwt, asyncHandler(listCampaignsHandler));
farmRouter.post('/campaigns', requireApiKey, authenticateJwt, asyncHandler(createCampaignHandler));
farmRouter.put('/campaigns/:id', requireApiKey, authenticateJwt, asyncHandler(updateCampaignHandler));
farmRouter.delete('/campaigns/:id', requireApiKey, authenticateJwt, asyncHandler(deleteCampaignHandler));
farmRouter.get('/accounts', requireApiKey, authenticateJwt, asyncHandler(listAccountsHandler));
farmRouter.get('/accounts/export', requireApiKey, authenticateJwt, asyncHandler(exportHandler));
farmRouter.get('/summary', requireApiKey, authenticateJwt, asyncHandler(summaryHandler));
farmRouter.get('/risk', requireApiKey, authenticateJwt, asyncHandler(riskHandler));
farmRouter.post('/accounts/:deviceId/resume', requireApiKey, authenticateJwt, asyncHandler(resumeHandler));
farmRouter.put('/accounts/:deviceId/credentials', requireApiKey, authenticateJwt, asyncHandler(updateCredentialsHandler));
farmRouter.get('/accounts/:deviceId/log', requireApiKey, authenticateJwt, asyncHandler(actionLogHandler));
farmRouter.get('/accounts/:deviceId/totp', requireApiKey, authenticateJwt, asyncHandler(totpHandler));
farmRouter.get('/accounts/:deviceId/health-trend', requireApiKey, authenticateJwt, asyncHandler(healthTrendHandler));
farmRouter.post('/accounts/bulk', requireApiKey, authenticateJwt, asyncHandler(bulkHandler));
farmRouter.post('/import', requireApiKey, authenticateJwt, asyncHandler(importHandler));
// ★2026-08-12: `requireAdmin` EKLENDİ. Bu uç motoru elle tetikliyor ve `farmService.tick()`
// PLATFORM GENELİNDE çalışıyor (workspace filtresi YOK — sistem ticker'ı için doğru,
// çünkü tüm kiracıların kampanyalarını sürmesi gerekir). Ama HTTP ucu yalnızca
// `authenticateJwt` ile korunuyordu: herhangi bir kiracının EN DÜŞÜK yetkili üyesi
// bütün kiracıların kampanyalarını tetikleyip iş kaydı ürettirebiliyordu.
// Handler'ın kendi yorumu zaten "admin run now" diyordu — kod bunu ZORLAMIYORDU.
// Motoru workspace'e kısıtlamak yerine ucu admin'e kısıtladık: ticker davranışı aynen korunur.
farmRouter.post('/tick', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(tickHandler));
