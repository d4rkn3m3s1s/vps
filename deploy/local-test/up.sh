#!/usr/bin/env bash
# ============================================================================
# up.sh — ONE COMMAND to bring up the WHOLE local stack, correctly, every time.
#
#   Run from Windows:   wsl -d Ubuntu bash -lc 'bash "/mnt/c/Yeni klasör/vps/deploy/local-test/up.sh"'
#   Run inside WSL:     bash deploy/local-test/up.sh
#
# What it does, in order, with health gates between each step:
#   1. Data layer  — binderfs + dockerd + Postgres + Redis (host-net), loopback fix
#   2. Preflight   — verifies the API↔dashboard ADMIN_PASSWORD match (the bug that
#                    made every dashboard page show "bilinmiyor"). FAILS LOUD if not.
#   3. API         — tsx dev server on :4000, waits for /health=200
#   4. Dashboard   — next dev on :3000, waits for /login=200
#   5. E2E health  — logs in as the service identity and reads /system/overview the
#                    SAME way the dashboard does, so "healthy vs bilinmiyor" is proven
#                    BEFORE you open the browser.
#
# Idempotent: re-running re-uses what's already up and only restarts what's down.
# ============================================================================
set -u

SUDO_PASS="${SUDO_PASS:-163244}"
S() { echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="/mnt/c/Yeni klasör/vps"
API_DIR="$ROOT/apps/api"
DASH_DIR="$ROOT/apps/dashboard"
API_ENV="$API_DIR/.env"
DASH_ENV="$DASH_DIR/.env"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── 1. Data layer ──────────────────────────────────────────────────────────
step "1/5  Data layer (Docker · Postgres · Redis)"
S mkdir -p /dev/binderfs
mount | grep -q /dev/binderfs || S mount -t binder binder /dev/binderfs

# Capture the default route BEFORE starting dockerd — on this custom binder kernel
# dockerd wipes both the default route (Windows↔WSL bridge + internet) AND the
# loopback policy rule. We restore both afterwards so localhost forwarding survives.
DEF_ROUTE="$(ip route show default 2>/dev/null | head -1)"

if S docker info >/dev/null 2>&1; then
  ok "docker already up"
else
  echo "$SUDO_PASS" | sudo -S nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
  for i in $(seq 1 40); do S docker info >/dev/null 2>&1 && break; sleep 1; done
  S docker info >/dev/null 2>&1 && ok "docker started" || { bad "docker FAILED"; S tail -15 /tmp/dockerd.log; exit 1; }
fi

# Restore default route if dockerd wiped it (Windows↔WSL bridge depends on it).
if ! ip route show default 2>/dev/null | grep -q .; then
  if [ -n "$DEF_ROUTE" ]; then
    S ip route add $DEF_ROUTE 2>/dev/null || true
  else
    S ip route add default via 172.28.0.1 dev eth0 2>/dev/null || true
  fi
fi
ip route show default 2>/dev/null | grep -q . && ok "default route ok" || bad "default route MISSING (Win↔WSL bridge broken)"

# dockerd wipes the loopback policy rule on this kernel — re-add it (idempotent)
if ! ip route get 127.0.0.1 >/dev/null 2>&1; then
  S ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null || true
  S ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null || true
fi
ip route get 127.0.0.1 >/dev/null 2>&1 && ok "loopback ok" || bad "loopback STILL broken"

S docker compose -f "$HERE/db-hostnet.yml" up -d >/dev/null 2>&1
for i in $(seq 1 30); do
  S docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1 && { ok "postgres ready"; break; }
  [ "$i" = 30 ] && bad "postgres not ready after 30s"
  sleep 1
done
pong=$(S docker exec fleet-local-redis redis-cli ping 2>/dev/null | tr -d '\r')
[ "$pong" = "PONG" ] && ok "redis PONG" || bad "redis not responding"

# ── 2. Preflight: env consistency ──────────────────────────────────────────
step "2/5  Preflight (env consistency)"
api_pw=$(grep -E '^ADMIN_PASSWORD=' "$API_ENV"  | head -1 | cut -d= -f2-)
dash_pw=$(grep -E '^ADMIN_PASSWORD=' "$DASH_ENV" | head -1 | cut -d= -f2-)
api_em=$(grep -E '^ADMIN_EMAIL=' "$API_ENV"     | head -1 | cut -d= -f2-)
dash_em=$(grep -E '^ADMIN_EMAIL=' "$DASH_ENV"   | head -1 | cut -d= -f2-)
api_key=$(grep -E '^DEFAULT_API_KEY=' "$API_ENV"  | head -1 | cut -d= -f2-)
dash_key=$(grep -E '^DEFAULT_API_KEY=' "$DASH_ENV" | head -1 | cut -d= -f2-)

mismatch=0
[ "$api_pw" = "$dash_pw" ]   && ok "ADMIN_PASSWORD matches" || { bad "ADMIN_PASSWORD MISMATCH (api='$api_pw' dash='$dash_pw') — dashboard will show 'bilinmiyor'!"; mismatch=1; }
[ "$api_em" = "$dash_em" ]   && ok "ADMIN_EMAIL matches"    || { bad "ADMIN_EMAIL MISMATCH (api='$api_em' dash='$dash_em')"; mismatch=1; }
[ "$api_key" = "$dash_key" ] && ok "DEFAULT_API_KEY matches" || { bad "DEFAULT_API_KEY MISMATCH"; mismatch=1; }
if [ "$mismatch" = 1 ]; then
  bad "Fix the .env mismatch above (api/.env is the source of truth — it must match the DB), then re-run."
  exit 1
fi

# ── 3. API ─────────────────────────────────────────────────────────────────
step "3/5  API (:4000)"
if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health 2>/dev/null)" = "200" ]; then
  ok "API already up"
else
  ( cd "$API_DIR" || exit 1
    fuser -k 4000/tcp >/dev/null 2>&1 || true; sleep 1
    nohup setsid npm run dev >/tmp/api.log 2>&1 </dev/null & )
  for i in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health 2>/dev/null)" = "200" ] && { ok "API up (${i}s)"; break; }
    [ "$i" = 60 ] && { bad "API failed to start — last log:"; tail -15 /tmp/api.log; exit 1; }
    sleep 1
  done
fi

# ── 4. Dashboard ───────────────────────────────────────────────────────────
step "4/5  Dashboard (:3000)"
if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null)" = "200" ]; then
  ok "dashboard already up"
else
  ( cd "$DASH_DIR" || exit 1
    fuser -k 3000/tcp >/dev/null 2>&1 || true; sleep 1
    nohup setsid npm run dev >/tmp/dash.log 2>&1 </dev/null & )
  for i in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null)" = "200" ] && { ok "dashboard up (${i}s)"; break; }
    [ "$i" = 60 ] && { bad "dashboard failed to start — last log:"; tail -15 /tmp/dash.log; exit 1; }
    sleep 1
  done
fi

# ── 5. End-to-end health (proves "healthy", not "bilinmiyor") ──────────────
step "5/5  End-to-end health"
# Reproduce exactly what the dashboard does server-side: service-identity login
# (x-service-auth bypasses 2FA), then read /system/overview.
tok=$(curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' -H "x-api-key: $api_key" -H 'x-service-auth: 1' \
  -d "{\"email\":\"$api_em\",\"password\":\"$api_pw\"}" 2>/dev/null \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -z "$tok" ]; then
  bad "service-identity login FAILED — dashboard pages would show 'bilinmiyor'. Check ADMIN_PASSWORD vs DB."
  exit 1
fi
ok "service login works (dashboard data path healthy)"

ov=$(curl -s -H "x-api-key: $api_key" -H "Authorization: Bearer $tok" http://localhost:4000/system/overview 2>/dev/null)
db=$(echo "$ov"    | sed -n 's/.*"database":{"status":"\([a-z]*\)".*/\1/p')
q=$(echo "$ov"     | sed -n 's/.*"queue":{"status":"\([a-z]*\)".*/\1/p')
dk=$(echo "$ov"    | sed -n 's/.*"docker":{"status":"\([a-z]*\)".*/\1/p')
printf "  PostgreSQL: %s   Redis: %s   Docker: %s\n" "${db:-?}" "${q:-?}" "${dk:-?}"

step "READY"
echo "  Dashboard : http://localhost:3000"
echo "  API       : http://localhost:4000"
echo "  Login     : $api_em / $api_pw"
