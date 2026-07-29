import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Bildirimleri okundu işaretle. Gövde boşsa backend TÜMÜNÜ okundu sayar
// (panelde zil açılınca yapılan davranış).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/notifications/feed/read', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
