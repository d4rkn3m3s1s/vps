Michael Medston will project himself or then with the camera. Help. Hello. Stopping. Technologic. Them. Karshmis. Surbhi Prasad, Sunil. Chicken Islam job you. Saturday night. 4 days. Smoke you. Kirsten. Rohr Midwarije Khimet Varanzar coming in here. Hiralam, Bo. Ranjit Moor film is. Hey, Nahida. Music. Delete. Smoker, says Seth. Uh, working. Image washed in. Just a. Can you do it? Pigeon also. Janatha Jan. Take shoulder. News. Uh. IAS general business protest. Evernote. British junior. Mute. Staniogram 's. Extender. Concurrence Zoo. Meets. 00, No. Sutherland Chamber Mitti Raynavi chamber was. Chamber bizarre. Cortana. Mrs Spike. Much. Quickly. Hey, Cortana. Conquer again. Oral buzz mixed in film and he laid off. Joseph and he lady. I. There's someone with me. Takamaki show organ. You didn't tell her? Call Rujaan. Within. Turnover. Folder drums spike item. Heaven should I cover? What? I'm there. Why doesn't Cortana? Another. Credit glove. NDA Deshmukh stars. Dwaramup World Vijayadharam friends. Double crosser. J. OK I'll do. Oh. Alright, cool. Give this album. New 6 Jets vision. Turn alarm. Nikhil Nagar. This is my Vatican. Either my. Shortly do. Let me see his club, Vijayan. Have a little question. Cortana. I. Jazz solder, solder gecko. Use not. And Courier. Chandrababu Jaitleys. Yeah. I. Too much? He missed you. Kill yours. Dabu Parchaliya. Saatar October. Ultima Mixer. I'm sorry. Don't dream now. Site each 3rd. Forgo. Showers sexy shows. Janatham Diza. Play. Jay, you should have done it. 1. Sickness. Ulse Marathon. Kim Jong is here. When is June tourism? Hey, Cortana. You just gotta kick it right now. Sabarim. Eleanor comes at the hardcover. Sure. Reminder. Shift double Gaucher. I'm just. Baby parampashti. Hello, Graham. Finish. Stop Durga of yours. Kabul, Kitur. I. Hey, Shelton. Vineland Akbar Adhana. Promise. We didn't know Cortana. Shrimp Anil. Bit similar Tom, Bitana, Shane Live at Alder Live to the Collision Chevy Chelsea what's up Danish? Go on that machine. That's your opposite. Uh. OK. clA#!/usr/bin/env bash
# VPS Fleet — LOCAL TEST one-shot boot for Kali WSL2 (custom binder kernel)
#
# Run this in Kali after a Windows restart to bring the whole local test stack
# back up, in order:
#   1. mount binderfs (redroid needs it; it doesn't survive a restart)
#   2. start the native Docker daemon in the background (bridge disabled)
#   3. bring up Postgres + Redis (host network)
#   4. bring up the two redroid phones (host network)
#   5. wait for Android to finish booting, print adb devices
#
# It is idempotent — safe to re-run. It does NOT install packages (no internet
# needed). Run with:  bash deploy/local-test/boot-kali.sh
#
# After it finishes: run the API (npm run dev in apps/api), then register.mjs.

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log()  { printf '\033[1;36m[boot]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

# 1. binderfs ----------------------------------------------------------------
log "Mounting binderfs…"
sudo mkdir -p /dev/binderfs
if ! mount | grep -q '/dev/binderfs'; then
  sudo mount -t binder binder /dev/binderfs 2>/dev/null \
    && ok "binderfs mounted" \
    || warn "binderfs mount failed — is the custom kernel active? (uname -r should end in +)"
else
  ok "binderfs already mounted"
fi
ls /dev/binderfs/ 2>/dev/null | tr '\n' ' '; echo

# 2. Docker daemon -----------------------------------------------------------
if sudo docker info >/dev/null 2>&1; then
  ok "Docker daemon already running"
else
  log "Starting Docker daemon in background (bridge disabled)…"
  # daemon.json was written earlier with { iptables:false, ip6tables:false, bridge:"none" }
  sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
  for i in $(seq 1 30); do
    if sudo docker info >/dev/null 2>&1; then ok "Docker daemon up"; break; fi
    sleep 1
  done
  sudo docker info >/dev/null 2>&1 || { warn "Docker still not up — check /tmp/dockerd.log"; tail -15 /tmp/dockerd.log; exit 1; }
fi

# 3. Postgres + Redis --------------------------------------------------------
log "Bringing up Postgres + Redis (host network)…"
sudo docker compose -f "$HERE/db-hostnet.yml" up -d
log "Waiting for Postgres to accept connections…"
for i in $(seq 1 30); do
  if sudo docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1; then ok "Postgres ready"; break; fi
  sleep 1
done

# 4. redroid phones ----------------------------------------------------------
log "Bringing up redroid phones (host network)…"
sudo docker compose -f "$HERE/docker-compose.hostnet.yml" up -d

# 5. Wait for Android + adb --------------------------------------------------
log "Connecting adb + waiting for Android to boot (first boot ~30–90s)…"
adb start-server >/dev/null 2>&1 || true
adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  state=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  if [ "$state" = "1" ]; then ok "phone-01 boot completed"; break; fi
  sleep 2
done
echo
log "Devices:"
adb devices

cat <<'EOF'

──────────────────────────────────────────────────────────────────────────────
 Stack is up. Next:
   1. Start the API:        cd "/mnt/c/Yeni klasör/vps/apps/api" && npm run dev
   2. (first time only) migrate + seed — see SETUP-KALI.md
   3. Register the phone:   see SETUP-KALI.md  (register.mjs)
   4. Start the host agent: command printed by register.mjs
──────────────────────────────────────────────────────────────────────────────
EOF
