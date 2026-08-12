import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import Anthropic from '@anthropic-ai/sdk';

// ★2026-08-12: guncel kusak. Opus 5 ve Sonnet 5, oncekilerle AYNI fiyat basamaginda
// ($5/$25 ve $3/$15 per MTok) ama daha guclu. Eski adlar listede BIRAKILMADI —
// panelde secilebilir kalirlarsa operator farkinda olmadan eski modele duser.
const MODEL_MAP: Record<string, string> = {
  'Claude Opus 5': 'claude-opus-5',
  'Claude Sonnet 5': 'claude-sonnet-5',
  'Claude Haiku 4.5': 'claude-haiku-4-5'
};

const SYSTEM = `You are Fleet AI, the assistant inside a cloud-phone management platform called VPS Fleet.
You help operators manage Android cloud phones, proxies, automation tasks, and social-media accounts.
Be concise and practical. When asked how to do something in the platform, give clear step-by-step guidance.`;

// Oturum cookie'sinin (backend JWT) yapısal + süre geçerliliği. Edge dışı ama
// aynı ucuz kontrol: 3 parça + gelecekte exp. Gerçek yetki backend'de doğrulanır;
// burada amaç ANTHROPIC_API_KEY'e anonim/sınırsız erişimi kapatmak.
function isSessionValid(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

// Basit in-memory rate-limit: oturum başına dakikada 10 istek. Sabit pencere.
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (bucket.count >= RATE_LIMIT) return true;
  bucket.count += 1;
  return false;
}

export async function POST(request: Request) {
  // 1) Oturum zorunlu — yoksa/süresi dolmuşsa ANTHROPIC_API_KEY'e erişim yok.
  const session = (await cookies()).get('fleet_session')?.value;
  if (!isSessionValid(session)) {
    return NextResponse.json({ error: 'Oturum gerekli.' }, { status: 401 });
  }

  // 2) Rate-limit: oturum token'ı bazında (fallback IP). Fatura DoS'unu sınırla.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateKey = session ?? ip;
  if (rateLimited(rateKey)) {
    return NextResponse.json({ error: 'Çok fazla istek. Lütfen biraz bekleyin.' }, { status: 429 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Fleet AI is not configured. Set ANTHROPIC_API_KEY in apps/dashboard/.env to enable it.' },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    model?: string;
    history?: Array<{ role?: string; text?: string }>;
  };
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required.' }, { status: 400 });
  }

  const model = MODEL_MAP[body.model ?? ''] ?? 'claude-opus-5';
  const client = new Anthropic({ apiKey });

  // Carry prior turns so the assistant has conversation context. We sanitize the
  // client-supplied history (only user/assistant text turns) and cap it to the
  // last 20 turns to bound token cost. The current prompt is appended last.
  const history: Anthropic.MessageParam[] = (Array.isArray(body.history) ? body.history : [])
    .filter((m): m is { role: 'user' | 'assistant'; text: string } =>
      (m?.role === 'user' || m?.role === 'assistant') && typeof m?.text === 'string' && m.text.trim().length > 0)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.text }));

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [...history, { role: 'user', content: prompt }]
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return NextResponse.json({ data: { text, model } });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status ?? 500 : 500;
    const msg = err instanceof Error ? err.message : 'AI request failed.';
    return NextResponse.json({ error: msg }, { status });
  }
}
