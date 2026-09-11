---
name: new-feature-modules
description: "Four features added 2026-06-26 — trend analytics, cost/profit panel, notification channels, AI insights/NL-query — where they live and how they wire in"
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Four features built end-to-end on 2026-06-26 (all tsc-clean, endpoints verified 200):

1. **Trend analytics** — `apps/api/src/modules/trends/` (rollupMetrics/getTrends/tickTrendsRollup) writes daily `MetricSnapshot` rows; ticker in `index.ts` runs `tickTrendsRollup()` every 300s. Dashboard `app/trends/page.tsx` + `app/api/trends/summary/route.ts`. Series fills over time (one row/day).
2. **Cost & profit panel** — `apps/api/src/modules/costs/` (getCostSummary): Vast GPU spend from `Host.costPerHour × uptime` + Stripe MRR from `billing.plans.ts` price labels + usage cost from `usageService.getSummary`. Dashboard `app/costs/page.tsx`. All money in integer cents.
3. **Notification channels** — `apps/api/src/modules/notifications/` (Telegram/Slack/Discord). Config AES-encrypted in `NotificationChannel` table. `dispatch()` is hooked into `alerts.service.ts` evaluate() so every fired alert fans out. UI: `components/NotificationChannels.tsx` rendered inside `alerts/AlertsView.tsx`.
4. **AI insights + NL fleet query** — added `generateInsights`/`queryFleet` to existing `apps/api/src/modules/ai/ai.service.ts` (reuses the raw-fetch forced-tool pattern, `claude-opus-4-8`, NO temperature/budget_tokens). Routes `/ai/insights` + `/ai/query`. UI in `ai/AiView.tsx`. Returns 503 AI_NOT_CONFIGURED until `ANTHROPIC_API_KEY` is set in `apps/api/.env` (currently empty).

**Schema:** migration `20260626000000_features_trend_cost_notify` (idempotent). Models: `prisma.metricSnapshot`, `prisma.notificationChannel`, `Host.costPerHour`.
**Sidebar:** added `/trends` + `/costs` nav (i18n keys `nav.trends`, `nav.costs`). Routes mounted in `routes/index.ts`. See [[local-stack-startup]].
