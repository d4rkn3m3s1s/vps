import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Route a device through a provider proxy for a chosen exit country.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/proxies/assign-country', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
