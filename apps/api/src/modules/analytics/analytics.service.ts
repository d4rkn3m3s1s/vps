import { prisma } from '../../db/prisma';

export type AnalyticsSummary = {
  totals: { posts: number; likes: number; comments: number; shares: number; reach: number; followers: number };
  byProvider: Array<{ provider: string; posts: number; likes: number; comments: number; followers: number; engagementRate: number }>;
  timeline: Array<{ date: string; posts: number; likes: number; reach: number }>;
  topAccounts: Array<{ accountId: string | null; provider: string; followers: number; engagementRate: number }>;
};

function engagement(likes: number, comments: number, shares: number, reach: number): number {
  if (reach <= 0) return 0;
  return Number((((likes + comments + shares) / reach) * 100).toFixed(2));
}

export class AnalyticsService {
  async summary(days = 14): Promise<AnalyticsSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const metrics = await prisma.contentMetric.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' }
    });

    const totals = metrics.reduce(
      (acc, m) => ({
        posts: acc.posts + m.posts,
        likes: acc.likes + m.likes,
        comments: acc.comments + m.comments,
        shares: acc.shares + m.shares,
        reach: acc.reach + m.reach,
        followers: Math.max(acc.followers, m.followers)
      }),
      { posts: 0, likes: 0, comments: 0, shares: 0, reach: 0, followers: 0 }
    );

    // Aggregate per provider.
    const providerMap = new Map<string, { posts: number; likes: number; comments: number; shares: number; reach: number; followers: number }>();
    for (const m of metrics) {
      const cur = providerMap.get(m.provider) ?? { posts: 0, likes: 0, comments: 0, shares: 0, reach: 0, followers: 0 };
      cur.posts += m.posts;
      cur.likes += m.likes;
      cur.comments += m.comments;
      cur.shares += m.shares;
      cur.reach += m.reach;
      cur.followers = Math.max(cur.followers, m.followers);
      providerMap.set(m.provider, cur);
    }
    const byProvider = Array.from(providerMap.entries()).map(([provider, v]) => ({
      provider,
      posts: v.posts,
      likes: v.likes,
      comments: v.comments,
      followers: v.followers,
      engagementRate: engagement(v.likes, v.comments, v.shares, v.reach)
    }));

    // Daily timeline.
    const dayMap = new Map<string, { posts: number; likes: number; reach: number }>();
    for (const m of metrics) {
      const key = m.date.toISOString().slice(0, 10);
      const cur = dayMap.get(key) ?? { posts: 0, likes: 0, reach: 0 };
      cur.posts += m.posts;
      cur.likes += m.likes;
      cur.reach += m.reach;
      dayMap.set(key, cur);
    }
    const timeline = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }));

    const topAccounts = [...metrics]
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 5)
      .map((m) => ({
        accountId: m.accountId,
        provider: m.provider,
        followers: m.followers,
        engagementRate: engagement(m.likes, m.comments, m.shares, m.reach)
      }));

    return { totals, byProvider, timeline, topAccounts };
  }

  // Seeds a fresh install with believable demo metrics so the dashboard isn't
  // empty before real data flows in. Idempotent: only runs when empty.
  async seedIfEmpty(): Promise<number> {
    const count = await prisma.contentMetric.count();
    if (count > 0) return 0;

    const providers = ['INSTAGRAM', 'TIKTOK', 'X', 'FACEBOOK'];
    const rows: Array<{
      provider: string;
      date: Date;
      posts: number;
      likes: number;
      comments: number;
      shares: number;
      followers: number;
      reach: number;
    }> = [];

    for (let d = 13; d >= 0; d -= 1) {
      const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
      for (const provider of providers) {
        const base = provider === 'TIKTOK' ? 4000 : provider === 'INSTAGRAM' ? 2600 : 1400;
        const reach = base + Math.round(Math.sin(d) * 400) + d * 30;
        rows.push({
          provider,
          date,
          posts: 1 + (d % 3),
          likes: Math.round(reach * 0.08),
          comments: Math.round(reach * 0.012),
          shares: Math.round(reach * 0.006),
          followers: base * 3 + (13 - d) * 25,
          reach
        });
      }
    }

    await prisma.contentMetric.createMany({ data: rows });
    return rows.length;
  }
}

export const analyticsService = new AnalyticsService();
