import { NextResponse } from 'next/server';
import { apiCall } from '../../../lib/apiClient';

// Yedek listesi + disk doluluğu + o an çalışan yedeğin durumu.
export async function GET() {
  const res = await apiCall('/backups', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}

// Yeni yedek başlatır. API 202 döner (iş arka planda sürer).
export async function POST() {
  const res = await apiCall('/backups/run', { method: 'POST', auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 202 : res.status });
}
