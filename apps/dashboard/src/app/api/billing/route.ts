import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// Current plan, usage, and quota for the active workspace.
export async function GET() {
  const res = await apiCall('/billing', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
