import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createJobRecord } from '../jobs/jobs.service';
import { streamHub } from '../stream/stream.hub';
import type { AgentAction, AgentReply } from '../stream/stream.hub';
import { aiService, callToolLoop } from '../ai/ai.service';
import type { AnthropicMessage, AnthropicToolDef } from '../ai/ai.service';
import { rpaService, type RpaStep } from '../rpa/rpa.service';

// ── AI Device Agent ─────────────────────────────────────────────────────────
//
// Claude autonomously drives an Android phone toward a natural-language goal in
// a perceive→decide→act loop. The loop runs HERE (control plane) so the
// Anthropic key never leaves the API; perception (screen dump) and action (tap/
// swipe/type) happen on the host agent over the existing /ws/agent-stream WS, so
// each turn is a sub-second round-trip rather than a slow job-queue cycle.
//
// The BFS app-explorer is the exception: it's a long, LLM-free local crawl, so
// it runs as a classic APP_EXPLORE job on the host and writes back an AppMap.

const MAX_TURNS_DEFAULT = 15;

// The action space exposed to Claude. The model picks ONE tool per turn; `done`
// terminates the loop. Stealth is a per-run flag, not a tool, so the space stays
// small.
const AGENT_TOOLS: AnthropicToolDef[] = [
  {
    name: 'tap_element',
    description: 'Tap the element with the given [idx] from the current screen tree. Prefer this over raw tap.',
    input_schema: { type: 'object', properties: { idx: { type: 'number', description: 'Element index from the screen tree' } }, required: ['idx'] }
  },
  {
    name: 'tap',
    description: 'Tap absolute screen coordinates (fallback when no suitable element index exists).',
    input_schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }
  },
  {
    name: 'tap_grid',
    description: 'Blind-tap a grid cell when the screen has NO inspectable elements (game/canvas/WebView). Grid is rows×cols (default 3×3); row/col are 0-indexed from top-left.',
    input_schema: {
      type: 'object',
      properties: {
        row: { type: 'number', description: '0-indexed row from top' },
        col: { type: 'number', description: '0-indexed column from left' },
        rows: { type: 'number', description: 'grid rows (default 3)' },
        cols: { type: 'number', description: 'grid cols (default 3)' }
      },
      required: ['row', 'col']
    }
  },
  {
    name: 'swipe',
    description: 'Swipe in a direction (up/down/left/right) or between explicit coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }
      }
    }
  },
  {
    name: 'type_text',
    description: 'Type text into the currently focused input field.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
  },
  {
    name: 'press_key',
    description: 'Press an Android key (keycode). 4=back, 3=home, 66=enter, 187=recents.',
    input_schema: { type: 'object', properties: { keycode: { type: 'number' } }, required: ['keycode'] }
  },
  {
    name: 'launch_app',
    description: 'Launch an app by package name, e.g. com.instagram.android.',
    input_schema: { type: 'object', properties: { packageName: { type: 'string' } }, required: ['packageName'] }
  },
  {
    name: 'wait',
    description: 'Wait for the UI to settle (milliseconds).',
    input_schema: { type: 'object', properties: { ms: { type: 'number' } }, required: ['ms'] }
  },
  {
    name: 'done',
    description: 'Finish the run. Call this when the goal is achieved OR when it is impossible to proceed.',
    input_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the goal was achieved' },
        summary: { type: 'string', description: 'Short summary of what happened' }
      },
      required: ['success', 'summary']
    }
  }
];

const AGENT_SYSTEM = [
  'You control a real Android phone to accomplish a goal given by an operator.',
  'Each turn you are shown a compact screen tree: lines like `[idx] Class "label" [clickable] [x1,y1,x2,y2]`.',
  'When a screenshot is also provided, use it to ground ambiguous elements; the [idx] indices still come from the screen tree.',
  'Rules:',
  '- Call exactly ONE action tool per turn.',
  '- Prefer tap_element(idx) using the indices in the screen tree; use tap(x,y) only as a fallback.',
  '- If the screen reports NO inspectable elements (game/canvas), use tap_grid(row,col) on a 3x3 grid.',
  '- After each action you receive the NEW screen tree — verify the result before the next step.',
  '- If a result says the screen DID NOT CHANGE, do NOT repeat the same tap — try a different element, or scroll (swipe) to reveal more, or press_key(4) to go back.',
  '- The target may be OFF-SCREEN. If you cannot find an expected element, swipe up/down to scroll before giving up.',
  '- Open the relevant app first (launch_app) when the goal names an app, then wait for it to load.',
  '- Self-correct: if two attempts at the same approach fail, change strategy entirely (different element, scroll, back, or a different screen path).',
  '- Call done(success, summary) as soon as the goal is met, or if you are genuinely stuck/blocked (set success=false) — do NOT loop forever.',
  '- Be efficient and humanized; do only what the goal asks. Never invent steps the goal did not request.',
  '- You may reason briefly in Turkish or English.'
].join('\n');

// A compact signature of an action, used to detect the model repeating itself.
function actionSignature(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'tap_element': return `tap_element:${input.idx}`;
    case 'tap': return `tap:${input.x},${input.y}`;
    case 'tap_grid': return `tap_grid:${input.row},${input.col}`;
    case 'swipe': return `swipe:${input.direction ?? `${input.x},${input.y}->${input.x2},${input.y2}`}`;
    case 'type_text': return `type:${String(input.text ?? '').slice(0, 24)}`;
    case 'press_key': return `key:${input.keycode}`;
    case 'launch_app': return `launch:${input.packageName}`;
    case 'wait': return `wait:${input.ms}`;
    default: return name;
  }
}

// Build a Claude user-message content array: the text plus an optional image
// block (vision). PNG base64 from the host agent.
function userContent(text: string, shot?: string): unknown {
  if (!shot) return text;
  return [
    { type: 'text', text },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot } }
  ];
}

// Vision runs accumulate a base64 screenshot every turn — that balloons the
// request size + cost. Keep only the screenshots from the last `keepLast` turns;
// older image blocks are replaced with a tiny text placeholder so the model still
// sees the action history (text trees) without re-paying for stale pixels.
function pruneOldImages(messages: AnthropicMessage[], keepLast = 3): void {
  // Indices of user messages that currently carry an image block.
  const imageMsgIdx: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user' && Array.isArray(m.content) && (m.content as Array<{ type?: string }>).some((b) => b?.type === 'image')) {
      imageMsgIdx.push(i);
    }
  });
  const dropBefore = imageMsgIdx.length - keepLast;
  if (dropBefore <= 0) return;
  for (let k = 0; k < dropBefore; k++) {
    const i = imageMsgIdx[k]!;
    const blocks = messages[i]!.content as Array<{ type?: string }>;
    messages[i]!.content = blocks
      .filter((b) => b?.type !== 'image')
      .concat([{ type: 'text', text: '[önceki ekran görüntüsü bağlamı kısaltıldı]' } as { type?: string }]);
  }
}

// Map a Claude tool call to the canonical AgentAction sent over WS.
function toAction(name: string, input: Record<string, unknown>): AgentAction {
  return { name: name as AgentAction['name'], input };
}

// Parse a buildScreenTree line `[idx] Class "label" [clickable] [x1,y1,x2,y2]`
// to extract the center coords for a given idx (for RPA conversion). Returns the
// node's {x,y,label} or null if the idx isn't present.
function boundsForIdx(screenTree: string, idx: number): { x: number; y: number; label: string } | null {
  const lines = screenTree.split('\n');
  for (const line of lines) {
    const m = line.match(/^\[(\d+)\]\s+\S+\s+"([^"]*)".*\[(\d+),(\d+),(\d+),(\d+)\]\s*$/);
    if (!m) continue;
    if (Number(m[1]) !== idx) continue;
    const x1 = Number(m[3]); const y1 = Number(m[4]); const x2 = Number(m[5]); const y2 = Number(m[6]);
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), label: m[2] ?? '' };
  }
  return null;
}

// Convert one recorded agent step (toolCall + the screen it acted on) into RPA
// steps. A successful agent run becomes a deterministic, LLM-free RPA flow.
function stepToRpa(screenTree: string, name: string, input: Record<string, unknown>): RpaStep[] {
  switch (name) {
    case 'tap_element': {
      const hit = boundsForIdx(screenTree, Number(input.idx));
      // Prefer a text locator (resilient to coord drift) with a coord fallback.
      if (hit) {
        if (hit.label) return [{ type: 'tapText', query: hit.label, x: hit.x, y: hit.y }];
        return [{ type: 'tap', x: hit.x, y: hit.y }];
      }
      return [];
    }
    case 'tap':
      return [{ type: 'tap', x: Number(input.x) || 0, y: Number(input.y) || 0 }];
    case 'swipe': {
      // Direction-based swipes resolve at runtime; emit explicit coords if given,
      // else a sensible default vertical swipe.
      if (typeof input.x === 'number' && typeof input.y === 'number' && typeof input.x2 === 'number' && typeof input.y2 === 'number') {
        return [{ type: 'swipe', x: input.x as number, y: input.y as number, x2: input.x2 as number, y2: input.y2 as number }];
      }
      const dir = String(input.direction || 'up');
      const map: Record<string, RpaStep> = {
        up: { type: 'swipe', x: 540, y: 1400, x2: 540, y2: 600 },
        down: { type: 'swipe', x: 540, y: 600, x2: 540, y2: 1400 },
        left: { type: 'swipe', x: 800, y: 960, x2: 200, y2: 960 },
        right: { type: 'swipe', x: 200, y: 960, x2: 800, y2: 960 }
      };
      return [map[dir] ?? map.up!];
    }
    case 'type_text':
      return [{ type: 'type', text: String(input.text ?? '') }];
    case 'press_key':
      return [{ type: 'keyevent', keycode: Number(input.keycode) || 4 }];
    case 'launch_app':
      return [{ type: 'openApp', packageName: String(input.packageName ?? '') }];
    case 'wait':
      return [{ type: 'wait', ms: Number(input.ms) || 1000 }];
    default:
      return [];
  }
}

export const deviceAgentService = {
  configured(): boolean {
    return aiService.configured();
  },

  // Create the run row and kick off the loop in the background; return the id so
  // the dashboard can poll. The HTTP request does NOT block on the whole run.
  async startRun(input: {
    workspaceId?: string;
    userId?: string;
    deviceId: string;
    goal: string;
    maxTurns?: number;
    stealth?: boolean;
    useVision?: boolean;
  }): Promise<{ runId: string }> {
    if (!aiService.configured()) {
      throw new AppError('AI yapılandırılmamış: ANTHROPIC_API_KEY eksik', 503, 'AI_NOT_CONFIGURED');
    }
    const device = await prisma.device.findFirst({
      where: { id: input.deviceId, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) },
      select: { id: true, hostId: true }
    });
    if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    if (!device.hostId || !streamHub.isAgentConnected(device.hostId)) {
      throw new AppError('Cihaz ajanı çevrimdışı — canlı sürüş için agent bağlı olmalı', 409, 'AGENT_OFFLINE');
    }

    const run = await prisma.agentRun.create({
      data: {
        goal: input.goal,
        deviceId: input.deviceId,
        status: 'RUNNING',
        maxTurns: input.maxTurns ?? MAX_TURNS_DEFAULT,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.stealth ? { stealth: true } : {}),
        ...(input.useVision ? { useVision: true } : {})
      },
      select: { id: true }
    });

    // Fire-and-forget; failures are caught and recorded on the run row.
    void this.driveRun(run.id).catch((err: unknown) => {
      logger.error('[device-agent] run failed', { runId: run.id, error: (err as Error).message });
      return this.finalize(run.id, 'FAILED', { success: false, error: (err as Error).message });
    });

    return { runId: run.id };
  },

  // The perceive→decide→act loop. Runs detached from the HTTP request.
  async driveRun(runId: string): Promise<void> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const device = await prisma.device.findUnique({
      where: { id: run.deviceId },
      select: { hostId: true, ipAddress: true, adbPort: true }
    });
    if (!device) {
      await this.finalize(runId, 'FAILED', { success: false, error: 'device not found' });
      return;
    }
    const hostId = device.hostId;
    const serial = device.ipAddress && device.adbPort ? `${device.ipAddress}:${device.adbPort}` : null;
    const stealth = run.stealth;
    const vision = run.useVision;
    const maxTurns = run.maxTurns;

    // Initial perception.
    let dump: AgentReply;
    try {
      dump = await streamHub.requestFromAgent(hostId, { type: 'agent.dump', deviceId: run.deviceId, serial, ...(vision ? { wantShot: true } : {}) });
    } catch (err) {
      await this.finalize(runId, 'FAILED', { success: false, error: `ilk ekran alınamadı: ${(err as Error).message}` });
      return;
    }

    const messages: AnthropicMessage[] = [
      { role: 'user', content: userContent(`HEDEF: ${run.goal}\n\nGEÇERLİ EKRAN:\n${dump.tree}`, vision ? dump.shot : undefined) }
    ];

    // Loop-trap guards: recent action signatures (to catch the model repeating
    // the same action) and a counter of consecutive turns with no screen change.
    const recentSignatures: string[] = [];
    let noChangeStreak = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      // Check for an external cancel between turns.
      const fresh = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (!fresh || fresh.status === 'CANCELLED') return;

      // Drop stale screenshots before the call so a long vision run doesn't
      // re-send every past frame (keeps cost/latency bounded).
      if (vision) pruneOldImages(messages, 3);

      let result;
      try {
        result = await callToolLoop(AGENT_SYSTEM, messages, AGENT_TOOLS, 1024);
      } catch (err) {
        await this.finalize(runId, 'FAILED', { success: false, error: `AI hatası: ${(err as Error).message}` });
        return;
      }
      messages.push({ role: 'assistant', content: result.rawAssistantContent });

      // No tool call → model stalled (answered in prose). Nudge once, then fail.
      if (result.toolCalls.length === 0) {
        messages.push({ role: 'user', content: 'Lütfen bir eylem aracı çağır (tap_element/tap/.../done).' });
        await this.recordStep(runId, turn, dump.tree, [{ name: 'none', input: {} }], { ok: false, error: 'no tool call' }, vision ? dump.shot : undefined);
        continue;
      }

      const call = result.toolCalls[0]!;

      // Loop breaker: if the model picks the exact same action 3 times in a row
      // (excluding done/wait), it's stuck — inject a hard nudge to change tactics
      // instead of letting it burn turns. After a 4th identical pick, abort.
      if (call.name !== 'done' && call.name !== 'wait') {
        const sig = actionSignature(call.name, call.input);
        recentSignatures.push(sig);
        if (recentSignatures.length > 4) recentSignatures.shift();
        const repeats = recentSignatures.filter((s) => s === sig).length;
        if (repeats >= 4) {
          await this.recordStep(runId, turn, dump.tree, [{ name: call.name, input: call.input }], { ok: false, error: 'repeated action loop' }, vision ? dump.shot : undefined);
          await this.finalize(runId, 'FAILED', { success: false, summary: 'Aynı eylem döngüye girdi — farklı bir yaklaşım bulunamadı.', turnsUsed: turn + 1 });
          return;
        }
        if (repeats === 3) {
          // The assistant message (with this tool_use) was already pushed above;
          // the API requires a tool_result for it, so reply via tool_result.
          await this.recordStep(runId, turn, dump.tree, [{ name: call.name, input: call.input }], { ok: false, error: 'repeated action — strategy change requested' }, vision ? dump.shot : undefined);
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: call.id,
              content: 'Bu eylemi 3 kez denedin ve işe yaramadı. AYNI eylemi TEKRAR ETME. Tamamen farklı bir öğe seç, kaydır (swipe) veya geri (press_key 4) git. Hâlâ ilerleyemiyorsan done(success=false) çağır.'
            }]
          });
          continue;
        }
      }

      if (call.name === 'done') {
        const success = Boolean(call.input.success);
        const summary = typeof call.input.summary === 'string' ? call.input.summary : '';
        await this.recordStep(runId, turn, dump.tree, [{ name: 'done', input: call.input }], { ok: true }, vision ? dump.shot : undefined);
        await this.finalize(runId, success ? 'SUCCEEDED' : 'FAILED', { success, ...(summary ? { summary } : {}), turnsUsed: turn + 1 });
        return;
      }

      // Execute the action on the device; the agent re-dumps and returns the
      // fresh tree, which we feed back as the tool_result (auto-append technique).
      let actionReply: AgentReply;
      try {
        actionReply = await streamHub.requestFromAgent(hostId, {
          type: 'agent.action',
          deviceId: run.deviceId,
          serial,
          action: toAction(call.name, call.input),
          ...(stealth ? { stealth: true } : {}),
          ...(vision ? { wantShot: true } : {})
        });
      } catch (err) {
        await this.finalize(runId, 'FAILED', { success: false, error: `eylem gönderilemedi: ${(err as Error).message}`, turnsUsed: turn + 1 });
        return;
      }

      // Record the step with the screen the model SAW this turn (dump), not the post-action one.
      await this.recordStep(runId, turn, dump.tree, [{ name: call.name, input: call.input }], {
        ok: actionReply.ok,
        ...(actionReply.error ? { error: actionReply.error } : {})
      }, vision ? dump.shot : undefined);

      // Reflection: if the screen tree is identical to what the model just acted
      // on, the action had no visible effect — tell the model so it tries a
      // different element instead of repeating the same tap (a common loop trap).
      const unchanged =
        ['tap_element', 'tap', 'tap_grid', 'swipe'].includes(call.name) &&
        actionReply.ok &&
        actionReply.tree.trim().length > 0 &&
        actionReply.tree.trim() === dump.tree.trim();
      // Track how many turns in a row produced no visible change. After several,
      // the run is wedged — abort gracefully rather than burning the turn budget.
      if (unchanged) noChangeStreak += 1; else noChangeStreak = 0;
      if (noChangeStreak >= 4) {
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: call.id, content: 'Ekran 4 turdur değişmiyor — cihaz takıldı.' }]
        });
        await this.finalize(runId, 'FAILED', { success: false, summary: 'Ekran birden fazla turda değişmedi — ilerleme sağlanamadı.', turnsUsed: turn + 1 });
        return;
      }
      const reflectionNote = unchanged
        ? `\n\nUYARI: Ekran bu eylemden sonra DEĞİŞMEDİ (${noChangeStreak}. kez). Aynı eylemi tekrarlama — farklı bir öğe seç, kaydır veya geri git. ${noChangeStreak >= 2 ? 'İlerleyemiyorsan done(success=false) çağır.' : ''}`
        : '';

      const toolResultText = (actionReply.ok
        ? `Eylem tamam.\nYENİ EKRAN:\n${actionReply.tree}`
        : `Eylem BAŞARISIZ: ${actionReply.error ?? 'bilinmeyen hata'}\nEKRAN:\n${actionReply.tree}`) + reflectionNote;
      // Vision: attach the fresh post-action screenshot so the model SEES the result.
      messages.push({
        role: 'user',
        content: vision && actionReply.shot
          ? [
              { type: 'tool_result', tool_use_id: call.id, content: toolResultText },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: actionReply.shot } }
            ]
          : [{ type: 'tool_result', tool_use_id: call.id, content: toolResultText }]
      });
      // The next turn's "screen before" is this fresh tree + shot.
      dump = { ok: actionReply.ok, tree: actionReply.tree, ...(actionReply.shot ? { shot: actionReply.shot } : {}) };
    }

    // Ran out of turns.
    await this.finalize(runId, 'FAILED', { success: false, summary: 'Maksimum tur sayısına ulaşıldı', turnsUsed: maxTurns });
  },

  async recordStep(
    runId: string,
    index: number,
    screenTree: string,
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
    result: { ok: boolean; error?: string },
    screenshot?: string
  ): Promise<void> {
    await prisma.agentRunStep.create({
      data: {
        runId,
        index,
        screenTree,
        ...(screenshot ? { screenshot } : {}),
        toolCalls: toolCalls as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue
      }
    }).catch(() => undefined);
  },

  async finalize(
    runId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    extra: { success?: boolean; summary?: string; error?: string; turnsUsed?: number }
  ): Promise<void> {
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        ...(extra.success !== undefined ? { success: extra.success } : {}),
        ...(extra.summary !== undefined ? { summary: extra.summary } : {}),
        ...(extra.error !== undefined ? { error: extra.error } : {}),
        ...(extra.turnsUsed !== undefined ? { turnsUsed: extra.turnsUsed } : {})
      }
    }).catch(() => undefined);
  },

  async getRun(workspaceId: string | undefined, id: string) {
    const run = await prisma.agentRun.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      include: { steps: { orderBy: { index: 'asc' } }, device: { select: { name: true } } }
    });
    if (!run) throw new AppError('Çalıştırma bulunamadı', 404, 'RUN_NOT_FOUND');
    return run;
  },

  async listRuns(workspaceId: string | undefined, deviceId?: string) {
    return prisma.agentRun.findMany({
      where: { ...(workspaceId ? { workspaceId } : {}), ...(deviceId ? { deviceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { device: { select: { name: true } }, _count: { select: { steps: true } } }
    });
  },

  async cancelRun(workspaceId: string | undefined, id: string): Promise<void> {
    const run = await prisma.agentRun.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true, status: true } });
    if (!run) throw new AppError('Çalıştırma bulunamadı', 404, 'RUN_NOT_FOUND');
    if (run.status !== 'RUNNING') return;
    await prisma.agentRun.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  },

  // BFS app exploration — dispatched as a classic job to the host agent.
  async explore(input: {
    workspaceId?: string;
    deviceId: string;
    packageName: string;
    maxScreens?: number;
  }): Promise<{ jobId: string }> {
    const device = await prisma.device.findFirst({
      where: { id: input.deviceId, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) },
      select: { id: true }
    });
    if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
    const job = await createJobRecord(
      'APP_EXPLORE',
      {
        deviceId: input.deviceId,
        packageName: input.packageName,
        ...(input.maxScreens ? { maxScreens: input.maxScreens } : {})
      } as never,
      undefined,
      input.workspaceId
    );
    return { jobId: job.id };
  },

  // After an APP_EXPLORE job completes, persist its graph as an AppMap. Called
  // from the explore controller once the job is COMPLETED (the result holds the
  // graph). Idempotent-ish: writes a new AppMap row per crawl.
  async saveMapFromJob(workspaceId: string | undefined, deviceId: string, jobId: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'COMPLETED' || !job.result) return null;
    const result = job.result as { graph?: unknown; screenCount?: number; packageName?: string };
    if (!result.graph || !result.packageName) return null;
    return prisma.appMap.create({
      data: {
        deviceId,
        packageName: result.packageName,
        graph: result.graph as Prisma.InputJsonValue,
        screenCount: typeof result.screenCount === 'number' ? result.screenCount : 0,
        ...(workspaceId ? { workspaceId } : {})
      }
    });
  },

  async getMap(workspaceId: string | undefined, deviceId: string) {
    return prisma.appMap.findFirst({
      where: { deviceId, ...(workspaceId ? { workspaceId } : {}) },
      orderBy: { createdAt: 'desc' }
    });
  },

  // Convert a finished agent run into a reusable, deterministic RPA flow:
  // "learn once, run a thousand times". Each recorded step's tool call is mapped
  // to RPA steps, with a short wait inserted after navigation actions so the UI
  // settles on replay.
  async convertToRpa(workspaceId: string | undefined, runId: string, name?: string) {
    const run = await prisma.agentRun.findFirst({
      where: { id: runId, ...(workspaceId ? { workspaceId } : {}) },
      include: { steps: { orderBy: { index: 'asc' } } }
    });
    if (!run) throw new AppError('Çalıştırma bulunamadı', 404, 'RUN_NOT_FOUND');

    const steps: RpaStep[] = [];
    for (const s of run.steps) {
      const calls = Array.isArray(s.toolCalls) ? (s.toolCalls as Array<{ name?: string; input?: Record<string, unknown> }>) : [];
      for (const c of calls) {
        if (!c || !c.name || c.name === 'done' || c.name === 'none') continue;
        const mapped = stepToRpa(s.screenTree, c.name, c.input ?? {});
        steps.push(...mapped);
        // Settle after navigation/launch so the replay isn't faster than the UI.
        if (c.name === 'launch_app' || c.name === 'tap_element' || c.name === 'tap') {
          steps.push({ type: 'wait', ms: 1200 });
        }
      }
    }
    if (steps.length === 0) throw new AppError('Bu çalıştırmadan çıkarılabilir adım yok', 422, 'NO_STEPS');

    const flow = await rpaService.create(
      {
        name: (name && name.trim()) || `AI: ${run.goal.slice(0, 60)}`,
        description: `AI Cihaz Ajanı çalıştırmasından üretildi (${run.steps.length} tur)`,
        steps
      },
      workspaceId
    );
    return { flowId: flow.id, steps: steps.length };
  }
};
