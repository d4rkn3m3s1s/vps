import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('fleet_session')?.value;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Logged-in users shouldn't see the login page.
  if (session && pathname === '/login') {
    return NextResponse.redirect(new URL('/profiles', request.url));
  }

  // Gate everything else behind a session.
  if (!session && !isPublic) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
