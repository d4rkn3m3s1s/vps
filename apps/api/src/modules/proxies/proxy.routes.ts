import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
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
proxyRouter.post('/import', requireApiKey, authenticateJwt, asyncHandler(importProxiesHandler));
proxyRouter.post('/auto-assign', requireApiKey, authenticateJwt, asyncHandler(autoAssignProxyHandler));
proxyRouter.post('/:id/check', requireApiKey, authenticateJwt, asyncHandler(checkProxyHandler));
proxyRouter.post('/:id/rotate', requireApiKey, authenticateJwt, asyncHandler(rotateProxyHandler));
proxyRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateProxyHandler));
proxyRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteProxyHandler));
