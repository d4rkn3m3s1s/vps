import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Kurulum adım planı (dashboard adım çubuğu bunu kullanır).
export async function GET() {
  const res = await apiCall('/provision/steps', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
