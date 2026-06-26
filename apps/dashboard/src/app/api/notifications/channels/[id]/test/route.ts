import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/notifications/channels/${id}/test`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
