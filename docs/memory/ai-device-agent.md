---
name: ai-device-agent
description: AI Device Agent feature — Claude autonomously drives a phone (ReAct loop) + BFS app-explorer; ported from ghost-in-the-droid/android-agent into native architecture.
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Added 2026-06-27: an **AI Cihaz Ajanı (AI Device Agent)** feature — Claude drives an Android
phone in a perceive→decide→act loop toward a natural-language goal. Inspired by
`ghost-in-the-droid/android-agent` but rebuilt natively (NOT copied — user explicitly chose
"bizim mimaride yeniden kur"). `HQarroum/docker-android` was evaluated and skipped (emulator
already solved via [[windows-avd-stack]], KVM risk).

**Critical architecture (Option C):** the LLM loop runs on the **API side** (key stays server-side),
and perception/action go over the **existing `/ws/agent-stream` WS** in real-time (sub-100ms),
NOT the job queue. Added `streamHub.requestFromAgent(hostId, {type:'agent.dump'|'agent.action'}, timeoutMs)`
with a reqId pending-map round-trip in `stream.hub.ts`; agent.mjs replies with
`agent.dump.result`/`agent.action.result` (non-binary JSON, handled in `onAgentMessage`).
**`AGENT_TASK` job type was deliberately NOT created** — the loop is WS, not a job.

**BFS app-explorer** runs as a classic **`APP_EXPLORE` job** (LLM-free, long local crawl). Added to
all THREE synced places (schema enum, `job.types.ts`, agent.mjs `runJob` switch + `exploreApp`).
Result graph → persisted to `AppMap` via `POST /device-agent/map {deviceId, jobId}` after job COMPLETED.

**4 techniques baked into agent.mjs (zero-dep):** (1) `buildScreenTree(nodes,cap)` compact LLM tree
`[idx] Class "label" [clickable] [bounds]` + auto-append fresh tree after each action; (2)
`resolveTarget(nodes,locator)` desc→text→resId→class→coords fallback (RPA tapText/tapDesc/tapId now
accept `step.locator`); (3) stealth `stealthTap/Swipe/Type` (gauss jitter, human-cadence) — per-run
`stealth` flag, also wired into `handleControl` input.* via `msg.stealth`; (4) BFS `structuralHash`
(class+resId, FNV-1a). `parseUiNodes` now also captures `cls` + `scrollable`.

**Where:** API `modules/device-agent/` (service `startRun`/`driveRun`/`explore`/`getMap`,
controller, routes mounted at `/device-agent` — NOT `/agent` which is host-agent). AI multi-tool
caller `callToolLoop(system, messages[], tools[], maxTokens)` added to `modules/ai/ai.service.ts`
(tool_choice:auto, returns all tool_use + stop_reason; `callForcedTool` now exported). Models
`AgentRun`/`AgentRunStep`/`AppMap` + `AgentRunStatus` enum. Dashboard `/ai-agent` page+`AiAgentView.tsx`
(device picker, goal, stealth toggle, turn timeline poll, BFS explore + app-map), nav `nav.aiAgent`,
proxy routes `app/api/ai-agent/*`.

Gated to ANTHROPIC_API_KEY (503 AI_NOT_CONFIGURED when absent, like /ai) and to an ONLINE host agent
(409 AGENT_OFFLINE). Both apps tsc --noEmit exit 0. Migration `20260627000000_ai_device_agent`
applies when stack starts ([[local-stack-startup]]).

**4 enhancements added same day (2026-06-27):**
1. **Vision (set-of-marks):** per-run `useVision` flag → agent `captureShot(serial)` returns PNG base64
   (downscaled via FLEET_FFMPEG if present); `agent.dump`/`agent.action` take `wantShot`, reply carries
   `shot`; driveRun sends `{type:'image',source:{base64,image/png}}` blocks to Claude (content is `unknown`,
   so arbitrary arrays OK); screenshot stored on `AgentRunStep.screenshot`. requestFromAgent timeout bumped 15→20s.
2. **Live screen:** dashboard embeds the existing `LiveScreen` component (profiles/[id]/LiveScreen.tsx,
   self-contained `{deviceId,online}`, uses /api/devices/[id]/stream-token + /ws/stream) via a CANLI EKRAN toggle.
3. **Scheduling:** added `AGENT_RUN` JobType (3 places). `scheduler.runDue` special-cases AGENT_RUN →
   `deviceAgentService.startRun` (API-side loop, NOT createJobRecord). Schedule via existing ScheduledTask
   UI with jobType=AGENT_RUN, payload={goal,stealth,useVision,maxTurns}, repeat=DAILY etc.
4. **Run→RPA:** `convertToRpa(workspaceId,runId,name?)` parses each `AgentRunStep.screenTree` for `[idx]...[bounds]`
   (regex `boundsForIdx`), maps toolCalls→RpaStep[] (`stepToRpa`: tap_element→tapText+coords, etc), calls
   `rpaService.create`. Endpoint `POST /device-agent/runs/:id/to-rpa`; dashboard "RPA'ya kaydet" button on
   finished runs. "Learn once, run a thousand times" — deterministic LLM-free replay.

Migration now also has `useVision` (AgentRun) + `screenshot` (AgentRunStep) columns + AGENT_RUN enum value.
