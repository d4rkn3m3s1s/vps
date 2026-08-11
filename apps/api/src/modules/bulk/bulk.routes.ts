import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { heavyOperationRateLimiter } from '../../middleware/rateLimit';
import { bulkJobHandler, bulkProxyHandler, bulkStopHandler, bulkDeleteHandler } from './bulk.controller';

export const bulkRouter = Router();

bulkRouter.post('/jobs', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(bulkJobHandler));
bulkRouter.post('/proxy', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(bulkProxyHandler));
bulkRouter.post('/stop', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(bulkStopHandler));
bulkRouter.post('/delete', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(bulkDeleteHandler));
