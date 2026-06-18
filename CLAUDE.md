# CLAUDE.md

Orientation for working in this repo. Read this first; it captures what isn't
obvious from a quick scan.

## What this is

A cloud-phone fleet management + account-farming platform — a self-hosted
alternative to Multilogin Cloud Phone / VMOS Cloud / DuoPlus. Operators manage
many Android cloud phones (real devices/emulators on KVM hosts), warm up social
accounts, run RPA automation, and control devices live.

## Monorepo layout

```
apps/
  api/        Express + TypeScript + Prisma (PostgreSQL) REST API + WS hubs
  dashboard/  Next.js (App Router) operator dashboard  (workspace name: @vps/web)
deploy/
  kvm-host/agent/agent.mjs   Zero-dependency host agent (Node 18+; 21+ for streaming)
docs/         openapi.yaml, server setup, deploy guides
```

There is no separate worker for most flows — long-running device work is dispatched
to the **host agent**, not an in-process queue (see below).

## Architecture essentials

- **API → host agent job model.** The dashboard calls the API; the API records a
  `Job` row (often via `createJobRecord`, which does NOT enqueue BullMQ). The KVM
  **host agent** (`deploy/kvm-host/agent/agent.mjs`) long-polls `/agent/jobs/next`,
  executes over local ADB, and reports back to `/agent/jobs/{id}/complete`. Devices
  are bound to a host via `Device.hostId`; the agent only claims jobs for its devices.
  - Agent auth: `x-api-key` + `x-agent-key` (looked up by `sha256` against `Host.agentKeyHash`).
  - There is also an in-process BullMQ path (`createJob`, `processor.ts`) used by some
    emulator lifecycle flows and the webhook worker, but most new features use the agent.
- **WebSocket hubs** (attached in `apps/api/src/index.ts`):
  - `/ws/devices` — `device.hub.ts`, broadcasts device/job/alert events to dashboards.
  - `/ws/agent-stream` + `/ws/stream` — `stream.hub.ts`, live screen streaming + remote
    control. Host agent pushes binary frames (`"FRM:" + deviceId(36) + image bytes`);
    viewers send control JSON (`tap`/`swipe`/`key`/`text`, and `mirror` for Synchronizer).
- **In-process tickers** (in `index.ts`, every 60–90s, `.unref()`d):
  scheduler `runDue` + calendar `dispatchDue`, vast sync, farm `tick`.
- **Auth.** JWT access tokens (`lib/jwt.ts`, claims `{sub,email,role,workspaceId}`),
  workspace-scoped. The dashboard never holds a JWT in the browser — Next.js route
  handlers under `app/api/*` call the backend server-side via `lib/apiClient.ts`
  (which logs in as a service identity and caches a per-workspace token).
- **Secrets** are AES-256-GCM encrypted at rest (`lib/crypto.ts` — `encryptString`,
  `decryptString`, `sha256`). Never return decrypted secrets to clients.
- **Multi-tenancy.** Almost everything is workspace-scoped via `getWorkspaceId(req)`.
  Honor it in new queries.

## Module conventions (apps/api/src/modules/<name>)

Each module has `*.service.ts` (logic), `*.controller.ts` (zod-validated handlers),
`*.routes.ts` (Express router). Routers are mounted in `src/routes/index.ts`. Most
routes use `requireApiKey` + `authenticateJwt`. Write an `audit.service` entry for
state-changing actions. Dashboard API routes proxy 1:1 through `apiCall(path, {auth:true})`.

`tsconfig` has **`exactOptionalPropertyTypes: true`** — spread conditionally
(`...(x ? {k:x} : {})`) instead of assigning `undefined` to optional fields.

## Where features live

- **Devices/profiles**: `modules/devices` ↔ dashboard `/profiles` (`[id]` is device detail).
- **Fingerprints** (anti-detection): `modules/fingerprint`. `generateFingerprintData`
  randomizes IMEI/model/etc.; can pin `model`/`osVersion` (provisioning catalog).
- **RPA**: `modules/rpa` ↔ `/rpa`. Steps: `tap|type|wait|swipe|openApp|shell|keyevent`.
- **AI flow builder**: `modules/ai` — Anthropic Messages API (`claude-opus-4-8`,
  forced-tool structured output) turns NL into RPA steps. Needs `ANTHROPIC_API_KEY`.
  When touching anything Claude/Anthropic, consult the `claude-api` skill — don't
  guess model ids or API shape.
- **Farm** (account warmup): `modules/farm` ↔ `/farm`. Campaigns, warmup stages,
  health scoring, encrypted credential vault + TOTP, proxy rotation, and a proactive
  ban-risk score that fires `FARM_BAN_RISK` alerts.
- **Live streaming + wall**: `modules/stream` ↔ device detail `LiveScreen` + `/wall`
  (multi-device grid with Synchronizer leader→followers input mirror).
- **Snapshots / image market**: `modules/snapshots` ↔ `/images`. Capture/restore/clone,
  one-click reset.
- **Device grants/transfer**: `modules/grants` (timed VIEW/CONTROL lend + workspace transfer).
- **Content calendar**: `modules/calendar` ↔ `/calendar` (scheduled multi-account posts).
- **Usage metering**: `modules/usage` — online-minute rollup from heartbeats, surfaced
  on `/billing`.
- **Proxies**: `modules/proxies` — pool, health check, bulk import from any provider,
  geo-matched auto-assign.
- **Other**: alerts, webhooks, billing (Stripe), permissions/RBAC, hosts (KVM/Vast.ai),
  catalog/library, scheduler, analytics, reports.

## Conventions to follow

- **UI language is Turkish-first.** User-facing strings in the dashboard are Turkish;
  English is the i18n fallback (`apps/dashboard/src/lib/i18n.tsx`). Match this.
- **Job types** live in two synced places: the Prisma `JobType` enum (`schema.prisma`)
  AND the `JobTypes` const array (`modules/jobs/job.types.ts`). Add to both, and add a
  handler in `agent.mjs` (and/or `processor.ts`).
- **Migrations** are SQL files under `apps/api/prisma/migrations/<ts>_<name>/migration.sql`.
  Use `IF NOT EXISTS` / `DO $$ ... EXCEPTION WHEN duplicate_object` guards (the project
  applies them idempotently). After schema edits run `npx prisma generate`.
- New nav entries: add an i18n key (`nav.*`) + a Sidebar item (`components/Sidebar.tsx`).

## Commands (run inside the app dir)

```bash
# apps/api
npx tsc --noEmit          # type-check (the de-facto gate; there is no lint script)
npx prisma generate       # regenerate client after schema changes
npm run db:migrate        # prisma migrate dev
npm run dev               # tsx watch

# apps/dashboard
npx tsc --noEmit          # type-check
npm run dev               # next dev
```

Both apps must `tsc --noEmit` clean before considering work done. There is no
project `lint`/`test` script — type-check is the gate.

## Gotchas

- The host agent is **dependency-free** (Node built-ins only) — keep it that way; no npm imports.
- Streaming uses throttled JPEG/PNG frames over WS (no scrcpy/ffmpeg) so the agent stays zero-dep.
- `apiClient.ts` resolves the active workspace from the `fleet_workspace` cookie and
  caches a token per workspace — server-side only.
- Don't commit `apps/dashboard/tsconfig.tsbuildinfo` (generated build cache).
