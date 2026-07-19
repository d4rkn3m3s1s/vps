#!/bin/bash
# net-head.sh <instance> — çakışmasız sıralı subnet (2..239). Bash, flock ile atomik.
set -u
MAP=/var/lib/waydroid-subnets.map
INSTANCE="${1:-}"
[ -z "$INSTANCE" ] && { echo 240; exit 0; }
mkdir -p "$(dirname "$MAP")"; touch "$MAP"

# atomik lock (mkdir tabanlı, flock bağımsız)
LOCKD=/var/lib/waydroid-subnets.lock
i=0; while ! mkdir "$LOCKD" 2>/dev/null; do i=$((i+1)); [ $i -gt 50 ] && break; sleep 0.1; done
trap 'rmdir "$LOCKD" 2>/dev/null' EXIT

EXIST=$(awk -v n="$INSTANCE" '$1==n{print $2; exit}' "$MAP")
if [ -n "$EXIST" ]; then echo "$EXIST"; exit 0; fi

S=2
while [ "$S" -le 239 ]; do
  awk -v s="$S" '$2==s{f=1} END{exit !f}' "$MAP" || break
  S=$((S+1))
done
[ "$S" -gt 239 ] && { echo "240"; exit 0; }
printf '%s %s\n' "$INSTANCE" "$S" >> "$MAP"
echo "$S"
