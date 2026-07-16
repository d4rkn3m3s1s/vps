import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { heavyOperationRateLimiter } from '../../middleware/rateLimit';
import {
  providerStatusHandler,
  smsBalanceHandler,
  smsCountriesHandler,
  smsProjectsHandler,
  smsGetNumberHandler,
  smsOtpHandler,
  smsCancelHandler,
  makeInboxHandler,
  mailInboxHandler,
  mailMessageHandler,
  generateIdentityHandler
} from './accounts.controller';
import {
  createBatchHandler,
  listAccountsHandler,
  getAccountHandler,
  provisionAccountHandler,
  pollOtpHandler,
  registrationShotsHandler,
  provisionBatchHandler,
  registerAccountHandler,
  sendWhatsAppHandler,
  sendWhatsAppFromDeviceHandler,
  readWhatsAppHandler,
  listWhatsAppMessagesHandler,
  fetchWhatsAppProfileHandler,
  blockWhatsAppContactHandler,
  listWhatsAppBlockedHandler,
  whatsAppMyNumberHandler,
  sendWhatsAppMediaHandler,
  deleteWhatsAppMessageHandler,
  clearWhatsAppChatHandler,
  cancelAccountHandler,
  deleteAccountHandler,
  autoRegisterWhatsAppHandler,
  startRegisterHandler,
  provideOtpHandler,
  waRegisterStatusHandler,
  startInstagramRegisterHandler,
  igRegisterStatusHandler
} from './batch.controller';

export const accountsRouter = Router();

// Provider health (used by the dashboard's connectivity panel).
accountsRouter.get('/providers/status', requireApiKey, authenticateJwt, asyncHandler(providerStatusHandler));

// SMS (sms-bus)
accountsRouter.get('/sms/balance', requireApiKey, authenticateJwt, asyncHandler(smsBalanceHandler));
accountsRouter.get('/sms/countries', requireApiKey, authenticateJwt, asyncHandler(smsCountriesHandler));
accountsRouter.get('/sms/projects', requireApiKey, authenticateJwt, asyncHandler(smsProjectsHandler));
// Rate-limited: each call rents a PAID number from the shared sms-bus balance, so an
// unbounded loop could drain the platform's SMS credit for all tenants (cost/DoS).
accountsRouter.post('/sms/number', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(smsGetNumberHandler));
accountsRouter.get('/sms/number/:requestId/otp', requireApiKey, authenticateJwt, asyncHandler(smsOtpHandler));
accountsRouter.post('/sms/number/:requestId/cancel', requireApiKey, authenticateJwt, asyncHandler(smsCancelHandler));

// Mail (catchmail)
accountsRouter.post('/mail/inbox', requireApiKey, authenticateJwt, asyncHandler(makeInboxHandler));
accountsRouter.get('/mail/messages', requireApiKey, authenticateJwt, asyncHandler(mailInboxHandler));
accountsRouter.get('/mail/message/:id', requireApiKey, authenticateJwt, asyncHandler(mailMessageHandler));

// Identity (randomuser)
accountsRouter.post('/identity', requireApiKey, authenticateJwt, asyncHandler(generateIdentityHandler));

// Fully automatic WhatsApp registration (rent number → register → OTP → finish).
// Rents a paid number + drives a device — throttled to prevent bill-runner abuse.
accountsRouter.post('/whatsapp/auto-register', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(autoRegisterWhatsAppHandler));

// Operator-OTP one-click registration (operator's own number; enter OTP by hand).
accountsRouter.post('/whatsapp/register', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(startRegisterHandler));
accountsRouter.post('/whatsapp/register/:id/otp', requireApiKey, authenticateJwt, asyncHandler(provideOtpHandler));
// Live registration progress (log + last step) for the dashboard modal to restore.
accountsRouter.get('/whatsapp/register/:id/status', requireApiKey, authenticateJwt, asyncHandler(waRegisterStatusHandler));

// One-click Instagram registration (email-based, fully autonomous — agent reads
// the confirmation code from email; no operator-OTP step). Throttled like WA.
accountsRouter.post('/instagram/register', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(startInstagramRegisterHandler));
accountsRouter.get('/instagram/register/:id/status', requireApiKey, authenticateJwt, asyncHandler(igRegisterStatusHandler));

// Stored WhatsApp messages (inbound captured by the agent + outbound we sent),
// device-scoped. ?deviceId=&limit=&direction=IN|OUT
accountsRouter.get('/whatsapp/messages', requireApiKey, authenticateJwt, asyncHandler(listWhatsAppMessagesHandler));

// Each of these dispatches an on-device WhatsApp RPA job (the agent runs them
// serially on the phone). heavyOperationRateLimiter (per-user/API-key) caps how
// fast a caller can queue them, so a runaway loop can't flood the PENDING queue.
// Send a WhatsApp message directly from a device (WhatsApp page).
accountsRouter.post('/whatsapp/send', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(sendWhatsAppFromDeviceHandler));

// Fetch a contact's WhatsApp profile (avatar + name/about), device-scoped.
accountsRouter.post('/whatsapp/profile', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(fetchWhatsAppProfileHandler));

// Block / unblock a WhatsApp contact, device-scoped. { block?: boolean }
accountsRouter.post('/whatsapp/block', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(blockWhatsAppContactHandler));

// Read the blocked-contacts list off a device, device-scoped.
accountsRouter.post('/whatsapp/blocklist', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(listWhatsAppBlockedHandler));

// Own number, media send, message delete, and clear chat — device-scoped.
accountsRouter.post('/whatsapp/mynumber', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(whatsAppMyNumberHandler));
accountsRouter.post('/whatsapp/send-media', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(sendWhatsAppMediaHandler));
accountsRouter.post('/whatsapp/delete-message', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(deleteWhatsAppMessageHandler));
accountsRouter.post('/whatsapp/clear-chat', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(clearWhatsAppChatHandler));

// Batch account farm (GeneratedAccount lifecycle)
accountsRouter.get('/batch/accounts', requireApiKey, authenticateJwt, asyncHandler(listAccountsHandler));
// Bulk account generation + provisioning — expensive, so per-user throttled.
accountsRouter.post('/batch', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(createBatchHandler));
accountsRouter.post('/batch/provision', requireApiKey, authenticateJwt, heavyOperationRateLimiter, asyncHandler(provisionBatchHandler));
accountsRouter.get('/batch/accounts/:id', requireApiKey, authenticateJwt, asyncHandler(getAccountHandler));
accountsRouter.post('/batch/accounts/:id/provision', requireApiKey, authenticateJwt, asyncHandler(provisionAccountHandler));
accountsRouter.post('/batch/accounts/:id/register', requireApiKey, authenticateJwt, asyncHandler(registerAccountHandler));
accountsRouter.post('/batch/accounts/:id/whatsapp/send', requireApiKey, authenticateJwt, asyncHandler(sendWhatsAppHandler));
accountsRouter.post('/batch/accounts/:id/whatsapp/read', requireApiKey, authenticateJwt, asyncHandler(readWhatsAppHandler));
accountsRouter.get('/batch/accounts/:id/otp', requireApiKey, authenticateJwt, asyncHandler(pollOtpHandler));
accountsRouter.get('/batch/accounts/:id/shots', requireApiKey, authenticateJwt, asyncHandler(registrationShotsHandler));
accountsRouter.post('/batch/accounts/:id/cancel', requireApiKey, authenticateJwt, asyncHandler(cancelAccountHandler));
accountsRouter.delete('/batch/accounts/:id', requireApiKey, authenticateJwt, asyncHandler(deleteAccountHandler));
