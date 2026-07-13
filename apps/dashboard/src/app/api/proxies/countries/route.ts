import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Country catalogue a provider proxy can exit from.
export async function GET() {
  const res = await apiCall('/proxies/countries', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
