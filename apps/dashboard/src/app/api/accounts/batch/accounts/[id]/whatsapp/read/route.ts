import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../../lib/apiClient';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/accounts/batch/accounts/${id}/whatsapp/read`, { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
