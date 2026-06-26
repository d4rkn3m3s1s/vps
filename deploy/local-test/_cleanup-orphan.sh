#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
P(){ sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc "$1" 2>/dev/null; }

OID=$(P "SELECT id FROM \"Device\" WHERE name='quick-465bde';" | tr -d '[:space:]')
echo "orphan id: $OID"
[ -z "$OID" ] && { echo "no orphan; nothing to do"; exit 0; }

echo "jobs referencing it: $(P "SELECT count(*) FROM \"Job\" WHERE \"deviceId\"='$OID';")"
# Detach any jobs then delete the orphan device row.
P "UPDATE \"Job\" SET \"deviceId\"=NULL WHERE \"deviceId\"='$OID';" >/dev/null
P "DELETE FROM \"Device\" WHERE id='$OID';" >/dev/null
echo "=== devices after cleanup ==="
sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -F $'\t' -A -c \
"SELECT name, status, COALESCE(\"ipAddress\",'')||':'||\"adbPort\" AS adb FROM \"Device\" ORDER BY name;"
