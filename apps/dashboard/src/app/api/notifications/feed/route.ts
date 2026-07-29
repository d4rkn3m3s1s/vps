import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Bildirim merkezinin KALICI beslemesi (backend: /notifications/feed).
// `channels` uçlarıyla karıştırmayın: onlar bildirimlerin nereye gönderileceğini
// yönetir, bu uç panelin zil ikonundaki listeyi getirir.
export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit');
  const unreadOnly = req.nextUrl.searchParams.get('unreadOnly');
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', limit);
  if (unreadOnly) qs.set('unreadOnly', unreadOnly);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiCall(`/notifications/feed${suffix}`, { auth: true });
  // meta.unreadCount'u da geçir: panel rozet sayısını buradan okuyor.
  return NextResponse.json(
    { data: res.data, meta: (res as { meta?: unknown }).meta ?? null },
    { status: res.ok ? 200 : res.status }
  );
}

// Tümünü temizle.
export async function DELETE() {
  const res = await apiCall('/notifications/feed', { auth: true, method: 'DELETE' });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
