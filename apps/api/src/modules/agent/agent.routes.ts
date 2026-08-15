import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { requireHostAgent } from '../../middleware/requireHostAgent';
import { agentHeartbeatHandler, agentProgressHandler, claimNextJobHandler, claimJobsBatchHandler, abandonClaimedHandler, completeJobHandler, healthAlertHandler, updateDeviceMetricsHandler, visionAnalyzeHandler, whatsappInboundHandler, whatsappHealthProbeHandler, mediaCapturedHandler, mediaReceivedHandler, whatsappReceiptHandler } from './agent.controller';
import { verifyAgentSignature } from './agent.signature';

// Endpoints consumed by the KVM host agent. They require BOTH the platform API
// key (x-api-key) and the per-host agent key (x-agent-key). Each request is also
// HMAC-signed (verifyAgentSignature) for payload integrity + replay protection;
// requireHostAgent must run first so the plaintext agent key (the HMAC key) is
// resolved before verification.
export const agentRouter = Router();

agentRouter.use(requireApiKey, requireHostAgent, verifyAgentSignature);

agentRouter.get('/jobs/next', asyncHandler(claimNextJobHandler));
// Batch variant: up to ?max jobs in one round-trip (poll-Hz bottleneck fix). An
// older agent that only knows /jobs/next keeps working unchanged.
agentRouter.get('/jobs/next-batch', asyncHandler(claimJobsBatchHandler));
// Agent startup orphan-recovery: release the RUNNING jobs this host had claimed before
// it restarted (retryable → PENDING, stateful → FAILED). Frees devices immediately.
agentRouter.post('/jobs/abandon-claimed', asyncHandler(abandonClaimedHandler));
agentRouter.post('/jobs/:id/complete', asyncHandler(completeJobHandler));
agentRouter.post('/jobs/:id/progress', asyncHandler(agentProgressHandler));
agentRouter.post('/heartbeat', asyncHandler(agentHeartbeatHandler));
agentRouter.post('/device-metrics', asyncHandler(updateDeviceMetricsHandler));
agentRouter.post('/whatsapp/inbound', asyncHandler(whatsappInboundHandler));
// ★2026-08-05 Otonom WA saglik taramasi sonucu (ban/kisit/cikis) — agent periyodik gonderir.
agentRouter.post('/whatsapp/health-probe', asyncHandler(whatsappHealthProbeHandler));
// Agent media-capture poll → new-media metadata (opt-in FLEET_WA_CAPTURE=1).
agentRouter.post('/whatsapp/media-captured', asyncHandler(mediaCapturedHandler));
// ★2026-08-15: agent gercek medya DOSYASINI yollar (base64) → sakla + TG/panel/webhook.
agentRouter.post('/whatsapp/media', asyncHandler(mediaReceivedHandler));
// Outbound delivery receipt (✓✓ delivered / blue-tick read). Agent-side tick read
// is a TODO; the endpoint exists so the webhook/enum half is deployable now.
agentRouter.post('/whatsapp/receipt', asyncHandler(whatsappReceiptHandler));
agentRouter.post('/vision/analyze', asyncHandler(visionAnalyzeHandler));
agentRouter.post('/health-alert', asyncHandler(healthAlertHandler));
