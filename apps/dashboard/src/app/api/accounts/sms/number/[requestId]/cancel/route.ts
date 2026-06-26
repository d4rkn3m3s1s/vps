import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

export async function POST(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const res = await apiCall(`/accounts/sms/number/${requestId}/cancel`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
