#!/bin/sh -
# net-head.sh <instance> — deterministic subnet id for a Waydroid instance.
#
# Waydroid multi-instance (PR #1990) derives a per-instance /24 from the
# instance name so isolated instances never collide on the network. This is
# the SAME formula waydroid's own net-head uses: md5(name) -> 192.168.<241..256>.x.
# The default (unnamed) instance keeps 192.168.240.x.
#
# Prints ONLY the third octet (241..256, or 240 for the default) on stdout so
# callers can do:  SUBNET_ID=$(sh net-head.sh mi4)  ->  "255".
set -u

INSTANCE="${1:-}"
if [ -z "$INSTANCE" ]; then
    echo 240
    exit 0
fi

MD5HASH=$(printf '%s' "$INSTANCE" | md5sum | cut -d ' ' -f1)
AS_DECIMAL=$(printf '%d' "0x$(printf '%s' "$MD5HASH" | cut -c1-8)")
echo $((AS_DECIMAL % 16 + 241))
