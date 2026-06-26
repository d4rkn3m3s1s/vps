# Local Android test stack (Windows + WSL2 + redroid)

Spin up **real Android 13 cloud phones on your Windows dev box** and drive them
through the platform end-to-end — jobs, live screen, RPA, snapshots, farm — using
the exact same `host agent → ADB` path as production. No bare-metal server needed.

```
Windows 11
└─ WSL2 (Ubuntu)
   ├─ Docker → redroid containers  ──ADB 5555/5556──┐
   ├─ host agent (agent.mjs) ───────────────────────┘  long-polls jobs, runs ADB
   └─ (API + dashboard can run on Windows or in WSL)
        ▲
        └── register.mjs wires the phones into the API
```

## 0. Prerequisites (one-time, on Windows)

1. **WSL2 + Ubuntu**
   ```powershell
   wsl --install -d Ubuntu
   wsl --update
   wsl --set-default-version 2
   ```
2. **Virtualization on**: BIOS/UEFI VT-x / AMD-V enabled, and Windows features
   *Virtual Machine Platform* + *Windows Subsystem for Linux* turned on.
3. **Docker** reachable inside WSL2 — easiest is **Docker Desktop** with *Settings
   → Resources → WSL integration* enabled for your Ubuntu distro. (The setup
   script can fall back to `docker.io` inside WSL if Docker Desktop isn't used.)

Everything below runs **inside the WSL2 Ubuntu shell**, from the repo checkout.

## 1. Bring up the phones

```bash
cd /mnt/c/Yeni\ klasör/vps        # or wherever you cloned it
bash deploy/local-test/setup-wsl2.sh
```

This checks `/dev/kvm` + the `binder` module, installs Docker/ADB if needed, and
runs `docker compose up -d` for 2 phones. Wait until they report `device`:

```bash
watch -n2 adb devices
# 127.0.0.1:5555   device
# 127.0.0.1:5556   device
```

First boot takes ~30–90s. `offline` just means it's still booting.

> Want more/fewer phones? Edit `deploy/local-test/docker-compose.yml` (copy a
> `phone-NN` block with a new `container_name` + host port) and re-run compose.

## 2. Run the API + dashboard

From the repo (Windows **or** WSL — just be consistent about the URL):

```bash
# apps/api
cp .env.example .env   # set DATABASE_URL, JWT secrets, ENCRYPTION_KEY, etc.
npm run db:migrate
npm run dev            # → http://localhost:4000

# apps/dashboard (separate shell)
npm run dev            # → http://localhost:3000
```

Create an operator account in the dashboard if you don't have one, then mint an
API key: **Admin → API anahtarları → + Yeni anahtar** (scope `admin`). Copy it.

## 3. Register the phones into the platform

```bash
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY=<the api key you just created>

node deploy/local-test/register.mjs you@example.com 'your-password'
```

It logs in, registers a host named `local-wsl2`, creates a `Device` per ADB port,
assigns them to the host, and **prints the one-time agent key + the exact command
to start the agent**. Save that key.

If the phones are reachable at a different address from where the agent runs (e.g.
agent in WSL, ADB via Docker Desktop), override:
```bash
FLEET_ADB_HOST=127.0.0.1 FLEET_ADB_PORTS=5555,5556 node deploy/local-test/register.mjs ...
```

## 4. Start the host agent

Paste the command `register.mjs` printed:

```bash
FLEET_API_URL=http://localhost:4000 \
FLEET_API_KEY=<api key> \
FLEET_HOST_KEY=<agent key from step 3> \
node deploy/kvm-host/agent/agent.mjs
```

The agent long-polls `/agent/jobs/next`, runs jobs over `adb -s 127.0.0.1:5555 …`,
and reports back. Use **Node 21+** if you want live screen streaming / the wall
(it needs the global `WebSocket`); otherwise streaming is silently skipped.

## 5. Test end-to-end

In the dashboard:
- **Profiller** → your two phones appear, heartbeating ONLINE.
- Open a phone → **Canlı ekran → Yayını başlat** (Node 21+ agent) → live, tappable.
- **Wall** → both phones in a grid; Synchronizer mirrors taps.
- **RPA** → build a flow → run it → watch the job complete on the device.
- **Snapshots / Images** → capture & restore.
- **Farm** → point a campaign at the device group and watch warmup + health.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/dev/kvm missing` | Enable virtualization in BIOS, `wsl --update`, ensure *Virtual Machine Platform* feature is on, reopen WSL. |
| `adb devices` shows `offline` forever | Android still booting; wait. If stuck >3 min, `docker compose logs phone-01`. |
| `binder_linux modprobe failed` | Recent WSL2 kernels use **binderfs** (the script tries to mount it). If neither works you need a WSL2 kernel built with `CONFIG_ANDROID_BINDER_IPC=y` + `CONFIG_ANDROID_BINDERFS=y`. |
| Agent: `Job targets a device with no ADB endpoint` | The device's `ipAddress:adbPort` is unset — re-run `register.mjs`. |
| Agent claims nothing | Device not assigned to this host. Check **Profiller** → device → host = `local-wsl2`, or re-run `register.mjs`. |
| Live screen blank | Use a Node 21+ agent; check `adb -s 127.0.0.1:5555 exec-out screencap -p > /tmp/s.png` works. |
| Can't reach API from WSL | If API runs on Windows, use `http://localhost:4000` (WSL2 forwards localhost). If that fails, use the Windows host IP from `/etc/resolv.conf`. |

## Cleaning up

```bash
cd deploy/local-test
docker compose down            # stop phones (keeps data volumes)
docker compose down -v         # also wipe phone data
```

Delete the `local-wsl2` host in the dashboard to remove the registration.
