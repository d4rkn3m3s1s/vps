import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { heavyOperationRateLimiter } from '../../middleware/rateLimit';
import { aiStatusHandler, generateFlowHandler, insightsHandler, queryHandler } from './ai.controller';

export const aiRouter = Router();

aiRouter.use(requireApiKey, authenticateJwt);

aiRouter.get('/status', asyncHandler(aiStatusHandler));
// These each make paid Anthropic (Opus) calls. Gate them with the per-user heavy
// limiter — otherwise a single tenant, behind the dashboard's one shared egress IP,
// could drive ~120 paid model calls/min against the shared per-IP bucket (bill-runner).
aiRouter.post('/generate-flow', heavyOperationRateLimiter, asyncHandler(generateFlowHandler));
aiRouter.post('/insights', heavyOperationRateLimiter, asyncHandler(insightsHandler));
aiRouter.post('/query', heavyOperationRateLimiter, asyncHandler(queryHandler));
