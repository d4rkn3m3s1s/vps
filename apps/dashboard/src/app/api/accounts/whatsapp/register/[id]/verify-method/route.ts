import { NextResponse } from 'next/server';
import { apiCall, apiResponse } from '../../../../../../../lib/apiClient';

// Operator picked a verification method (sms | voice | missed_call) on the "Choose
// how to verify" sheet; the agent re-dispatches and selects that row.
// ★2026-08-13 apiResponse: hata sebebi artık YUTULMUYOR (bkz. apiClient.ts).
// Bu uç özellikle önemli: "SESLİ ARAMA ile devam et" burada çalışıyor ve reddedilirse
// operatörün sebebi görmesi şart (rate-limit ekranında tek çıkış yolu bu olabiliyor).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await apiCall(`/accounts/whatsapp/register/${id}/verify-method`, { method: 'POST', body, auth: true });
  const out = apiResponse(res);
  return NextResponse.json(out.body, { status: out.status });
}
