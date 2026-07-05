import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Returns the workspace's dedicated documentation key in plaintext (minted on
// first use by the API) so the docs page can render a copy-pasteable example.
export async function GET() {
  const res = await apiCall('/api-keys/doc-key', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
