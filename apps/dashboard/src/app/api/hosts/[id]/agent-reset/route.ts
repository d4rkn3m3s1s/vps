import { NextResponse } from 'next/server';
import { apiCall, apiResponse } from '../../../../../lib/apiClient';

// ★2026-08-14: canlı yayın kanalı koptuğunda panelden tek tıkla agent sıfırlama.
// Hata gövdesini apiResponse ile üst seviyeye çıkarıyoruz — aksi halde buton
// sessizce "çalışmıyor" görünür (bkz. apiClient.ts'teki canlı kanıt notu).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiCall(`/hosts/${id}/agent/reset`, { method: 'POST', auth: true });
  const out = apiResponse(res);
  return NextResponse.json(out.body, { status: out.status });
}
