import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireHostAgent } from '../../middleware/requireHostAgent';
import { agentHeartbeatHandler, agentProgressHandler, claimNextJobHandler, completeJobHandler, updateDeviceMetricsHandler, visionAnalyzeHandler, whatsappInboundHandler, whatsappReceiptHandler } from './agent.controller';
import { verifyAgentSignature } from './agent.signature';

// Endpoints consumed by the KVM host agent. They require BOTH the platform API
// key (x-api-key) and the per-host agent key (x-agent-key). Each request is also
// HMAC-signed (verifyAgentSignature) for payload integrity + replay protection;
// requireHostAgent must run first so the plaintext agent key (the HMAC key) is
// resolved before verification.
export const agentRouter = Router();

agentRouter.use(requireApiKey, requireHostAgent, verifyAgentSignature);

agentRouter.get('/jobs/next', asyncHandler(claimNextJobHandler));
agentRouter.post('/jobs/:id/complete', asyncHandler(completeJobHandler));
agentRouter.post('/jobs/:id/progress', asyncHandler(agentProgressHandler));
agentRouter.post('/heartbeat', asyncHandler(agentHeartbeatHandler));
agentRouter.post('/device-metrics', asyncHandler(updateDeviceMetricsHandler));
agentRouter.post('/whatsapp/inbound', asyncHandler(whatsappInboundHandler));
// Outbound delivery receipt (✓✓ delivered / blue-tick read). Agent-side tick read
// is a TODO; the endpoint exists so the webhook/enum half is deployable now.
agentRouter.post('/whatsapp/receipt', asyncHandler(whatsappReceiptHandler));
agentRouter.post('/vision/analyze', asyncHandler(visionAnalyzeHandler));
