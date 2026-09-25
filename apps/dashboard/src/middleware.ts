import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/welcome', '/api/auth/login'];

// Oturum doğrulaması (Edge runtime).
//
// ★2026-09-26 GÜVENLİK: fleet_session backend'in HS256 JWT access token'ıdır ve artık
// İMZASI doğrulanır (JWT_ACCESS_SECRET, backend ile aynı anahtar). Panelin /api/*
// rotaları backend'e kullanıcının token'ıyla DEĞİL servis kimliğiyle gider; bu yüzden
// panel tarafındaki bu kapı tek yetki kontrolüdür ve yalnız yapı/süre kontrolü yetmez.
// Anahtar tanımlı değilse hiçbir oturum kabul edilmez (fail-closed).
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? '';

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return keyPromise;
}

async function isSessionValid(token: string | undefined): Promise<boolean> {
  if (!token || !JWT_SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as { alg?: string };
    if (header.alg !== 'HS256') return false;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as { exp?: number; typ?: string };
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return false;
    if (payload.typ && payload.typ !== 'access') return false;
    return true;
  } catch {
    return false;
  }
}

// Ters-proxy (Caddy → 127.0.0.1:3000) arkasında `request.url` iç dinleme
// adresini (http://localhost:3000) taşır — Host başlığından bağımsız olarak.
// `new URL('/x', request.url)` bu yüzden `http://localhost:3000/x` üretir ve
// tarayıcı bu MUTLAK Location'ı takip edince operatörün kendi localhost'una
// gider (ERR_CONNECTION_RESET). Düzeltme: redirect hedefini, gelen isteğin
// gerçek dış host'undan (X-Forwarded-Host / Host başlığı) kur. Böylece Location
// dışarıdan doğru host'a (125.253.73.45) işaret eder.
function externalUrl(request: NextRequest, path: string): URL {
  const url = new URL(request.url);
  const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (fwdHost) {
    // `url.host` atarken önce portu temizle: fwdHost porsuz (ör. "125.253.73.45")
    // gelirse url'in eski iç portu (:3000) korunur ve Location dışarıya kapalı
    // 3000'e işaret eder. Önce port'u sıfırla, sonra host'u ata — fwdHost kendi
    // portunu taşıyorsa (ör. "host:8443") o zaten host içinde gelir.
    url.port = '';
    url.host = fwdHost;
  }
  const fwdProto = request.headers.get('x-forwarded-proto');
  if (fwdProto) url.protocol = `${fwdProto}:`;
  url.pathname = path;
  url.search = '';
  return url;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rawSession = request.cookies.get('fleet_session')?.value;
  const session = await isSessionValid(rawSession);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Logged-in users shouldn't see the login or marketing pages.
  if (session && (pathname === '/login' || pathname === '/welcome')) {
    return NextResponse.redirect(externalUrl(request, '/profiles'));
  }

  // Logged-out (veya geçersiz/süresi dolmuş oturum) ziyaretçiler marketing
  // sayfasına gider. Geçersiz cookie'yi de temizle ki döngüye girmesin.
  if (!session && !isPublic) {
    // ★2026-07-29: API yollarına REDIRECT DÖNME — JSON 401 dön.
    //
    // Bir fetch() varsayılan olarak yönlendirmeyi TAKİP EDER: /api/ws-token için
    // dönen 307 → /welcome zincirinin sonunda tarayıcı 200 + HTML görür, yani
    // `res.ok` TRUE olur. Çağıran kod cevabı başarılı sanıp `res.json()` çağırır,
    // HTML parse edilemeyince catch'e düşer ve (live.tsx'te olduğu gibi) TOKENSİZ
    // WebSocket açmaya çalışır — API bunu reddeder, bağlantı sonsuza kadar
    // kopuk kalır ve kendi kendine ASLA düzelmez (canlı olarak yaşandı).
    // JSON 401 ile çağıran net bir hata görür ve doğru dalda çalışır.
    if (pathname.startsWith('/api/')) {
      const res = NextResponse.json(
        { error: 'UNAUTHENTICATED', message: 'Oturum geçersiz veya süresi dolmuş.' },
        { status: 401 }
      );
      if (rawSession) res.cookies.set('fleet_session', '', { httpOnly: true, path: '/', maxAge: 0 });
      return res;
    }
    const target = externalUrl(request, '/welcome');
    const res = NextResponse.redirect(target);
    if (rawSession) res.cookies.set('fleet_session', '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next internals and PUBLIC static assets. Self-hosted
  // fonts under /fonts (and other static files by extension) must be exempt —
  // otherwise a logged-out request for a .woff2 gets redirected to /welcome (307)
  // and the display face never loads, so headings silently fall back to the
  // system font. Excluding `fonts/` + common asset extensions keeps them public.
  // The public Postman collection (API schema, no secrets) is exempted by name so
  // the "İndir" button on /api-docs downloads the file instead of login HTML.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|fleet-whatsapp-api\\.postman_collection\\.json|.*\\.(?:woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$).*)']
};
