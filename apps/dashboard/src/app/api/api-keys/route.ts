import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// List API keys for the active workspace (admin-only on the API side).
export async function GET() {
  const res = await apiCall('/api-keys', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

// Create a key. The plaintext is in the response and shown to the user once.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/api-keys', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
