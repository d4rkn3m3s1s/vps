#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
for c in fleet-local-phone-02 fleet-local-phone-03; do
  echo "==================== $c ===================="
  echo "--- inspect state ---"
  S docker inspect "$c" --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} err={{.State.Error}}'
  echo "--- image / command ---"
  S docker inspect "$c" --format 'image={{.Config.Image}}'
  echo "--- last 25 log lines ---"
  S docker logs --tail 25 "$c" 2>&1
  echo ""
done
echo "=== host resources ==="
echo "mem:"; free -h | head -2
echo "cpu cores: $(nproc)"
echo "=== binder devices ==="
ls /dev/binderfs 2>/dev/null
