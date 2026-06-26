import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireAdmin } from '../../middleware/requireAdmin';
import {
  clearKeyHandler,
  destroyHandler,
  instancesHandler,
  offersHandler,
  provisionHandler,
  setKeyHandler,
  statusHandler,
  syncHandler
} from './vast.controller';

export const vastRouter = Router();

// Provisioning GPU hosts is an admin, workspace-scoped action.
vastRouter.use(requireApiKey, authenticateJwt, requireAdmin);

vastRouter.get('/status', asyncHandler(statusHandler));
vastRouter.put('/key', asyncHandler(setKeyHandler));
vastRouter.delete('/key', asyncHandler(clearKeyHandler));
vastRouter.get('/offers', asyncHandler(offersHandler));
vastRouter.get('/instances', asyncHandler(instancesHandler));
vastRouter.post('/provision', asyncHandler(provisionHandler));
vastRouter.post('/sync', asyncHandler(syncHandler));
vastRouter.delete('/instances/:id', asyncHandler(destroyHandler));
