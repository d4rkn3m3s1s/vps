# VPS Android Emulator Platform

Multi-emulator management platform for VPS environments.

## Architecture

```mermaid
graph TD
  U[Admin / Operator] --> W[Next.js Dashboard]
  W --> A[Node.js REST API]
  A --> P[(PostgreSQL)]
  A --> R[(Redis + BullMQ)]
  A --> D[Docker Runtime]
  A --> B[ADB Control Layer]
  B --> E[Android Emulator Containers]
  A --> L[Winston Logs]
  A --> S[OpenAPI / Swagger]
  A --> M[Plugin Modules]
  M --> WA[WhatsApp Module]
  M --> IG[Instagram Module]
  M --> FB[Facebook Module]
```

## Core Flow

```mermaid
sequenceDiagram
  participant U as User
  participant W as Dashboard
  participant A as API
  participant Q as BullMQ
  participant D as Docker/ADB
  participant P as PostgreSQL

  U->>W: Request emulator action
  W->>A: REST call with JWT or API key
  A->>P: Persist job + audit log
  A->>Q: Enqueue long-running job
  Q->>D: Create/start/stop emulator or run ADB task
  D->>P: Update emulator state
  Q->>P: Update job status
  W->>A: Poll job status / list emulators
```

## Folder Layout

```text
apps/
  api/   Node.js + TypeScript REST API
  web/   Next.js dashboard
packages/
  shared/ Common DTOs and types
```

## Run Locally

1. Copy `.env.example` to `.env` and adjust secrets.
2. Install dependencies with `npm install`.
3. Start infrastructure: `docker compose up -d postgres redis`.
4. Run migrations and seed data from `apps/api`.
5. Start the API and dashboard.

## Notes

- Emulator actions are modeled as queued jobs so long-running work stays off the request path.
- Plugin modules are isolated per application and can be extended without touching the core emulator flow.
- The Docker image for Android emulators is configurable through `EMULATOR_IMAGE`.
- Operational visibility is exposed through `/system/overview`, `/plugins`, and `/audit`.
- Device inventory and live updates are exposed through `/devices` and `ws://localhost:4000/ws/devices`.
