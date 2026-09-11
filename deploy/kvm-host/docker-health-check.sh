#!/usr/bin/env bash
# Harici container-healthcheck: PG ve Redis'e ping at; process ayakta ama cevap
# vermiyorsa (donma/deadlock) container'ı restart et. Docker native healthcheck
# container-recreate gerektirdiği için (manuel-başlatılmış container) bu harici yol.
set -uo pipefail
# PostgreSQL: pg_isready 10s içinde cevap vermezse donmuş say
if ! timeout 10 docker exec fleet-postgres pg_isready -U postgres >/dev/null 2>&1; then
  # ikinci deneme (geçici yük olabilir)
  sleep 3
  if ! timeout 10 docker exec fleet-postgres pg_isready -U postgres >/dev/null 2>&1; then
    echo "$(date '+%F %T') fleet-postgres UNHEALTHY (pg_isready timeout) -> restart"
    docker restart fleet-postgres
  fi
fi
# Redis: PING PONG dönmezse donmuş say
if [ "$(timeout 8 docker exec fleet-redis redis-cli ping 2>/dev/null)" != "PONG" ]; then
  sleep 3
  if [ "$(timeout 8 docker exec fleet-redis redis-cli ping 2>/dev/null)" != "PONG" ]; then
    echo "$(date '+%F %T') fleet-redis UNHEALTHY (no PONG) -> restart"
    docker restart fleet-redis
  fi
fi
