import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { billingService } from './billing.service';

const checkoutSchema = z.object({ plan: z.enum(['pro', 'scale']) });

export async function getBillingHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await billingService.getBilling(workspaceId) });
}

export async function createCheckoutHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const { plan } = checkoutSchema.parse(req.body);
  const email = req.auth?.email ?? 'billing@local.dev';
  const result = await billingService.createCheckout(workspaceId, plan, email);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'billing.checkout',
    resourceType: 'subscription',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { plan },
    workspaceId
  });
  res.json({ data: result });
}

export async function createPortalHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await billingService.createPortal(workspaceId) });
}

export async function cancelSubscriptionHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const result = await billingService.cancelSubscription(workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'billing.cancel',
    resourceType: 'subscription',
    requestId: req.requestId,
    ip: req.ip,
    workspaceId
  });
  res.json({ data: result });
}

export async function resumeSubscriptionHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const result = await billingService.resumeSubscription(workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'billing.resume',
    resourceType: 'subscription',
    requestId: req.requestId,
    ip: req.ip,
    workspaceId
  });
  res.json({ data: result });
}

// Stripe webhook. Uses the raw body (see route) for signature verification.
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.header('stripe-signature');
  if (!signature) throw new AppError('Missing stripe-signature', 400, 'INVALID_SIGNATURE');

  let event;
  try {
    event = billingService.constructEvent(req.body as Buffer, signature);
  } catch (err) {
    throw new AppError(`Webhook signature verification failed: ${err instanceof Error ? err.message : 'error'}`, 400, 'INVALID_SIGNATURE');
  }

  // On any subscription lifecycle change, re-sync our DB from Stripe.
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await billingService.syncFromStripeSubscription(event.data.object as Parameters<typeof billingService.syncFromStripeSubscription>[0]);
      break;
    case 'checkout.session.completed': {
      // The subscription.created event handles activation; nothing extra needed.
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
}
