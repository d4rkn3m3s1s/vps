import { NextResponse } from 'next/server';
import { apiCall } from '../../../../lib/apiClient';

// Sets the active workspace cookie. Server components + apiClient read this to
// scope all data to the chosen workspace. Membership is validated by attempting
// a real token switch through the service identity BEFORE writing the cookie —
// if the backend rejects the switch, we refuse and never persist the workspace.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = (body as { workspaceId?: string }).workspaceId;
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  // Gerçek üyelik kontrolü: backend'de switch dene. Başarısızsa cookie'yi YAZMA.
  const switched = await apiCall(`/workspaces/${encodeURIComponent(workspaceId)}/switch`, {
    method: 'POST',
    auth: true
  });
  if (!switched.ok) {
    return NextResponse.json(
      { error: 'Bu workspace\'e erişiminiz yok.' },
      { status: switched.status === 401 ? 401 : 403 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('fleet_workspace', workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
  return response;
}
