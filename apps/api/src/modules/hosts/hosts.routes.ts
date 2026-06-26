import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createHostHandler, deleteHostHandler, heartbeatHostHandler, listHostsHandler } from './hosts.controller';

export const hostsRouter = Router();

hostsRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(listHostsHandler)); // JWT needed for workspace scoping
hostsRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createHostHandler));
hostsRouter.post('/:id/heartbeat', requireApiKey, asyncHandler(heartbeatHostHandler));
hostsRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteHostHandler));
