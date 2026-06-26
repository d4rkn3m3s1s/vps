import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

export async function GET() {
  const res = await apiCall('/alerts/triggers', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
