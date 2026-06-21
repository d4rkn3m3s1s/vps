import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
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
  provisionBatchHandler,
  registerAccountHandler,
  cancelAccountHandler,
  deleteAccountHandler
} from './batch.controller';

export const accountsRouter = Router();

// Provider health (used by the dashboard's connectivity panel).
accountsRouter.get('/providers/status', requireApiKey, authenticateJwt, asyncHandler(providerStatusHandler));

// SMS (sms-bus)
accountsRouter.get('/sms/balance', requireApiKey, authenticateJwt, asyncHandler(smsBalanceHandler));
accountsRouter.get('/sms/countries', requireApiKey, authenticateJwt, asyncHandler(smsCountriesHandler));
accountsRouter.get('/sms/projects', requireApiKey, authenticateJwt, asyncHandler(smsProjectsHandler));
accountsRouter.post('/sms/number', requireApiKey, authenticateJwt, asyncHandler(smsGetNumberHandler));
accountsRouter.get('/sms/number/:requestId/otp', requireApiKey, authenticateJwt, asyncHandler(smsOtpHandler));
accountsRouter.post('/sms/number/:requestId/cancel', requireApiKey, authenticateJwt, asyncHandler(smsCancelHandler));

// Mail (catchmail)
accountsRouter.post('/mail/inbox', requireApiKey, authenticateJwt, asyncHandler(makeInboxHandler));
accountsRouter.get('/mail/messages', requireApiKey, authenticateJwt, asyncHandler(mailInboxHandler));
accountsRouter.get('/mail/message/:id', requireApiKey, authenticateJwt, asyncHandler(mailMessageHandler));

// Identity (randomuser)
accountsRouter.post('/identity', requireApiKey, authenticateJwt, asyncHandler(generateIdentityHandler));

// Batch account farm (GeneratedAccount lifecycle)
accountsRouter.get('/batch/accounts', requireApiKey, authenticateJwt, asyncHandler(listAccountsHandler));
accountsRouter.post('/batch', requireApiKey, authenticateJwt, asyncHandler(createBatchHandler));
accountsRouter.post('/batch/provision', requireApiKey, authenticateJwt, asyncHandler(provisionBatchHandler));
accountsRouter.get('/batch/accounts/:id', requireApiKey, authenticateJwt, asyncHandler(getAccountHandler));
accountsRouter.post('/batch/accounts/:id/provision', requireApiKey, authenticateJwt, asyncHandler(provisionAccountHandler));
accountsRouter.post('/batch/accounts/:id/register', requireApiKey, authenticateJwt, asyncHandler(registerAccountHandler));
accountsRouter.get('/batch/accounts/:id/otp', requireApiKey, authenticateJwt, asyncHandler(pollOtpHandler));
accountsRouter.post('/batch/accounts/:id/cancel', requireApiKey, authenticateJwt, asyncHandler(cancelAccountHandler));
accountsRouter.delete('/batch/accounts/:id', requireApiKey, authenticateJwt, asyncHandler(deleteAccountHandler));
