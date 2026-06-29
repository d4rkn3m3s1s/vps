import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const MODEL_MAP: Record<string, string> = {
  'Claude Opus 4.8': 'claude-opus-4-8',
  'Claude Sonnet 4.6': 'claude-sonnet-4-6',
  'Claude Haiku 4.5': 'claude-haiku-4-5'
};

const SYSTEM = `You are Fleet AI, the assistant inside a cloud-phone management platform called VPS Fleet.
You help operators manage Android cloud phones, proxies, automation tasks, and social-media accounts.
Be concise and practical. When asked how to do something in the platform, give clear step-by-step guidance.`;

export async function POST(request: Request) {
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

  const model = MODEL_MAP[body.model ?? ''] ?? 'claude-opus-4-8';
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
