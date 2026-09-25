import { NextResponse } from 'next/server';
import { apiCall } from '../../../../../../../lib/apiClient';

// ★2026-09-24 EKSIK PROXY: API'de `/accounts/batch/accounts/:id/shots` (kayit
// akisinin adim adim ekran goruntuleri) 12 batch route'undan biri olarak HAZIRDI
// ve `Job.result.shots` dolu geliyordu (olculdu: 4-6 shot, 79-266 kB PNG), ama
// panelin Next.js proxy katmaninda bu tek route YOKTU — kardeslerinin (otp,
// cancel, provision, register, whatsapp/*) hepsi vardi. Panel API'ye hic
// ulasamadigi icin kayit ekran goruntuleri siteye DUSMUYORDU.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/accounts/batch/accounts/${id}/shots`, { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
