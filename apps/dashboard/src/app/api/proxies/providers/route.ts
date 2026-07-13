import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Provider (country-selectable) proxies.
export async function GET() {
  const res = await apiCall('/proxies/providers', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
