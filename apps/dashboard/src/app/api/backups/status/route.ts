import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Çalışan yedeğin canlı durumu — panel bunu saniyede bir yoklar.
export async function GET() {
  const res = await apiCall('/backups/status', { auth: true });
  return NextResponse.json({ data: res.data }, { status: res.ok ? 200 : res.status });
}
