import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createCampaignHandler,
  deleteCampaignHandler,
  listAccountsHandler,
  listCampaignsHandler,
  tickHandler,
  updateCampaignHandler
} from './farm.controller';

export const farmRouter = Router();

farmRouter.get('/campaigns', requireApiKey, authenticateJwt, asyncHandler(listCampaignsHandler));
farmRouter.post('/campaigns', requireApiKey, authenticateJwt, asyncHandler(createCampaignHandler));
farmRouter.put('/campaigns/:id', requireApiKey, authenticateJwt, asyncHandler(updateCampaignHandler));
farmRouter.delete('/campaigns/:id', requireApiKey, authenticateJwt, asyncHandler(deleteCampaignHandler));
farmRouter.get('/accounts', requireApiKey, authenticateJwt, asyncHandler(listAccountsHandler));
farmRouter.post('/tick', requireApiKey, authenticateJwt, asyncHandler(tickHandler));
