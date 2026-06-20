import Stripe from 'stripe';
import { prisma } from '../../db/prisma';

// Minimal structural shape of the Stripe Subscription fields we read in the
// webhook. Avoids depending on the Stripe namespace types, which this build
// exports separately from the default constructor import.
type StripeSubscription = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items: { data: Array<{ price?: { id?: string } | null }> };
};
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { PLANS, planFromKey, planFromPriceId, type PlanKey } from './billing.plans';
import { alertsService } from '../alerts/alerts.service';

// Lazily construct the Stripe client so the app boots without billing configured.
type StripeClient = InstanceType<typeof Stripe>;
let stripeClient: StripeClient | null = null;
function stripe(): StripeClient {
  if (!env.stripeSecretKey) {
    throw new AppError('Billing is not configured (missing STRIPE_SECRET_KEY)', 503, 'BILLING_NOT_CONFIGURED');
  }
  if (!stripeClient) stripeClient = new Stripe(env.stripeSecretKey);
  return stripeClient;
}

export function isBillingConfigured(): boolean {
  return Boolean(env.stripeSecretKey);
}

export class BillingService {
  // Every workspace has a subscription row; free by default.
  async ensureSubscription(workspaceId: string) {
    return prisma.subscription.upsert({
      where: { workspaceId },
      update: {},
      create: { workspaceId, plan: 'free', status: 'ACTIVE' }
    });
  }

  // Current plan + live usage + quota for a workspace.
  async getBilling(workspaceId: string) {
    const sub = await this.ensureSubscription(workspaceId);
    const plan = planFromKey(sub.plan);
    const [devices, members] = await Promise.all([
      prisma.device.count({ where: { workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId } })
    ]);
    return {
      plan: plan.key,
      planName: plan.name,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      usage: {
        devices: { used: devices, limit: plan.deviceLimit },
        members: { used: members, limit: plan.memberLimit }
      },
      plans: Object.values(PLANS).map((p) => ({
        key: p.key,
        name: p.name,
        priceLabel: p.priceLabel,
        deviceLimit: p.deviceLimit,
        memberLimit: p.memberLimit,
        features: p.features,
        purchasable: Boolean(p.priceId)
      })),
      billingConfigured: isBillingConfigured()
    };
  }

  // Enforced before creating a device. Throws 402 if the plan limit is reached.
  // `unlimited` skips the quota check entirely — used for admins / workspace
  // owners on a self-hosted install, who shouldn't be capped by billing plans.
  async assertCanAddDevice(workspaceId: string, opts: { unlimited?: boolean } = {}): Promise<void> {
    const sub = await this.ensureSubscription(workspaceId);
    const plan = planFromKey(sub.plan);
    const count = await prisma.device.count({ where: { workspaceId } });
    if (!opts.unlimited && count >= plan.deviceLimit) {
      throw new AppError(
        `Device limit reached for the ${plan.name} plan (${plan.deviceLimit}). Upgrade to add more.`,
        402,
        'QUOTA_EXCEEDED'
      );
    }
    // After this device, what % of the quota is used? Fire QUOTA_HIGH alerts.
    // Unlimited (admin/owner) accounts have no quota to warn about.
    const pctAfter = Math.round(((count + 1) / plan.deviceLimit) * 100);
    if (!opts.unlimited && pctAfter >= 80) {
      void alertsService.evaluate(workspaceId, 'QUOTA_HIGH', {
        title: 'Device quota almost full',
        detail: `${count + 1}/${plan.deviceLimit} cloud phones used (${pctAfter}%)`,
        value: pctAfter
      });
    }
  }

  // Creates a Stripe Checkout session to upgrade a workspace to a paid plan.
  async createCheckout(workspaceId: string, planKey: PlanKey, userEmail: string) {
    const plan = PLANS[planKey];
    if (!plan?.priceId) throw new AppError('That plan is not purchasable', 400, 'INVALID_PLAN');

    const sub = await this.ensureSubscription(workspaceId);

    // Reuse or create the Stripe customer for this workspace.
    let customerId = sub.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: userEmail,
        metadata: { workspaceId }
      });
      customerId = customer.id;
      await prisma.subscription.update({ where: { workspaceId }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${env.webBaseUrl}/billing?status=success`,
      cancel_url: `${env.webBaseUrl}/billing?status=cancel`,
      metadata: { workspaceId, plan: planKey },
      subscription_data: { metadata: { workspaceId, plan: planKey } }
    });

    return { url: session.url };
  }

  // Opens the Stripe billing portal so the customer can manage/cancel.
  async createPortal(workspaceId: string) {
    const sub = await this.ensureSubscription(workspaceId);
    if (!sub.stripeCustomerId) throw new AppError('No billing account yet', 400, 'NO_CUSTOMER');
    const session = await stripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${env.webBaseUrl}/billing`
    });
    return { url: session.url };
  }

  // Schedules cancellation at the end of the current paid period (no immediate
  // loss of access). For free/unconfigured workspaces this is a no-op.
  async cancelSubscription(workspaceId: string) {
    const sub = await this.ensureSubscription(workspaceId);
    if (!sub.stripeSubscriptionId) {
      throw new AppError('No active paid subscription to cancel', 400, 'NO_SUBSCRIPTION');
    }
    const updated = await stripe().subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true
    });
    await prisma.subscription.update({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: true }
    });
    return { cancelAtPeriodEnd: true, status: updated.status };
  }

  // Reverses a scheduled cancellation while the subscription is still active.
  async resumeSubscription(workspaceId: string) {
    const sub = await this.ensureSubscription(workspaceId);
    if (!sub.stripeSubscriptionId) {
      throw new AppError('No subscription to resume', 400, 'NO_SUBSCRIPTION');
    }
    const updated = await stripe().subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false
    });
    await prisma.subscription.update({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: false }
    });
    return { cancelAtPeriodEnd: false, status: updated.status };
  }

  // Verifies + parses a Stripe webhook event.
  constructEvent(rawBody: Buffer, signature: string) {
    if (!env.stripeWebhookSecret) {
      throw new AppError('Webhook secret not configured', 503, 'BILLING_NOT_CONFIGURED');
    }
    return stripe().webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  }

  // Applies a Stripe subscription state to our DB.
  async syncFromStripeSubscription(sub: StripeSubscription): Promise<void> {
    const workspaceId = sub.metadata?.workspaceId;
    if (!workspaceId) return;

    const priceId = sub.items.data[0]?.price?.id;
    const plan = planFromPriceId(priceId) ?? planFromKey('free');

    const statusMap: Record<string, 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE'> = {
      active: 'ACTIVE',
      trialing: 'TRIALING',
      past_due: 'PAST_DUE',
      canceled: 'CANCELED',
      unpaid: 'PAST_DUE',
      incomplete: 'INCOMPLETE',
      incomplete_expired: 'CANCELED'
    };
    const status = statusMap[sub.status] ?? 'INCOMPLETE';
    // Canceled/incomplete subscriptions fall back to the free plan's quota.
    const effectivePlan = status === 'ACTIVE' || status === 'TRIALING' ? plan.key : 'free';

    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;

    await prisma.subscription.update({
      where: { workspaceId },
      data: {
        plan: effectivePlan,
        status,
        stripeSubscriptionId: sub.id,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {})
      }
    });
  }
}

export const billingService = new BillingService();
