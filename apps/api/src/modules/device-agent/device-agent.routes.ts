// MOUNT: app.use('/device-agent', deviceAgentRouter) in routes/index.ts
// NOTE: path is /device-agent (NOT /agent — that's the host-agent endpoints).
import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
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
deviceAgentRouter.post('/run', asyncHandler(startRunHandler));
deviceAgentRouter.get('/runs', asyncHandler(listRunsHandler));
deviceAgentRouter.get('/runs/:id', asyncHandler(getRunHandler));
deviceAgentRouter.post('/runs/:id/cancel', asyncHandler(cancelRunHandler));
deviceAgentRouter.post('/runs/:id/to-rpa', asyncHandler(convertToRpaHandler));
deviceAgentRouter.post('/explore', asyncHandler(exploreHandler));
deviceAgentRouter.post('/map', asyncHandler(saveMapHandler));
deviceAgentRouter.get('/map/:deviceId', asyncHandler(getMapHandler));
