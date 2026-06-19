import { prisma } from '../../db/prisma';

// ── Usage metering (pay-as-you-go) ──────────────────────────────────────────
//
// Accrues per-device online minutes from heartbeats and rolls them into a daily
// bucket. The accrual is gap-capped: if an agent goes silent and resumes hours
// later, we only credit a bounded slice (not the whole gap), so a crashed host
// never inflates the bill. Cost is a simple per-minute rate applied on read.

// Default rate, comparable to VMOS' "timing device" ($0.006/min). Override per
// deployment via env if needed later.
const RATE_PER_MINUTE_CENTS = 0.6;
// Largest credit a single heartbeat may add (minutes). Heartbeats run ~30s, so
// a healthy device reports well under this; a long gap is clamped here.
const MAX_ACCRUAL_MINUTES = 10;

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const usageService = {
  // Called from the device heartbeat path. Credits the minutes elapsed since the
  // device's previous lastSeen to today's bucket (only while ONLINE).
  async accrue(deviceId: string, prevLastSeen: Date | null, now: Date, workspaceId?: string | undefined): Promise<void> {
    if (!prevLastSeen) return; // first heartbeat — nothing to measure yet
    const elapsedMin = (now.getTime() - prevLastSeen.getTime()) / 60_000;
    if (elapsedMin <= 0) return;
    const minutes = Math.round(Math.min(MAX_ACCRUAL_MINUTES, elapsedMin));
    if (minutes <= 0) return;
    const day = utcDay(now);
    await prisma.deviceUsage
      .upsert({
        where: { deviceId_day: { deviceId, day } },
        create: { deviceId, day, onlineMinutes: minutes, ...(workspaceId ? { workspaceId } : {}) },
        update: { onlineMinutes: { increment: minutes } }
      })
      .catch(() => undefined);
  },

  // Workspace usage over the last `days` days: total minutes, estimated cost,
  // a daily series for charting, and the top devices by minutes.
  async getSummary(workspaceId: string | undefined, days = 30) {
    const since = utcDay(new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86_400_000));
    const rows = await prisma.deviceUsage.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}), day: { gte: since } },
      include: { device: { select: { name: true } } },
      orderBy: { day: 'asc' }
    });

    const totalMinutes = rows.reduce((s, r) => s + r.onlineMinutes, 0);

    // Daily series.
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const key = r.day.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + r.onlineMinutes);
    }
    const series = Array.from(byDay.entries()).map(([date, minutes]) => ({ date, minutes }));

    // Per-device totals (top 10).
    const byDevice = new Map<string, { deviceId: string; name: string; minutes: number }>();
    for (const r of rows) {
      const cur = byDevice.get(r.deviceId) ?? { deviceId: r.deviceId, name: r.device?.name ?? r.deviceId.slice(0, 8), minutes: 0 };
      cur.minutes += r.onlineMinutes;
      byDevice.set(r.deviceId, cur);
    }
    const topDevices = Array.from(byDevice.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 10);

    return {
      days,
      ratePerMinuteCents: RATE_PER_MINUTE_CENTS,
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      estimatedCostCents: Math.round(totalMinutes * RATE_PER_MINUTE_CENTS),
      series,
      topDevices: topDevices.map((d) => ({ ...d, costCents: Math.round(d.minutes * RATE_PER_MINUTE_CENTS) }))
    };
  }
};
