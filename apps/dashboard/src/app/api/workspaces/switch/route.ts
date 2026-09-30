import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_KEY = process.env.DEFAULT_API_KEY ?? '';

// Sets the active workspace cookie. Server components + apiClient read this to
// scope all data to the chosen workspace.
//
// ★2026-10-01 GÜVENLİK: üyelik eskiden SERVİS kimliğiyle (panelin admin hesabı) doğrulanıyordu
// → admin her workspace'e geçebildiği için kontrol HER ZAMAN geçiyordu ve herhangi bir panel
// kullanıcısı başka bir kiracının verisine geçebiliyordu. Artık KULLANICININ KENDİ oturum
// token'ıyla (fleet_session) backend'de switch denenir: backend üyeliği gerçekten doğrular.
// Başarılıysa dönen yeni token (o workspace'e + oradaki role kapsamlı) oturum çerezine yazılır,
// böylece middleware'in rol kontrolü de doğru workspace rolünü görür.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = (body as { workspaceId?: string }).workspaceId;
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  const session = (await cookies()).get('fleet_session')?.value;
  if (!session) return NextResponse.json({ error: 'Oturum yok' }, { status: 401 });

  const res = await fetch(`${BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/switch`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, Authorization: `Bearer ${session}` }
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: 'Bu workspace\'e erişiminiz yok.' },
      { status: res.status === 401 ? 401 : 403 }
    );
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string } };

  const response = NextResponse.json({ ok: true });
  response.cookies.set('fleet_workspace', workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
  if (json.data?.accessToken) {
    // Login rotasıyla aynı çerez ayarları (token ömrünün altında).
    response.cookies.set('fleet_session', json.data.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 2 - 300
    });
  }
  return response;
}
