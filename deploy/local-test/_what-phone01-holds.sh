#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null

# Clean slate: only phone-01 on host net.
sudo docker rm -f fleet-local-phone-02 fleet-local-phone-03 >/dev/null 2>&1
echo "phone-01: $(sudo docker inspect fleet-local-phone-01 --format 'status={{.State.Status}} exit={{.State.ExitCode}}' 2>/dev/null)"

echo "=== ALL listening sockets in phone-01 netns (= host netns, since host mode) ==="
# redroid services that bind fixed ports will show here.
sudo ss -ltnp 2>/dev/null | grep -vE '127.0.0.53|systemd-resolve' | head -40

echo ""
echo "=== redroid-related processes (vsock/gpu/property) ==="
sudo ss -lxp 2>/dev/null | grep -iE 'redroid|render|gralloc|hwcomposer|surfaceflinger' | head

echo ""
echo "=== what unix sockets does redroid /init create in /dev or /tmp? ==="
PID=$(sudo docker inspect fleet-local-phone-01 --format '{{.State.Pid}}' 2>/dev/null)
echo "phone-01 init pid: $PID"
sudo ls -la /proc/$PID/root/dev/socket 2>/dev/null | head -20
