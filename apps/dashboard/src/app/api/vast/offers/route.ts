import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function GET(request: Request) {
  const qs = new URL(request.url).searchParams.toString();
  const res = await apiCall(`/vast/offers${qs ? `?${qs}` : ''}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
