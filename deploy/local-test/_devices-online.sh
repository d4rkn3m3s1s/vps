#!/usr/bin/env bash
# Mark all 3 local phones ONLINE, bound to local-wsl2, with correct adb ports.
echo "163244" | sudo -S true 2>/dev/null
PSQL(){ sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc "$1" 2>/dev/null | tr -d '\r'; }

WSL2_ID=$(PSQL "SELECT id FROM \"Host\" WHERE name='local-wsl2';")
echo "local-wsl2 host id: $WSL2_ID"

PSQL "UPDATE \"Device\" SET \"hostId\"='$WSL2_ID', \"ipAddress\"='127.0.0.1', \"adbPort\"=5555, status='ONLINE', \"lastSeen\"=now() WHERE name='Local Phone 01';"
PSQL "UPDATE \"Device\" SET \"hostId\"='$WSL2_ID', \"ipAddress\"='127.0.0.1', \"adbPort\"=5556, status='ONLINE', \"lastSeen\"=now() WHERE name='Local Phone 02';"
PSQL "UPDATE \"Device\" SET \"hostId\"='$WSL2_ID', \"ipAddress\"='127.0.0.1', \"adbPort\"=5557, status='ONLINE', \"lastSeen\"=now() WHERE name='Local Phone 03';"

echo "=== after ==="
PSQL "SELECT name || '  ' || status || '  ' || COALESCE(\"ipAddress\",'-') || ':' || COALESCE(\"adbPort\"::text,'-') FROM \"Device\" WHERE name LIKE 'Local Phone%' ORDER BY name;"
