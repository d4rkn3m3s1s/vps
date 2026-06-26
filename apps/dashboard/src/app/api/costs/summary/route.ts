import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function GET(request: Request) {
  const days = new URL(request.url).searchParams.get('days') ?? '30';
  const res = await apiCall(`/costs/summary?days=${encodeURIComponent(days)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
