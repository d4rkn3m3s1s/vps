import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

export async function GET(request: Request) {
  const batchId = new URL(request.url).searchParams.get('batchId');
  const path = batchId ? `/accounts/batch/accounts?batchId=${encodeURIComponent(batchId)}` : '/accounts/batch/accounts';
  const res = await apiCall(path, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
