import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireHostAgent } from '../../middleware/requireHostAgent';
import { createHostHandler, deleteHostHandler, heartbeatHostHandler, listHostsHandler } from './hosts.controller';

export const hostsRouter = Router();

hostsRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(listHostsHandler)); // JWT needed for workspace scoping
hostsRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createHostHandler));
// Heartbeat is an unattended host-agent call: authenticate by the per-host agent
// key (x-agent-key) so a host can only heartbeat ITSELF — not any host by id.
hostsRouter.post('/:id/heartbeat', requireApiKey, requireHostAgent, asyncHandler(heartbeatHostHandler));
hostsRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteHostHandler));
