import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../lib/apiClient';

// Operatör panelden devam eden/kuyruğa alınmış cihaz kurulumunu iptal eder.
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const res = await apiCall(`/provision/cancel/${encodeURIComponent(jobId)}`, { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
