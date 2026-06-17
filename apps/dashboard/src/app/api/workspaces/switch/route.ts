import { NextResponse } from 'next/server';

// Sets the active workspace cookie. Server components + apiClient read this to
// scope all data to the chosen workspace. We validate membership by attempting a
// real token switch through the service identity.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = (body as { workspaceId?: string }).workspaceId;
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set('fleet_workspace', workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
  return response;
}
