import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Bulk action over many conversations (read/archive/favorite/pin/label).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/whatsapp/conversations/bulk', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
