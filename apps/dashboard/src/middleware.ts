import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/welcome', '/api/auth/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('fleet_session')?.value;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Logged-in users shouldn't see the login or marketing pages.
  if (session && (pathname === '/login' || pathname === '/welcome')) {
    return NextResponse.redirect(new URL('/profiles', request.url));
  }

  // Logged-out visitors land on the marketing page, not straight at the form.
  if (!session && !isPublic) {
    const target = new URL('/welcome', request.url);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
