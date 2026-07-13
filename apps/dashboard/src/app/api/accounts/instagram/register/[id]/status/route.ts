import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

// Live Instagram-registration progress (log + last step) for the modal to restore
// after "arka plana al" → reopen. Keyed by accountId.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/instagram/register/${id}/status`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
