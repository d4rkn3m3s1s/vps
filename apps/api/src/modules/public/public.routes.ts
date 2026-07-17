import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { apiRateLimiter } from '../../middleware/rateLimit';
import { listDevicesHandler, sendHandler, bulkSendHandler, messagesHandler, conversationsHandler, threadHandler, statsHandler, broadcastHandler, labelsHandler, createLabelHandler, setLabelsHandler, stateHandler, profileHandler, blockHandler, blocklistHandler, myNumberHandler, sendMediaHandler, deleteMessageHandler, clearChatHandler, provisionDeviceHandler, provisionStatusHandler, registerWhatsappHandler, registerWhatsappOtpHandler, registerWhatsappVerifyMethodHandler, registerWhatsappStatusHandler, jobHandler, meHandler } from './public.controller';
import { heavyOperationRateLimiter } from '../../middleware/rateLimit';

// External/public WhatsApp API. Authenticated by `x-api-key` ONLY (a workspace-
// bound flk_ key minted in /admin/api-keys) — NO JWT. The workspace is resolved
// from the key; requirePublicWorkspace (in the handlers) refuses any key that has
// no workspace so this can never leak across tenants.
export const publicRouter = Router();

publicRouter.use(requireApiKey);

publicRouter.get('/v1/me', asyncHandler(meHandler));
publicRouter.get('/v1/devices', asyncHandler(listDevicesHandler));
publicRouter.get('/v1/whatsapp/messages', asyncHandler(messagesHandler));
// WhatsApp-Web-style chat list + per-thread history for external integrations.
publicRouter.get('/v1/whatsapp/conversations', asyncHandler(conversationsHandler));
publicRouter.get('/v1/whatsapp/thread', asyncHandler(threadHandler));
publicRouter.get('/v1/whatsapp/stats', asyncHandler(statsHandler));
// Categories (labels): read + create + assign to a chat, and chat state.
publicRouter.get('/v1/whatsapp/labels', asyncHandler(labelsHandler));
publicRouter.post('/v1/whatsapp/labels', asyncHandler(createLabelHandler));
publicRouter.post('/v1/whatsapp/conversations/labels', asyncHandler(setLabelsHandler));
publicRouter.post('/v1/whatsapp/conversations/state', asyncHandler(stateHandler));
// Send drives a real device — rate-limit it to blunt abuse from a leaked key.
publicRouter.post('/v1/whatsapp/send', apiRateLimiter, asyncHandler(sendHandler));
// Bulk send (many distinct messages, one call) — heavy-limited (dispatches up to 100 device jobs).
publicRouter.post('/v1/whatsapp/send/bulk', heavyOperationRateLimiter, asyncHandler(bulkSendHandler));
// Broadcast (one-to-many throttled) — write scope, rate-limited.
publicRouter.post('/v1/whatsapp/broadcast', apiRateLimiter, asyncHandler(broadcastHandler));
// Contact profile (avatar + name), block/unblock, and blocked-list — on-device
// jobs, write scope, rate-limited (they each drive a real device).
publicRouter.post('/v1/whatsapp/profile', apiRateLimiter, asyncHandler(profileHandler));
publicRouter.post('/v1/whatsapp/block', apiRateLimiter, asyncHandler(blockHandler));
publicRouter.post('/v1/whatsapp/blocklist', apiRateLimiter, asyncHandler(blocklistHandler));
// Own number, media send, message delete, clear chat — on-device, rate-limited.
publicRouter.post('/v1/whatsapp/mynumber', apiRateLimiter, asyncHandler(myNumberHandler));
publicRouter.post('/v1/whatsapp/send-media', apiRateLimiter, asyncHandler(sendMediaHandler));
publicRouter.post('/v1/whatsapp/delete-message', apiRateLimiter, asyncHandler(deleteMessageHandler));
publicRouter.post('/v1/whatsapp/clear-chat', apiRateLimiter, asyncHandler(clearChatHandler));

// ── One-click provision + WhatsApp registration (write scope, heavily throttled
// because they spin up instances / rent-free operator numbers and drive a real
// device end-to-end). ──────────────────────────────────────────────────────
publicRouter.post('/v1/devices/provision', heavyOperationRateLimiter, asyncHandler(provisionDeviceHandler));
// Live step-by-step provision progress (same data the dashboard modal shows).
publicRouter.get('/v1/devices/provision/:jobId/status', asyncHandler(provisionStatusHandler));
publicRouter.post('/v1/whatsapp/register', heavyOperationRateLimiter, asyncHandler(registerWhatsappHandler));
publicRouter.post('/v1/whatsapp/register/:id/otp', apiRateLimiter, asyncHandler(registerWhatsappOtpHandler));
// Operator picks SMS/voice/missed-call when registration parks on the method sheet.
publicRouter.post('/v1/whatsapp/register/:id/verify-method', apiRateLimiter, asyncHandler(registerWhatsappVerifyMethodHandler));
publicRouter.get('/v1/whatsapp/register/:id/status', asyncHandler(registerWhatsappStatusHandler));

// Universal async-job poll: read the result/status of any jobId an on-device write
// endpoint returned (send, blocklist, mynumber, profile, delete-message, …).
publicRouter.get('/v1/jobs/:jobId', asyncHandler(jobHandler));
