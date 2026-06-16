import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  installAppHandler,
  installListingHandler,
  listAppsHandler,
  listListingsHandler,
  listTemplatesHandler,
  useTemplateHandler
} from './catalog.controller';

export const catalogRouter = Router();

// Applications catalog
catalogRouter.get('/apps', requireApiKey, asyncHandler(listAppsHandler));
catalogRouter.post('/apps/install', requireApiKey, authenticateJwt, asyncHandler(installAppHandler));

// Automation templates
catalogRouter.get('/templates', requireApiKey, asyncHandler(listTemplatesHandler));
catalogRouter.post('/templates/:id/use', requireApiKey, authenticateJwt, asyncHandler(useTemplateHandler));

// FleetHub marketplace
catalogRouter.get('/listings', requireApiKey, asyncHandler(listListingsHandler));
catalogRouter.post('/listings/:id/install', requireApiKey, authenticateJwt, asyncHandler(installListingHandler));
