import { NextResponse } from 'next/server';

// Server-side proxy for the "canlı API test" playground on the API-keys page.
// The browser posts { method, path, apiKey, body } here; we forward it to the
// real public API with the user's own x-api-key. Doing this server-side avoids
// CORS / mixed-content issues and keeps the exact same request the user would run
// with curl. We only allow the /public/* surface so this can't be turned into an
// open proxy.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export async function POST(request: Request) {
  const { method, path, apiKey, body } = await request.json().catch(() => ({}));

  if (typeof path !== 'string' || !path.startsWith('/public/')) {
    return NextResponse.json({ error: 'Yalnızca /public/* uçları test edilebilir' }, { status: 400 });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return NextResponse.json({ error: 'API anahtarı gerekli' }, { status: 400 });
  }
  const verb = (typeof method === 'string' ? method : 'GET').toUpperCase();

  try {
    const init: RequestInit = {
      method: verb,
      headers: {
        'x-api-key': apiKey.trim(),
        ...(verb !== 'GET' && body ? { 'content-type': 'application/json' } : {})
      },
      ...(verb !== 'GET' && body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000)
    };
    const res = await fetch(`${API_BASE}${path}`, init);
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    return NextResponse.json({ status: res.status, ok: res.ok, data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'İstek başarısız' }, { status: 502 });
  }
}
