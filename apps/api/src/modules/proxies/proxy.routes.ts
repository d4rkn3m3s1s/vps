import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  checkProxyHandler,
  createProxyHandler,
  deleteProxyHandler,
  listProxiesHandler,
  rotateProxyHandler,
  updateProxyHandler
} from './proxy.controller';

export const proxyRouter = Router();

proxyRouter.get('/', requireApiKey, asyncHandler(listProxiesHandler));
proxyRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createProxyHandler));
proxyRouter.post('/:id/check', requireApiKey, authenticateJwt, asyncHandler(checkProxyHandler));
proxyRouter.post('/:id/rotate', requireApiKey, authenticateJwt, asyncHandler(rotateProxyHandler));
proxyRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateProxyHandler));
proxyRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteProxyHandler));
