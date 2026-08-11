import { Router, raw } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
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
// Okuma herkese açık kalıyor — plan/kota görmek rutin bir ihtiyaç.
billingRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(getBillingHandler));

// ★2026-08-12: PARA HAREKETİ olan uçlara `requireAdmin` EKLENDİ. Önceden yalnızca
// `authenticateJwt` vardı ve controller da rol bakmıyordu (`requireWorkspaceId` sadece
// "aktif workspace var mı" der) — yani workspace'in EN DÜŞÜK yetkili üyesi bile aboneliği
// iptal edebiliyor, ödeme portalını açabiliyordu. Panel bu uçları admin servis kimliğiyle
// çağırdığı için mevcut akış etkilenmez; korunan şey ileride eklenecek düşük yetkili üyeler.
billingRouter.post('/checkout', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(createCheckoutHandler));
billingRouter.post('/portal', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(createPortalHandler));
billingRouter.post('/cancel', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(cancelSubscriptionHandler));
billingRouter.post('/resume', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(resumeSubscriptionHandler));
