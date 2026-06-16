import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireHostAgent } from '../../middleware/requireHostAgent';
import { agentHeartbeatHandler, claimNextJobHandler, completeJobHandler } from './agent.controller';

// Endpoints consumed by the KVM host agent. They require BOTH the platform API
// key (x-api-key) and the per-host agent key (x-agent-key).
export const agentRouter = Router();

agentRouter.use(requireApiKey, requireHostAgent);

agentRouter.get('/jobs/next', asyncHandler(claimNextJobHandler));
agentRouter.post('/jobs/:id/complete', asyncHandler(completeJobHandler));
agentRouter.post('/heartbeat', asyncHandler(agentHeartbeatHandler));
