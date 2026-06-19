import { Router, raw } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  cancelSubscriptionHandler,
  createCheckoutHandler,
  createPortalHandler,
  getBillingHandler,
  resumeSubscriptionHandler,
  stripeWebhookHandler
} from './billing.controller';

export const billingRouter = Router();

// Webhook: must receive the RAW body for Stripe signature verification, so it
// gets its own raw parser and is NOT behind the API key / JWT (Stripe calls it).
billingRouter.post('/webhook', raw({ type: 'application/json' }), asyncHandler(stripeWebhookHandler));

// Everything else is interactive and workspace-scoped.
billingRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(getBillingHandler));
billingRouter.post('/checkout', requireApiKey, authenticateJwt, asyncHandler(createCheckoutHandler));
billingRouter.post('/portal', requireApiKey, authenticateJwt, asyncHandler(createPortalHandler));
billingRouter.post('/cancel', requireApiKey, authenticateJwt, asyncHandler(cancelSubscriptionHandler));
billingRouter.post('/resume', requireApiKey, authenticateJwt, asyncHandler(resumeSubscriptionHandler));
