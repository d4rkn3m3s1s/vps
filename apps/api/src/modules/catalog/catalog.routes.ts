import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { installAppHandler, listAppsHandler } from './catalog.controller';

export const catalogRouter = Router();

// Applications catalog (real app install: custom apkUrl or the bundled /apks path).
catalogRouter.get('/apps', requireApiKey, asyncHandler(listAppsHandler));
catalogRouter.post('/apps/install', requireApiKey, authenticateJwt, asyncHandler(installAppHandler));
