import { NextResponse } from 'next/server';
import { getAccessToken } from '../../../lib/apiClient';

// Mints a short-lived access token + returns the public WS base so the browser
// can open the fleet-event socket (/ws/devices) authenticated. The event hub now
// requires a JWT on upgrade (workspace-scoped), so the client must present one.
export async function POST() {
  try {
    const token = await getAccessToken();
    const wsBase = (process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws/devices').replace(/\/ws\/devices$/, '');
    return NextResponse.json({ data: { token, wsBase } });
  } catch {
    return NextResponse.json({ data: null }, { status: 401 });
  }
}
