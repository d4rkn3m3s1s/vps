import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/welcome', '/api/auth/login'];

// Hafif oturum doğrulaması (Edge runtime).
// fleet_session backend'in JWT access token'ıdır. Edge'de JWT secret'ı olmadan
// imza doğrulaması yapmak yerine (over-engineering) token'ın yapısal geçerliliğini
// ve süresini kontrol ederiz: 3 parçalı JWT + exp claim'i gelecekte mi. Gerçek
// yetki her API çağrısında backend tarafından zaten doğrulanıyor; bu kontrol
// sadece salt-varlık kontrolünün yerine geçen ucuz ve etkili bir ön kapıdır.
function isSessionValid(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    // base64url payload decode (atob Edge'de mevcut).
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    // exp saniye cinsinden; süresi geçmişse geçersiz.
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rawSession = request.cookies.get('fleet_session')?.value;
  const session = isSessionValid(rawSession);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Logged-in users shouldn't see the login or marketing pages.
  if (session && (pathname === '/login' || pathname === '/welcome')) {
    return NextResponse.redirect(new URL('/profiles', request.url));
  }

  // Logged-out (veya geçersiz/süresi dolmuş oturum) ziyaretçiler marketing
  // sayfasına gider. Geçersiz cookie'yi de temizle ki döngüye girmesin.
  if (!session && !isPublic) {
    const target = new URL('/welcome', request.url);
    const res = NextResponse.redirect(target);
    if (rawSession) res.cookies.set('fleet_session', '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
