import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

// Re-queues a past delivery.
export async function POST(_request: Request, { params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params;
  const res = await apiCall(`/webhooks/deliveries/${deliveryId}/redeliver`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
