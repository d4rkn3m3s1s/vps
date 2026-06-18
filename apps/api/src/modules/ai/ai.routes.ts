import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { aiStatusHandler, generateFlowHandler } from './ai.controller';

export const aiRouter = Router();

aiRouter.use(requireApiKey, authenticateJwt);

aiRouter.get('/status', asyncHandler(aiStatusHandler));
aiRouter.post('/generate-flow', asyncHandler(generateFlowHandler));
