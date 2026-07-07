import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { bulkJobHandler, bulkProxyHandler, bulkStopHandler, bulkDeleteHandler } from './bulk.controller';

export const bulkRouter = Router();

bulkRouter.post('/jobs', requireApiKey, authenticateJwt, asyncHandler(bulkJobHandler));
bulkRouter.post('/proxy', requireApiKey, authenticateJwt, asyncHandler(bulkProxyHandler));
bulkRouter.post('/stop', requireApiKey, authenticateJwt, asyncHandler(bulkStopHandler));
bulkRouter.post('/delete', requireApiKey, authenticateJwt, asyncHandler(bulkDeleteHandler));
