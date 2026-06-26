#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
echo "--- stop & remove phone-02 (keep its data volume) ---"
S docker rm -f fleet-local-phone-02 >/dev/null 2>&1
echo "--- recreate phone-02 fresh from compose ---"
S docker compose -f "/mnt/c/Yeni klasör/vps/deploy/local-test/docker-compose.hostnet.yml" up -d phone-02 >/dev/null 2>&1
echo "--- wait 8s, then capture WHY it dies ---"
sleep 8
echo "state: $(S docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
echo "--- full logs (fresh boot) ---"
S docker logs fleet-local-phone-02 2>&1 | tail -40
echo "--- /data on phone-02 volume (corruption check) ---"
S docker run --rm -v fleet-local_phone02-data:/d alpine ls -la /d 2>/dev/null | head -8
