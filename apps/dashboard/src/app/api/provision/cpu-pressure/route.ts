import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Host CPU yükü + boşta (uyutulabilir) cihaz adayları. "CPU yüksek — boşta
// cihazları uyut?" uyarısı bunu yoklar.
export async function GET() {
  const res = await apiCall('/provision/cpu-pressure', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
