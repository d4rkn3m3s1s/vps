import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  actionLogHandler,
  createCampaignHandler,
  deleteCampaignHandler,
  exportHandler,
  importHandler,
  listAccountsHandler,
  listCampaignsHandler,
  resumeHandler,
  summaryHandler,
  tickHandler,
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
farmRouter.post('/accounts/:deviceId/resume', requireApiKey, authenticateJwt, asyncHandler(resumeHandler));
farmRouter.put('/accounts/:deviceId/credentials', requireApiKey, authenticateJwt, asyncHandler(updateCredentialsHandler));
farmRouter.get('/accounts/:deviceId/log', requireApiKey, authenticateJwt, asyncHandler(actionLogHandler));
farmRouter.post('/import', requireApiKey, authenticateJwt, asyncHandler(importHandler));
farmRouter.post('/tick', requireApiKey, authenticateJwt, asyncHandler(tickHandler));
