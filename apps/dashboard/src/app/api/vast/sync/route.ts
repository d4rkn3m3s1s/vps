import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Reconcile Vast instances -> hosts/devices for the active workspace.
export async function POST() {
  const res = await apiCall('/vast/sync', { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
