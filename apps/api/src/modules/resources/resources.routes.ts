import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createGuideHandler,
  deleteGuideHandler,
  listGuidesHandler,
  updateGuideHandler
} from './resources.controller';

// DB-backed Resources/FAQ guides, workspace-scoped.
export const resourcesRouter = Router();

resourcesRouter.get('/guides', requireApiKey, authenticateJwt, asyncHandler(listGuidesHandler));
resourcesRouter.post('/guides', requireApiKey, authenticateJwt, asyncHandler(createGuideHandler));
resourcesRouter.put('/guides/:id', requireApiKey, authenticateJwt, asyncHandler(updateGuideHandler));
resourcesRouter.delete('/guides/:id', requireApiKey, authenticateJwt, asyncHandler(deleteGuideHandler));
