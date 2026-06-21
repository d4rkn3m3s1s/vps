import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const address = new URL(request.url).searchParams.get('address') ?? '';
  const res = await apiCall(`/accounts/mail/message/${id}?address=${encodeURIComponent(address)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
