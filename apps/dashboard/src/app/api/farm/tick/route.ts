import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Manual engine kick ("Run now") so admins can test a campaign immediately.
export async function POST() {
  const res = await apiCall('/farm/tick', { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
