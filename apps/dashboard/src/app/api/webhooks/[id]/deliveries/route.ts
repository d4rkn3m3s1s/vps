import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Recent delivery attempts for a webhook (workspace-scoped on the API side).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/webhooks/${id}/deliveries`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
