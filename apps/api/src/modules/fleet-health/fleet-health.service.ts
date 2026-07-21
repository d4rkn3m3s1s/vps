import { prisma } from '../../db/prisma';

// Fleet health + registration analytics — a single at-a-glance operational picture:
//  • device status counts (ONLINE/OFFLINE/ERROR)
//  • WhatsApp account health (ACTIVE / RESTRICTED / BANNED / LOGGED_OUT / awaiting)
//  • today's registration outcomes (started / active / failed)
//  • host resource averages (CPU/RAM/disk from the latest heartbeat metrics)
//  • registration success breakdown by country / proxy country / device model
// All workspace-scoped. Real DB data only — no fabricated numbers.

export type FleetHealth = {
  devices: { total: number; online: number; offline: number; error: number };
  waAccounts: {
    total: number; active: number; restricted: number; banned: number; loggedOut: number;
    awaitingOtp: number; awaitingManual: number; failed: number;
  };
  today: { started: number; active: number; failed: number; successRate: number };
  host: { avgCpu: number; avgMem: number; avgDisk: number; onlineDevices: number };
};

export type RegisterAnalytics = {
  byCountry: Array<{ key: string; total: number; active: number; failed: number; successRate: number }>;
  byProxyCountry: Array<{ key: string; total: number; active: number; failed: number; successRate: number }>;
  byModel: Array<{ key: string; total: number; active: number; failed: number; successRate: number }>;
  overall: { total: number; active: number; failed: number; successRate: number };
};

function rate(active: number, total: number): number {
  return total > 0 ? Math.round((active / total) * 100) : 0;
}

// Roll an accumulator of {total,active,failed} per key into a sorted, rate-annotated list.
function toList(m: Map<string, { total: number; active: number; failed: number }>) {
  return [...m.entries()]
    .map(([key, v]) => ({ key, total: v.total, active: v.active, failed: v.failed, successRate: rate(v.active, v.total) }))
    .sort((a, b) => b.total - a.total);
}

class FleetHealthService {
  async health(workspaceId: string | undefined): Promise<FleetHealth> {
    const ws = workspaceId ? { workspaceId } : {};
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      total, online, offline, errorCount,
      waRows, todayRows, devMetrics
    ] = await Promise.all([
      prisma.device.count({ where: { ...ws } }),
      prisma.device.count({ where: { status: 'ONLINE', ...ws } }),
      prisma.device.count({ where: { status: 'OFFLINE', ...ws } }),
      prisma.device.count({ where: { status: 'ERROR', ...ws } }),
      // WhatsApp account health — group by status.
      prisma.generatedAccount.groupBy({
        by: ['status'],
        where: { platform: 'whatsapp', ...ws },
        _count: { _all: true }
      }),
      // Today's registrations.
      prisma.generatedAccount.findMany({
        where: { platform: 'whatsapp', createdAt: { gte: startOfToday }, ...ws },
        select: { status: true }
      }),
      // Latest per-device resource metrics (from heartbeat) — average across the fleet.
      prisma.device.findMany({
        where: { status: 'ONLINE', ...ws },
        select: { cpuUsage: true, memoryUsage: true, diskUsage: true }
      })
    ]);

    const waCount = (s: string) => waRows.find((r) => r.status === s)?._count._all ?? 0;
    const waTotal = waRows.reduce((a, r) => a + r._count._all, 0);

    const todayStarted = todayRows.length;
    const todayActive = todayRows.filter((r) => r.status === 'ACTIVE').length;
    const todayFailed = todayRows.filter((r) => r.status === 'FAILED' || r.status === 'BANNED').length;

    const avg = (key: 'cpuUsage' | 'memoryUsage' | 'diskUsage') => {
      const vals = devMetrics.map((d) => d[key]).filter((n): n is number => typeof n === 'number' && n > 0);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    };

    return {
      devices: { total, online, offline, error: errorCount },
      waAccounts: {
        total: waTotal,
        active: waCount('ACTIVE'),
        restricted: waCount('RESTRICTED'),
        banned: waCount('BANNED'),
        loggedOut: waCount('LOGGED_OUT'),
        awaitingOtp: waCount('AWAITING_OTP'),
        awaitingManual: waCount('AWAITING_MANUAL'),
        failed: waCount('FAILED')
      },
      today: { started: todayStarted, active: todayActive, failed: todayFailed, successRate: rate(todayActive, todayStarted) },
      host: { avgCpu: avg('cpuUsage'), avgMem: avg('memoryUsage'), avgDisk: avg('diskUsage'), onlineDevices: online }
    };
  }

  // Registration success breakdown — which country / proxy / model registers best.
  // Uses the WhatsApp GeneratedAccount rows joined to their device (for proxy country
  // + model) within the window. ACTIVE = success; FAILED/BANNED = failure.
  async registerAnalytics(workspaceId: string | undefined, days = 30): Promise<RegisterAnalytics> {
    const ws = workspaceId ? { workspaceId } : {};
    const since = new Date(Date.now() - Math.min(Math.max(1, days), 365) * 24 * 60 * 60 * 1000);

    const accounts = await prisma.generatedAccount.findMany({
      where: { platform: 'whatsapp', createdAt: { gte: since }, ...ws },
      select: { status: true, countryCode: true, deviceId: true }
    });
    // GeneratedAccount has no Prisma relation to Device (just a deviceId FK), so fetch
    // the referenced devices in ONE query and map deviceId → {model, proxyCountry}.
    const deviceIds = [...new Set(accounts.map((a) => a.deviceId).filter((id): id is string => !!id))];
    const devices = deviceIds.length
      ? await prisma.device.findMany({
          where: { id: { in: deviceIds } },
          select: { id: true, metadata: true, fingerprint: { select: { model: true } } }
        })
      : [];
    const devById = new Map(devices.map((d) => [d.id, d]));

    const byCountry = new Map<string, { total: number; active: number; failed: number }>();
    const byProxy = new Map<string, { total: number; active: number; failed: number }>();
    const byModel = new Map<string, { total: number; active: number; failed: number }>();
    let total = 0, active = 0, failed = 0;

    const bump = (m: Map<string, { total: number; active: number; failed: number }>, key: string, isActive: boolean, isFailed: boolean) => {
      const k = key || '—';
      const cur = m.get(k) ?? { total: 0, active: 0, failed: 0 };
      cur.total++; if (isActive) cur.active++; if (isFailed) cur.failed++;
      m.set(k, cur);
    };

    for (const a of accounts) {
      const isActive = a.status === 'ACTIVE';
      const isFailed = a.status === 'FAILED' || a.status === 'BANNED';
      // Terminal outcomes only shape the rate; still count total for volume context.
      total++; if (isActive) active++; if (isFailed) failed++;
      bump(byCountry, a.countryCode ?? '—', isActive, isFailed);
      const dev = a.deviceId ? devById.get(a.deviceId) : undefined;
      // Proxy exit country lives in device.metadata.proxyCountry (set by auto-proxy).
      const md = (dev?.metadata ?? {}) as Record<string, unknown>;
      const proxyCountry = typeof md.proxyCountry === 'string' ? md.proxyCountry : '—';
      bump(byProxy, proxyCountry, isActive, isFailed);
      // Model comes from the device's fingerprint (spoofed identity), else metadata.
      const model = dev?.fingerprint?.model ?? (typeof md.deviceModel === 'string' ? md.deviceModel : '—');
      bump(byModel, model || '—', isActive, isFailed);
    }

    return {
      byCountry: toList(byCountry),
      byProxyCountry: toList(byProxy),
      byModel: toList(byModel),
      overall: { total, active, failed, successRate: rate(active, total) }
    };
  }
}

export const fleetHealthService = new FleetHealthService();
