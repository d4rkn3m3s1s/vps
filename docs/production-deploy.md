# Production Deployment & Security

A checklist for taking VPS Fleet live. The app is a monorepo: `apps/api`
(Express + Prisma + Postgres + Redis/BullMQ) and `apps/dashboard` (Next.js 15).

## 1. Environment

Copy the example files and fill real values:

```bash
cp apps/api/.env.example       apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env
```

Generate every secret fresh — never reuse dev values:

```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, SOCIAL_CRYPTO_KEY
openssl rand -hex 24   # DEFAULT_API_KEY
openssl rand -base64 24 # ADMIN_PASSWORD (or any long random string)
```

**These MUST match between the two apps:**
- `DEFAULT_API_KEY` (api ↔ dashboard)
- `ADMIN_EMAIL` + `ADMIN_PASSWORD` (api ↔ dashboard — the dashboard logs in as this
  service identity for server-side reads; a mismatch breaks all data fetches)

The bootstrap admin password is re-hashed into the DB on **every API start**, so
changing `ADMIN_PASSWORD` + restarting the API is all that's needed to rotate it.

## 2. Security checklist (do before exposing publicly)

- [x] **Default admin password changed** — `ChangeMe123!` is gone; set a strong one.
- [ ] All JWT/crypto secrets are unique 32+ char random values (not the examples).
- [ ] `DEFAULT_API_KEY` rotated to a fresh random value.
- [ ] Postgres/Redis are NOT exposed to the public internet (bind to private network/VPN).
- [ ] HTTPS/TLS terminates in front of both apps (reverse proxy: Caddy/nginx/Traefik).
- [ ] Stripe uses **live** keys only in production; webhook secret set; test keys elsewhere.
- [ ] SMTP configured (`SMTP_HOST`…) so invites/alerts/2FA emails actually send.
- [ ] Per-workspace **require2fa** policy enabled for sensitive workspaces (Admin → General).
- [ ] External ADB exposure (Admin device → ADB) always uses an **IP allowlist** — never
      open ADB to `0.0.0.0/0` (unauthenticated ADB = device root). See `docs/external-adb.md`.
- [ ] Review the audit log export + alert rules; wire alert webhooks/email for prod incidents.

## 3. Build & run

```bash
# API
cd apps/api
npm ci
npx prisma migrate deploy      # or `prisma db push` for the current schema
npm run build && npm start

# Dashboard
cd apps/dashboard
npm ci
npm run build && npm start
```

Infra (dev/self-host): `docker compose up -d` brings up Postgres + Redis
(`vps-postgres-1`, `vps-redis-1`).

## 4. Background workers (in-process)

The API process runs these on a timer — no separate worker needed for them:
- **Scheduler** tick (due scheduled tasks) — every 60s
- **Webhook delivery worker** (BullMQ, retry/backoff) — continuous
- **Vast.ai sync** (provisioned GPU hosts → online hosts → auto-registered phones) — every 90s

For heavy job throughput you can additionally run the dedicated worker:
`cd apps/api && node dist/worker.js`.

## 5. Vast.ai GPU hosts

No env var needed. Each workspace connects its own Vast.ai API key at
**Admin → GPU servers**, stored AES-encrypted. Provision → the host appears
pending → the 90s sync brings it online and registers its cloud phone
automatically once the instance is RUNNING. See the page's inline guidance.
