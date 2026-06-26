#!/usr/bin/env bash
# Rebind Local Phone 02 & 03 to host local-wsl2 (the host the running agent
# authenticates as) so the agent claims their jobs and marks them ONLINE.
# Their ipAddress/adbPort already match the forwarder ports (127.0.0.1:5556/5557).
echo "163244" | sudo -S true 2>/dev/null
PSQL='sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc'

WSL2_ID=$(eval $PSQL "\"SELECT id FROM \\\"Host\\\" WHERE name='local-wsl2';\"" 2>/dev/null | tr -d '[:space:]')
echo "local-wsl2 host id: $WSL2_ID"

# Ensure ports are correct + rebind to local-wsl2 + set ONLINE.
eval $PSQL "\"UPDATE \\\"Device\\\" SET \\\"hostId\\\"='$WSL2_ID', \\\"ipAddress\\\"='127.0.0.1', \\\"adbPort\\\"=5556, status='ONLINE', \\\"lastSeen\\\"=now() WHERE name='Local Phone 02';\"" 2>/dev/null
eval $PSQL "\"UPDATE \\\"Device\\\" SET \\\"hostId\\\"='$WSL2_ID', \\\"ipAddress\\\"='127.0.0.1', \\\"adbPort\\\"=5557, status='ONLINE', \\\"lastSeen\\\"=now() WHERE name='Local Phone 03';\"" 2>/dev/null

echo "=== devices after rebind ==="
eval $PSQL "\"SELECT name||'  '||status||'  '||COALESCE(\\\"ipAddress\\\",'')||':'||COALESCE(\\\"adbPort\\\"::text,'')||'  host='||COALESCE((SELECT name FROM \\\"Host\\\" h WHERE h.id=d.\\\"hostId\\\"),'none') FROM \\\"Device\\\" d WHERE name LIKE 'Local Phone%' ORDER BY name;\"" 2>/dev/null
