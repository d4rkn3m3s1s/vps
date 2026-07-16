// MOUNT: app.use('/device-agent', deviceAgentRouter) in routes/index.ts
// NOTE: path is /device-agent (NOT /agent — that's the host-agent endpoints).
import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { heavyOperationRateLimiter } from '../../middleware/rateLimit';
import {
  cancelRunHandler,
  convertToRpaHandler,
  exploreHandler,
  getMapHandler,
  getRunHandler,
  listRunsHandler,
  saveMapHandler,
  startRunHandler,
  statusHandler
} from './device-agent.controller';

export const deviceAgentRouter = Router();

deviceAgentRouter.use(requireApiKey, authenticateJwt);

deviceAgentRouter.get('/status', asyncHandler(statusHandler));
// /run drives an up-to-30-turn Anthropic tool-loop and /explore dispatches crawl
// jobs — both paid + heavy, so they get the per-user heavy limiter (not just the
// shared per-IP bucket the dashboard funnels every tenant through).
deviceAgentRouter.post('/run', heavyOperationRateLimiter, asyncHandler(startRunHandler));
deviceAgentRouter.get('/runs', asyncHandler(listRunsHandler));
deviceAgentRouter.get('/runs/:id', asyncHandler(getRunHandler));
deviceAgentRouter.post('/runs/:id/cancel', asyncHandler(cancelRunHandler));
deviceAgentRouter.post('/runs/:id/to-rpa', asyncHandler(convertToRpaHandler));
deviceAgentRouter.post('/explore', heavyOperationRateLimiter, asyncHandler(exploreHandler));
deviceAgentRouter.post('/map', asyncHandler(saveMapHandler));
deviceAgentRouter.get('/map/:deviceId', asyncHandler(getMapHandler));
