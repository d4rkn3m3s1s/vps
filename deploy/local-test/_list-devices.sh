#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -F $'\t' -A -c \
"SELECT d.id, COALESCE(d.name,'?') AS name, d.status, COALESCE(d.\"ipAddress\",'') AS ip, d.\"adbPort\" AS port,
        COALESCE(h.name,'none') AS host, d.\"createdAt\"::date AS created
 FROM \"Device\" d LEFT JOIN \"Host\" h ON h.id=d.\"hostId\"
 ORDER BY d.name, d.\"createdAt\";"
