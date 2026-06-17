import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Sends a synthetic test delivery to a webhook.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/webhooks/${id}/test`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
