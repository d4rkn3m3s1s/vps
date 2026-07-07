import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../lib/apiClient';

// Read one account row (used to poll registration status: REGISTERING →
// AWAITING_OTP → ACTIVE / FAILED).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/batch/accounts/${id}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/batch/accounts/${id}`, { method: 'DELETE', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
