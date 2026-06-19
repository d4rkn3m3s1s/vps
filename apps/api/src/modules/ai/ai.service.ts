import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import type { RpaStep } from '../rpa/rpa.service';

// ── AI-driven automation: natural language → RPA flow ───────────────────────
//
// Calls the Anthropic Messages API with a single forced tool whose schema IS
// our RPA step list, so the model returns validated, ready-to-run steps instead
// of prose we'd have to parse. We hit the REST endpoint directly with fetch —
// the codebase favors zero-dependency integrations (host agent, webhooks) and
// the Messages API is stable.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// The tool the model must call. Its input_schema mirrors RpaStep exactly so a
// successful tool call is already a valid flow draft.
const BUILD_FLOW_TOOL = {
  name: 'build_rpa_flow',
  description:
    'Return a mobile automation (RPA) flow as an ordered list of steps that run on an Android cloud phone via ADB input. Use realistic screen coordinates for a 1080x1920 portrait device.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short flow name' },
      description: { type: 'string', description: 'One-line summary of what the flow does' },
      steps: {
        type: 'array',
        description: 'Ordered automation steps',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['tap', 'type', 'wait', 'swipe', 'openApp', 'shell', 'keyevent'] },
            x: { type: 'number', description: 'tap/swipe start X (px)' },
            y: { type: 'number', description: 'tap/swipe start Y (px)' },
            x2: { type: 'number', description: 'swipe end X (px)' },
            y2: { type: 'number', description: 'swipe end Y (px)' },
            text: { type: 'string', description: 'text to type' },
            ms: { type: 'number', description: 'milliseconds to wait' },
            packageName: { type: 'string', description: 'app package for openApp, e.g. com.instagram.android' },
            command: { type: 'string', description: 'raw adb shell command' },
            keycode: { type: 'number', description: 'Android keyevent code, e.g. 4=back, 3=home, 66=enter' }
          },
          required: ['type']
        }
      }
    },
    required: ['name', 'steps']
  }
} as const;

const SYSTEM_PROMPT = [
  'You are an automation engineer for an Android cloud-phone fleet.',
  'You translate a human description of a phone task into a precise RPA flow.',
  'Rules:',
  '- Always call the build_rpa_flow tool; never answer in prose.',
  '- Assume a 1080x1920 portrait screen; place taps on plausible UI locations.',
  '- Open the relevant app first with an openApp step when the task names an app.',
  '- Insert short wait steps (800–2500 ms) after launches and navigation so the UI settles.',
  '- Prefer tap/type/swipe/keyevent over raw shell unless shell is clearly required.',
  '- Keep flows humanized and minimal: do only what was asked.'
].join('\n');

const ALLOWED = new Set(['tap', 'type', 'wait', 'swipe', 'openApp', 'shell', 'keyevent']);

// Coerce one model-produced step into a clean RpaStep, dropping fields that
// don't apply to its type. Returns null for an unusable step.
function sanitizeStep(raw: unknown): RpaStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = String(r.type);
  if (!ALLOWED.has(type)) return null;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const step: RpaStep = { type: type as RpaStep['type'] };
  if (type === 'tap') { step.x = num(r.x) ?? 540; step.y = num(r.y) ?? 960; }
  else if (type === 'swipe') { step.x = num(r.x) ?? 540; step.y = num(r.y) ?? 1400; step.x2 = num(r.x2) ?? 540; step.y2 = num(r.y2) ?? 600; }
  else if (type === 'type') { step.text = typeof r.text === 'string' ? r.text : ''; }
  else if (type === 'wait') { step.ms = num(r.ms) ?? 1000; }
  else if (type === 'openApp') { if (typeof r.packageName !== 'string' || !r.packageName) return null; step.packageName = r.packageName; }
  else if (type === 'shell') { if (typeof r.command !== 'string' || !r.command) return null; step.command = r.command; }
  else if (type === 'keyevent') { step.keycode = num(r.keycode) ?? 4; }
  return step;
}

export type GeneratedFlow = { name: string; description: string; steps: RpaStep[] };

export const aiService = {
  configured(): boolean {
    return Boolean(env.anthropicApiKey);
  },

  // Generate a flow draft from a natural-language prompt. Does not persist; the
  // dashboard shows the draft for review before saving via the RPA module.
  async generateFlow(prompt: string): Promise<GeneratedFlow> {
    if (!env.anthropicApiKey) {
      throw new AppError('AI yapılandırılmamış: ANTHROPIC_API_KEY eksik', 503, 'AI_NOT_CONFIGURED');
    }
    const trimmed = prompt.trim();
    if (!trimmed) throw new AppError('Komut boş olamaz', 400, 'EMPTY_PROMPT');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.anthropicApiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify({
          model: env.anthropicModel,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: [BUILD_FLOW_TOOL],
          tool_choice: { type: 'tool', name: 'build_rpa_flow' },
          messages: [{ role: 'user', content: trimmed }]
        })
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === 'AbortError') throw new AppError('AI isteği zaman aşımına uğradı', 504, 'AI_TIMEOUT');
      throw new AppError('AI servisine ulaşılamadı', 502, 'AI_UNREACHABLE');
    }
    clearTimeout(timer);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AppError(`AI hatası (${res.status})`, 502, 'AI_ERROR', detail.slice(0, 300));
    }

    const body = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
    // Forced tool_choice guarantees a tool_use block; find it and validate.
    const toolUse = (body.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'build_rpa_flow');
    if (!toolUse?.input || typeof toolUse.input !== 'object') {
      throw new AppError('AI geçerli bir akış üretemedi', 502, 'AI_BAD_OUTPUT');
    }
    const out = toolUse.input as { name?: unknown; description?: unknown; steps?: unknown };
    const steps = Array.isArray(out.steps) ? out.steps.map(sanitizeStep).filter((s): s is RpaStep => s !== null) : [];
    if (steps.length === 0) throw new AppError('AI çalıştırılabilir adım üretemedi', 502, 'AI_NO_STEPS');

    return {
      name: typeof out.name === 'string' && out.name.trim() ? out.name.trim().slice(0, 80) : 'AI akışı',
      description: typeof out.description === 'string' ? out.description.slice(0, 200) : '',
      steps
    };
  }
};
