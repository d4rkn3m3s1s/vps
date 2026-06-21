import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Store the Vast.ai API key for the active workspace (encrypted server-side).
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/vast/key', { method: 'PUT', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function DELETE() {
  const res = await apiCall('/vast/key', { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
