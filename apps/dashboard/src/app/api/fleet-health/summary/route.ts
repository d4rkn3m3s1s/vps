import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Filo sağlık özeti: cihaz durumları + WhatsApp hesap sağlığı + bugünkü kayıt + host kaynak.
export async function GET() {
  const res = await apiCall('/fleet-health/summary', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
