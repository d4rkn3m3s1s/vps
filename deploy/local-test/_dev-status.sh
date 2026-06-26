#!/usr/bin/env bash
# Show all devices' status, host binding, and adb endpoint from the DB.
echo "163244" | sudo -S true 2>/dev/null
sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc \
  "SELECT name || '  |  ' || status || '  |  ' || COALESCE(\"ipAddress\",'-') || ':' || COALESCE(\"adbPort\"::text,'-') || '  |  host=' || COALESCE((SELECT name FROM \"Host\" h WHERE h.id=d.\"hostId\"),'none') FROM \"Device\" d ORDER BY name;" 2>/dev/null | tr -d '\r'
