import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Tek-tıkla cihaz oluştur: sıfırdan yeni izole Waydroid instance kurulumunu başlatır.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await apiCall('/provision/create', { method: 'POST', body, auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 201 : res.status });
}
