import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Bir kurulum job'unun kalıcı log geçmişi + son durumu (modal arka plandan dönünce).
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const res = await apiCall(`/provision/status/${encodeURIComponent(jobId)}`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
