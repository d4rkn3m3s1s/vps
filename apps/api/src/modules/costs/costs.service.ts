import { SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { PLANS, type PlanKey } from '../billing/billing.plans';
import { usageService } from '../usage/usage.service';

// ── Cost & Profit unification ───────────────────────────────────────────────
//
// Pulls together three money streams into one workspace-scoped view:
//   (1) Vast GPU spend  — accrued from host costPerHour × uptime
//   (2) Stripe revenue  — MRR from active/trialing subscriptions
//   (3) Usage cost      — per-device online-minute metering (usageService)
// then derives profit, ROI, and per-device / per-account unit economics.
// All money is integer cents.

// Parse a plan priceLabel like "$29/mo" or "$0" into integer cents.
function planMonthlyCents(plan: PlanKey): number {
  const label = PLANS[plan]?.priceLabel ?? '$0';
  const match = label.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match || !match[1]) return 0;
  return Math.round(parseFloat(match[1]) * 100);
}

const ACTIVE_STATUSES = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING];

export async function getCostSummary(workspaceId: string | undefined, days = 30) {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, days)) : 30;
  const ws = workspaceId ? { workspaceId } : {};

  // (1) GPU spend — Vast hosts, accrued from uptime.
  const vastHosts = await prisma.host.findMany({
    where: { ...ws, provider: 'vast' },
    select: { costPerHour: true, createdAt: true }
  });
  let gpuSpendCents = 0;
  const now = Date.now();
  for (const h of vastHosts) {
    const hours = Math.max(0, (now - h.createdAt.getTime()) / 3.6e6);
    gpuSpendCents += Math.round((h.costPerHour ?? 0) * hours * 100);
  }

  // (2) Revenue — MRR from active/trialing subscriptions.
  const subs = await prisma.subscription.findMany({
    where: { ...ws, status: { in: ACTIVE_STATUSES } },
    select: { plan: true }
  });
  let mrrCents = 0;
  for (const s of subs) {
    const key = (s.plan && s.plan in PLANS ? s.plan : 'free') as PlanKey;
    mrrCents += planMonthlyCents(key);
  }

  // (3) Usage cost — reuse the metering service.
  const usage = await usageService.getSummary(workspaceId, safeDays);
  const usageSpendCents = usage.estimatedCostCents;

  // (4) Fleet counts.
  const [deviceCount, accountCount] = await Promise.all([
    prisma.device.count({ where: { ...ws } }),
    prisma.farmAccount.count({ where: { ...ws } })
  ]);

  const totalCostCents = gpuSpendCents + usageSpendCents;
  const profitCents = mrrCents - totalCostCents;
  const roi = totalCostCents > 0 ? profitCents / totalCostCents : 0;

  return {
    days: safeDays,
    costs: {
      gpuSpendCents,
      usageSpendCents,
      totalCostCents
    },
    revenue: { mrrCents },
    profitCents,
    roi,
    perDevice: {
      count: deviceCount,
      costPerDeviceCents: deviceCount > 0 ? Math.round(totalCostCents / deviceCount) : 0
    },
    perAccount: {
      count: accountCount,
      costPerAccountCents: accountCount > 0 ? Math.round(totalCostCents / accountCount) : 0
    },
    byDay: usage.series
  };
}
