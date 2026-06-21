import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { getPluginHandler, listPluginsHandler } from './plugins.controller';

export const pluginsRouter = Router();

pluginsRouter.get('/', requireApiKey, asyncHandler(listPluginsHandler));
pluginsRouter.get('/:id', requireApiKey, asyncHandler(getPluginHandler));
