---
name: three-redroid-phones
description: How to run 3 redroid cloud phones on the custom-kernel WSL2 host (binderfs + --network none + Node netns forwarder)
metadata: 
  node_type: memory
  type: project
  originSessionId: 27407aa3-afb1-4b1b-8795-dc7f23a050e8
---

Running MORE THAN ONE redroid phone on this custom-kernel WSL2 host is non-obvious. Hard-won recipe (encoded in `deploy/local-test/up-3phones.sh` + `netns-forward.mjs`):

**Two blockers, two fixes:**
1. **Shared binder device** — all redroid instances default to the single `/dev/binderfs/binder` node and fight over it. Fix: give each its OWN isolated binderfs mount (`mount -t binder binder /dev/binderfsN`) and bind it in with `-v /dev/binderfsN:/dev/binderfs`.
2. **Network** — this kernel has NO working docker bridge/veth/nat (see [[wsl-nat-networking-fix]]); only `--network host` works, but TWO host-net redroids collide: the 2nd one's Android `/init` fails a critical service → reboot-on-failure → **exit 129** (empty logs; dmesg shows `Service with 'reboot_on_failure' option failed`). Bridge mode can't even create an endpoint (exit 128).

**The working layout:**
- `phone-01` → `--network host`, adbd on host `:5555` (the one primary that owns host netns)
- `phone-02` → `--network none` + binderfs2, adbd inside its netns → reached on host `:5556`
- `phone-03` → `--network none` + binderfs3, **redroid 11 ndk** (ARM translation, runs WhatsApp/IG) → host `:5557`

`--network none` boots cleanly (no netns config = no SIGHUP). Reach those phones from the host with `netns-forward.mjs` — a zero-dep Node TCP proxy that pipes `host:PORT` → `nsenter -t <containerPid> -n nc 127.0.0.1 5555`. Must run as root. (socat would be simpler but apt has no DNS here, so Node — already present — is the dependency-free path.)

**DB binding:** all 3 Device rows must have `hostId` = the `local-wsl2` Host id (the host the running agent authenticates as) or the agent won't claim their jobs. Their `ipAddress:adbPort` = `127.0.0.1:5555/5556/5557` (the forwarder ports). See [[whatsapp-rpa]] and [[local-android-test-stack]].

Verified: API→agent→adb screenshot job ran on all 3; live screencaps returned real PNGs from each. Forwarder PIDs change on every container restart — `up-3phones.sh` re-derives them.
