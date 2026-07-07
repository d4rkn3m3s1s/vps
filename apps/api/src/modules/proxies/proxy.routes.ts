import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { heavyOperationRateLimiter } from '../../middleware/rateLimit';
import {
  autoAssignProxyHandler,
  checkProxyHandler,
  createProxyHandler,
  deleteProxyHandler,
  importProxiesHandler,
  listProxiesHandler,
  rotateProxyHandler,
  updateProxyHandler
} from './proxy.controller';

export const proxyRouter = Router();

proxyRouter.get('/', requireApiKey, optionalJwt, asyncHandler(listProxiesHandler));
proxyRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createProxyHandler));
// Bulk import can carry a large payload → per-user throttled against DoS.
proxyRouter.post('/import', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(importProxiesHandler));
proxyRouter.post('/auto-assign', requireApiKey, authenticateJwt, asyncHandler(autoAssignProxyHandler));
proxyRouter.post('/:id/check', requireApiKey, authenticateJwt, asyncHandler(checkProxyHandler));
proxyRouter.post('/:id/rotate', requireApiKey, authenticateJwt, asyncHandler(rotateProxyHandler));
proxyRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateProxyHandler));
proxyRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteProxyHandler));
