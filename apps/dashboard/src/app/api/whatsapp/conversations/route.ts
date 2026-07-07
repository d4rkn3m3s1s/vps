import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// WhatsApp conversation list (chat sidebar). Forwards the filter/search/paging
// query straight through to the workspace-scoped backend.
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['deviceId', 'filter', 'labelId', 'search', 'limit', 'cursor']) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  const res = await apiCall(`/whatsapp/conversations?${qs.toString()}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
