import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import type { RpaStep } from '../rpa/rpa.service';
import { farmService } from '../farm/farm.service';

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

// ── Shared Anthropic forced-tool call ───────────────────────────────────────
// Calls the Messages API forcing a single tool and returns the parsed tool input.
// Same wire format / error handling as generateFlow above (no temperature, no
// budget_tokens — Opus 4.8 rejects them; 60s AbortController).
export async function callForcedTool(
  system: string,
  userContent: string,
  tool: { name: string; description: string; input_schema: unknown },
  maxTokens = 2048
): Promise<Record<string, unknown>> {
  if (!env.anthropicApiKey) {
    throw new AppError('AI yapılandırılmamış: ANTHROPIC_API_KEY eksik', 503, 'AI_NOT_CONFIGURED');
  }
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
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: userContent }]
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
  const toolUse = (body.content ?? []).find((b) => b.type === 'tool_use' && b.name === tool.name);
  if (!toolUse?.input || typeof toolUse.input !== 'object') {
    throw new AppError('AI geçerli bir yanıt üretemedi', 502, 'AI_BAD_OUTPUT');
  }
  return toolUse.input as Record<string, unknown>;
}

// ── Multi-tool ReAct caller (AI Device Agent) ───────────────────────────────
// Unlike callForcedTool (single forced tool, one-shot), this lets the model pick
// AMONG several tools each turn and accepts the full conversation so far, so the
// caller can drive a perceive→decide→act loop and feed tool_result blocks back.
// Same wire pattern: no temperature/budget_tokens (Opus 4.8 rejects them), 60s
// AbortController, x-api-key header.
export type AnthropicToolDef = { name: string; description: string; input_schema: unknown };
export type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown };
export type ToolTurnResult = {
  stopReason: string; // 'tool_use' | 'end_turn' | 'max_tokens' | ...
  text: string; // any assistant prose (the model's reasoning)
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  rawAssistantContent: unknown; // echo back verbatim as the assistant turn
};

// Attach a cache breakpoint to the LAST tool so the system+tools prefix is
// cached as one block (Anthropic caches everything up to the marked block).
function cacheLastTool(tools: AnthropicToolDef[]): unknown[] {
  return tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
  );
}

export async function callToolLoop(
  system: string,
  messages: AnthropicMessage[],
  tools: AnthropicToolDef[],
  maxTokens = 1024
): Promise<ToolTurnResult> {
  if (!env.anthropicApiKey) {
    throw new AppError('AI yapılandırılmamış: ANTHROPIC_API_KEY eksik', 503, 'AI_NOT_CONFIGURED');
  }
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
        max_tokens: maxTokens,
        // Mark the static prefix (system prompt + tool defs) as a cache breakpoint
        // so repeated turns of a ReAct loop reuse it instead of re-billing it.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: cacheLastTool(tools),
        tool_choice: { type: 'auto' },
        messages
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

  const body = (await res.json()) as {
    stop_reason?: string;
    content?: Array<{ type: string; name?: string; id?: string; input?: unknown; text?: string }>;
  };
  const content = body.content ?? [];
  const toolCalls = content
    .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({
      id: typeof b.id === 'string' ? b.id : '',
      name: String(b.name),
      input: b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {}
    }));
  const text = content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => String(b.text))
    .join('\n');
  return {
    stopReason: typeof body.stop_reason === 'string' ? body.stop_reason : 'end_turn',
    text,
    toolCalls,
    rawAssistantContent: content
  };
}

// ── AI Insights types ───────────────────────────────────────────────────────
export type InsightSeverity = 'low' | 'medium' | 'high';
export type InsightPriority = 'low' | 'medium' | 'high';
export type FleetInsights = {
  anomalies: Array<{ title: string; severity: InsightSeverity; description: string }>;
  recommendations: Array<{ action: string; priority: InsightPriority; reason: string }>;
  summary: string;
};

const REPORT_INSIGHTS_TOOL = {
  name: 'report_insights',
  description:
    'Report fleet health analysis: detected anomalies and prioritized, actionable recommendations for an Android cloud-phone + account-farming operator.',
  input_schema: {
    type: 'object',
    properties: {
      anomalies: {
        type: 'array',
        description: 'Notable anomalies or warning signs detected in the fleet signals.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short anomaly title' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            description: { type: 'string', description: 'What it is and why it matters' }
          },
          required: ['title', 'severity', 'description']
        }
      },
      recommendations: {
        type: 'array',
        description: 'Prioritized actions the operator should take.',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Concrete action to take' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            reason: { type: 'string', description: 'Why this action helps' }
          },
          required: ['action', 'priority', 'reason']
        }
      },
      summary: { type: 'string', description: 'One-paragraph overall fleet health summary' }
    },
    required: ['anomalies', 'recommendations', 'summary']
  }
} as const;

const INSIGHTS_SYSTEM = [
  'You are a fleet health analyst for an Android cloud-phone + social-account-farming platform.',
  'Given compact JSON signals about devices, farm accounts and recent jobs, surface real anomalies',
  'and a short list of prioritized, actionable recommendations.',
  'Rules:',
  '- Always call the report_insights tool; never answer in prose.',
  '- Ground every anomaly and recommendation in the provided numbers; do not invent data.',
  '- If signals look healthy, say so with low-severity anomalies and light recommendations.',
  '- You may write in Turkish (the operators are Turkish-speaking); English is fine too.'
].join('\n');

const SEVERITIES = new Set<InsightSeverity>(['low', 'medium', 'high']);
function coerceSeverity(v: unknown): InsightSeverity {
  return typeof v === 'string' && SEVERITIES.has(v as InsightSeverity) ? (v as InsightSeverity) : 'low';
}

// ── Fleet query (natural language → safe read-only query) ───────────────────
export type FleetQueryType =
  | 'top_unhealthy'
  | 'top_active'
  | 'paused_accounts'
  | 'offline_devices'
  | 'high_risk'
  | 'campaign_status';

const QUERY_TYPES = new Set<FleetQueryType>([
  'top_unhealthy',
  'top_active',
  'paused_accounts',
  'offline_devices',
  'high_risk',
  'campaign_status'
]);

const CLASSIFY_QUERY_TOOL = {
  name: 'classify_query',
  description:
    'Classify a natural-language fleet question into one of a fixed set of safe, read-only query intents and a result limit.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['top_unhealthy', 'top_active', 'paused_accounts', 'offline_devices', 'high_risk', 'campaign_status'],
        description:
          'top_unhealthy=lowest-health farm accounts; top_active=most active accounts; paused_accounts=paused accounts; offline_devices=offline/error devices; high_risk=highest ban-risk accounts; campaign_status=farm campaign overview.'
      },
      limit: { type: 'number', description: 'How many rows to return (1-50, default 10)' }
    },
    required: ['type']
  }
} as const;

const CLASSIFY_SYSTEM = [
  'You map an operator question about their Android cloud-phone / account-farming fleet',
  'to ONE of the fixed query intents and a row limit.',
  'Always call the classify_query tool; never answer in prose.',
  'Pick the closest intent even if the wording is loose.'
].join('\n');

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
  },

  // ── AI Insights ─────────────────────────────────────────────────────────
  // Gather compact fleet signals (farm summary/risk, device status counts,
  // 7-day job outcomes), ask Claude to surface anomalies + prioritized
  // recommendations via a forced tool, and return the parsed report.
  async generateInsights(workspaceId?: string): Promise<FleetInsights> {
    if (!env.anthropicApiKey) {
      throw new AppError('AI yapılandırılmamış: ANTHROPIC_API_KEY eksik', 503, 'AI_NOT_CONFIGURED');
    }
    const ws = workspaceId ? { workspaceId } : {};

    // Farm signals — reuse the farm module's summary + risk where available,
    // falling back to a direct aggregate if anything throws.
    let farm: unknown = null;
    try {
      farm = await farmService.getSummary(workspaceId);
    } catch {
      const accounts = await prisma.farmAccount.findMany({ where: ws, select: { healthScore: true, paused: true } });
      const total = accounts.length;
      farm = {
        accounts: {
          total,
          paused: accounts.filter((a) => a.paused).length,
          atRisk: accounts.filter((a) => a.healthScore < 50).length,
          avgHealth: total ? Math.round(accounts.reduce((s, a) => s + a.healthScore, 0) / total) : 0
        }
      };
    }

    let topRisk: Array<{ deviceName: string | null; score: number; band: string }> = [];
    try {
      const risk = await farmService.getRiskScores(workspaceId);
      topRisk = risk.slice(0, 5).map((r) => ({ deviceName: r.deviceName, score: r.score, band: r.band }));
    } catch {
      topRisk = [];
    }

    // Device status distribution.
    const deviceGroups = await prisma.device.groupBy({
      by: ['status'],
      where: ws,
      _count: { _all: true }
    }).catch(() => [] as Array<{ status: string; _count: { _all: number } }>);
    const devices: Record<string, number> = {};
    for (const g of deviceGroups as Array<{ status: string; _count: { _all: number } }>) {
      devices[g.status] = g._count._all;
    }

    // Last-7-day job outcomes.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [jobsCompleted, jobsFailed] = await Promise.all([
      prisma.job.count({ where: { ...ws, status: 'COMPLETED', createdAt: { gte: since } } }).catch(() => 0),
      prisma.job.count({ where: { ...ws, status: 'FAILED', createdAt: { gte: since } } }).catch(() => 0)
    ]);

    const context = {
      farm,
      topBanRisk: topRisk,
      devices,
      jobsLast7d: { completed: jobsCompleted, failed: jobsFailed }
    };

    const input = await callForcedTool(
      INSIGHTS_SYSTEM,
      'Analyze these fleet signals and report anomalies + prioritized recommendations:\n\n' +
        JSON.stringify(context, null, 2),
      REPORT_INSIGHTS_TOOL,
      2048
    );

    const anomaliesRaw = Array.isArray(input.anomalies) ? input.anomalies : [];
    const recsRaw = Array.isArray(input.recommendations) ? input.recommendations : [];
    return {
      anomalies: anomaliesRaw
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
        .map((a) => ({
          title: typeof a.title === 'string' ? a.title.slice(0, 160) : 'Anomali',
          severity: coerceSeverity(a.severity),
          description: typeof a.description === 'string' ? a.description.slice(0, 600) : ''
        })),
      recommendations: recsRaw
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
        .map((r) => ({
          action: typeof r.action === 'string' ? r.action.slice(0, 200) : 'Öneri',
          priority: coerceSeverity(r.priority),
          reason: typeof r.reason === 'string' ? r.reason.slice(0, 400) : ''
        })),
      summary: typeof input.summary === 'string' ? input.summary.slice(0, 1200) : ''
    };
  },

  // ── Natural-language fleet query ─────────────────────────────────────────
  // Classify the question into one safe read-only intent via a forced tool,
  // then run the corresponding workspace-scoped Prisma query.
  async queryFleet(
    workspaceId: string | undefined,
    query: string
  ): Promise<{ type: FleetQueryType; message: string; result: Array<Record<string, unknown>> }> {
    if (!env.anthropicApiKey) {
      throw new AppError('AI yapılandırılmamış: ANTHROPIC_API_KEY eksik', 503, 'AI_NOT_CONFIGURED');
    }
    const trimmed = query.trim();
    if (trimmed.length < 3) throw new AppError('Sorgu çok kısa', 400, 'EMPTY_QUERY');

    const input = await callForcedTool(CLASSIFY_SYSTEM, trimmed, CLASSIFY_QUERY_TOOL, 256);
    const type: FleetQueryType = QUERY_TYPES.has(input.type as FleetQueryType)
      ? (input.type as FleetQueryType)
      : 'campaign_status';
    const rawLimit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.round(input.limit) : 10;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const ws = workspaceId ? { workspaceId } : {};

    let result: Array<Record<string, unknown>> = [];
    let message = '';

    if (type === 'top_unhealthy') {
      const rows = await prisma.farmAccount.findMany({
        where: ws,
        orderBy: { healthScore: 'asc' },
        take: limit,
        include: { device: { select: { name: true } } }
      });
      result = rows.map((r) => ({
        device: r.device?.name ?? r.deviceId,
        healthScore: r.healthScore,
        warmupStage: r.warmupStage,
        paused: r.paused
      }));
      message = `En düşük sağlıklı ${result.length} hesap`;
    } else if (type === 'top_active') {
      const rows = await prisma.farmAccount.findMany({
        where: ws,
        orderBy: { totalActions: 'desc' },
        take: limit,
        include: { device: { select: { name: true } } }
      });
      result = rows.map((r) => ({
        device: r.device?.name ?? r.deviceId,
        totalActions: r.totalActions,
        actionsToday: r.actionsToday,
        healthScore: r.healthScore
      }));
      message = `En aktif ${result.length} hesap`;
    } else if (type === 'paused_accounts') {
      const rows = await prisma.farmAccount.findMany({
        where: { ...ws, paused: true },
        orderBy: { healthScore: 'asc' },
        take: limit,
        include: { device: { select: { name: true } } }
      });
      result = rows.map((r) => ({
        device: r.device?.name ?? r.deviceId,
        healthScore: r.healthScore,
        pausedReason: r.pausedReason
      }));
      message = `${result.length} duraklatılmış hesap`;
    } else if (type === 'offline_devices') {
      const rows = await prisma.device.findMany({
        where: { ...ws, status: { in: ['OFFLINE', 'ERROR'] } },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { name: true, status: true, updatedAt: true }
      });
      result = rows.map((r) => ({
        device: r.name,
        status: r.status,
        updatedAt: r.updatedAt.toISOString()
      }));
      message = `${result.length} çevrimdışı/hatalı cihaz`;
    } else if (type === 'high_risk') {
      const risk = await farmService.getRiskScores(workspaceId);
      result = risk.slice(0, limit).map((r) => ({
        device: r.deviceName ?? r.deviceId,
        riskScore: r.score,
        band: r.band,
        healthScore: r.healthScore,
        paused: r.paused
      }));
      message = `En yüksek ban riskli ${result.length} hesap`;
    } else {
      const rows = await prisma.farmCampaign.findMany({
        where: ws,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { name: true, status: true, runCount: true, lastRunAt: true, nextRunAt: true }
      });
      result = rows.map((r) => ({
        name: r.name,
        status: r.status,
        runCount: r.runCount,
        lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
        nextRunAt: r.nextRunAt ? r.nextRunAt.toISOString() : null
      }));
      message = `${result.length} kampanya`;
    }

    return { type, message, result };
  }
};
