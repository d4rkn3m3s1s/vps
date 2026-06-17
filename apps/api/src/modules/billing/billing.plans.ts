// Plan catalog — the single source of truth for quotas and pricing. Stripe price
// IDs come from env (test mode) so the same code works across environments. A
// plan with no priceId (free) never hits Stripe.
import { env } from '../../config/env';

export type PlanKey = 'free' | 'pro' | 'scale';

export type Plan = {
  key: PlanKey;
  name: string;
  priceLabel: string;
  priceId: string | null; // Stripe price id (test mode), null for free
  deviceLimit: number;
  memberLimit: number;
  features: string[];
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: 'free',
    name: 'Free',
    priceLabel: '$0',
    priceId: null,
    deviceLimit: 2,
    memberLimit: 2,
    features: ['2 cloud phones', 'Basic automation', 'Community support']
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    priceLabel: '$29/mo',
    priceId: env.stripePricePro ?? null,
    deviceLimit: 20,
    memberLimit: 10,
    features: ['20 cloud phones', 'All templates', 'Proxy pool', 'RPA studio', 'Priority support']
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    priceLabel: '$99/mo',
    priceId: env.stripePriceScale ?? null,
    deviceLimit: 100,
    memberLimit: 50,
    features: ['100 cloud phones', 'Synchronizer', 'Analytics Pro', 'Dedicated infra', 'SLA']
  }
};

export function planFromKey(key: string | null | undefined): Plan {
  if (key && key in PLANS) return PLANS[key as PlanKey];
  return PLANS.free;
}

// Resolve a plan from a Stripe price id (used by the webhook).
export function planFromPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  return Object.values(PLANS).find((p) => p.priceId === priceId) ?? null;
}
